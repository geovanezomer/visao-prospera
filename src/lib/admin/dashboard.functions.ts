// ============================================================================
// Dashboard admin — KPIs do negócio: MRR, ARR, novos signups, trials,
// past_due, churn (30d), conversão trial→paid, receita por provider,
// webhook health 24h. Pure read, custo único por hit.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";
import type { AuthClaims } from "./_types";

function assertAdmin(claims: AuthClaims | undefined | null) {
  if (!isAdminEmail((claims?.email as string) ?? "")) {
    throw new Error("Acesso negado: apenas administrador.");
  }
}

// Preços fixos por price_id (centavos / mês). Mantemos local para evitar
// dependência de Stripe API aqui. Atualize se mudar o pricing.
const PRICE_TABLE_BRL_MONTH: Record<string, number> = {
  starter_monthly: 4900,
  starter_yearly: 4900 * 10, // 10 meses equivalente
  pro_monthly: 9900,
  pro_yearly: 9900 * 10,
};

function priceToMonthlyBRL(priceId: string | null | undefined, plan: string | null | undefined): number {
  if (priceId && PRICE_TABLE_BRL_MONTH[priceId] !== undefined) {
    const isYearly = /yearly|anual|year/i.test(priceId);
    return isYearly ? PRICE_TABLE_BRL_MONTH[priceId] / 12 : PRICE_TABLE_BRL_MONTH[priceId];
  }
  // Fallback por plano.
  if (plan === "starter") return 4900;
  if (plan === "pro") return 9900;
  return 0;
}

export type DashboardMetrics = {
  mrr: number; // em centavos
  arr: number;
  activeSubs: number;
  trialing: number;
  pastDue: number;
  canceled: number;
  lifetime: number;
  signups7d: number;
  signups30d: number;
  churnedLast30d: number;
  churnRate30d: number; // 0..1
  conversionTrialToPaid: number; // 0..1 (heurístico)
  byProvider: { stripe: number; asaas: number };
  byPlan: Record<string, number>;
  webhook24h: { total: number; ok: number; failed: number };
  // Funil de trial (Landing → magic link → conversão paga)
  trialFunnel: {
    requested: number;          // total de trial_requests
    activated: number;          // trial_requests com user_id criado
    converted: number;          // usuários que tinham trial e hoje têm assinatura ativa/lifetime
    conversionRate: number;     // converted / requested (0..1)
    activationRate: number;     // activated / requested (0..1)
    avgTimeToConvertHours: number; // tempo médio entre trial_request.created_at e subscription.created_at
    last30dRequested: number;
    last30dConverted: number;
  };
  generatedAt: string;
};


export const getDashboardMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardMetrics> => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Carregar todas as subscriptions (cap pratico — projetos PME).
    const { data: subs, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "user_id, plan, status, price_id, provider, current_period_end, cancel_at_period_end, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(10000);
    if (subErr) throw new Error(subErr.message);

    // Última linha por usuário.
    const latestByUser = new Map<string, any>();
    for (const s of subs ?? []) {
      if (!latestByUser.has(s.user_id)) latestByUser.set(s.user_id, s);
    }

    let mrr = 0;
    let activeSubs = 0,
      trialing = 0,
      pastDue = 0,
      canceled = 0,
      lifetime = 0;
    const byProvider = { stripe: 0, asaas: 0 } as { stripe: number; asaas: number };
    const byPlan: Record<string, number> = {};

    for (const s of latestByUser.values()) {
      const status = s.status as string;
      const monthly = priceToMonthlyBRL(s.price_id, s.plan);
      if (status === "active" || status === "trialing") {
        mrr += monthly;
        if (status === "active") activeSubs++;
        else trialing++;
        if (s.provider === "stripe") byProvider.stripe++;
        else if (s.provider === "asaas") byProvider.asaas++;
        byPlan[s.plan ?? "—"] = (byPlan[s.plan ?? "—"] ?? 0) + 1;
      } else if (status === "past_due") {
        pastDue++;
        mrr += monthly; // ainda contabiliza enquanto Stripe tenta cobrar
      } else if (status === "canceled") canceled++;
      else if (status === "lifetime") lifetime++;
    }

    // Signups via auth.admin.listUsers (paginação).
    const now = Date.now();
    const d7 = now - 7 * 86400_000;
    const d30 = now - 30 * 86400_000;
    let signups7d = 0,
      signups30d = 0;
    const MAX_PAGES = 25;
    for (let p = 1; p <= MAX_PAGES; p++) {
      const { data: u, error: ue } = await supabaseAdmin.auth.admin.listUsers({ page: p, perPage: 200 });
      if (ue) throw new Error(ue.message);
      const list = u.users ?? [];
      for (const usr of list) {
        const t = new Date(usr.created_at).getTime();
        if (t >= d30) signups30d++;
        if (t >= d7) signups7d++;
      }
      if (list.length < 200) break;
    }

    // Churn 30d: assinaturas que saíram de active/trialing para canceled nos últimos 30d.
    let churnedLast30d = 0;
    for (const s of latestByUser.values()) {
      if (
        s.status === "canceled" &&
        s.updated_at &&
        new Date(s.updated_at).getTime() >= d30
      ) {
        churnedLast30d++;
      }
    }
    const baseAtivos = activeSubs + trialing + pastDue;
    const churnRate30d = baseAtivos + churnedLast30d > 0 ? churnedLast30d / (baseAtivos + churnedLast30d) : 0;

    // Conversão trial→paid: usuarios que tiveram trial e hoje estão active.
    // Heurístico: count distinct user_id com status=active cujo histórico
    // contém uma linha trialing anterior.
    const trialUsers = new Set<string>();
    const paidAfterTrial = new Set<string>();
    for (const s of subs ?? []) {
      if (s.status === "trialing") trialUsers.add(s.user_id);
    }
    for (const s of subs ?? []) {
      if ((s.status === "active" || s.status === "lifetime") && trialUsers.has(s.user_id)) {
        paidAfterTrial.add(s.user_id);
      }
    }
    const conversionTrialToPaid = trialUsers.size > 0 ? paidAfterTrial.size / trialUsers.size : 0;

    // Webhook health 24h.
    const since = new Date(now - 86400_000).toISOString();
    const { data: hooks } = await supabaseAdmin
      .from("webhook_events")
      .select("status")
      .gte("received_at", since);
    let wOk = 0,
      wFail = 0;
    for (const r of hooks ?? []) {
      if (r.status === "failed") wFail++;
      else if (r.status === "processed" || r.status === "replayed") wOk++;
    }

    return {
      mrr: Math.round(mrr),
      arr: Math.round(mrr * 12),
      activeSubs,
      trialing,
      pastDue,
      canceled,
      lifetime,
      signups7d,
      signups30d,
      churnedLast30d,
      churnRate30d,
      conversionTrialToPaid,
      byProvider,
      byPlan,
      webhook24h: { total: hooks?.length ?? 0, ok: wOk, failed: wFail },
      generatedAt: new Date().toISOString(),
    };
  });
