// ============================================================================
// Séries temporais e distribuições para gráficos do Dashboard Admin.
// Calcula últimos 12 meses de MRR, churn, novos usuários e usuários ativos,
// além do funil de conversão e distribuição por plano.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { requireAuth } from "@/lib/requireAuth";

// Tabela de preços local (centavos / mês). Manter em sincronia com dashboard.functions.ts.
const PRICE_TABLE_BRL_MONTH: Record<string, number> = {
  starter_monthly: 4900,
  starter_yearly: 4900 * 10,
  pro_monthly: 9900,
  pro_yearly: 9900 * 10,
};
function priceToMonthlyBRL(
  priceId: string | null | undefined,
  plan: string | null | undefined,
): number {
  if (priceId && PRICE_TABLE_BRL_MONTH[priceId] !== undefined) {
    const isYearly = /yearly|anual|year/i.test(priceId);
    return isYearly ? PRICE_TABLE_BRL_MONTH[priceId] / 12 : PRICE_TABLE_BRL_MONTH[priceId];
  }
  if (plan === "starter") return 4900;
  if (plan === "pro") return 9900;
  return 0;
}

export type MonthlyPoint = {
  month: string; // "2026-01"
  label: string; // "jan/26"
  mrr: number; // centavos
  churned: number; // qtd cancelados naquele mês
  newUsers: number; // novos signups no mês
  activeUsers: number; // assinaturas ativas no fim do mês
};

export type DashboardCharts = {
  monthly: MonthlyPoint[];
  funnel: { stage: string; value: number }[];
  byPlan: { plan: string; value: number }[];
  generatedAt: string;
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
}

export const getDashboardCharts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((input: { months?: number } | undefined) => ({
    months: Math.max(1, Math.min(36, Number(input?.months ?? 12))),
  }))
  .handler(async ({ data, context }): Promise<DashboardCharts> => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const { loadSubRows } = await import("./dashboardData.server");

    // Janela: últimos N meses (inclusivo do mês corrente).
    const N = data.months;
    const now = new Date();
    const months: { key: string; label: string; start: Date; end: Date }[] = [];
    for (let i = N - 1; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      months.push({ key: monthKey(start), label: monthLabel(start), start, end });
    }

    // Subscriptions completas (cap 10k linhas).
    const subs = await loadSubRows("asc");

    // Última linha por usuário (para distribuição por plano e funil).
    type SubRow = (typeof subs)[number];
    const latestByUser = new Map<string, SubRow>();
    for (const s of [...subs].reverse()) {
      if (!latestByUser.has(s.user_id)) latestByUser.set(s.user_id, s);
    }

    // Distribuição por plano (apenas ativos/trialing/lifetime/past_due).
    const planMap: Record<string, number> = {};
    let activeTotal = 0,
      trialingTotal = 0,
      lifetimeTotal = 0;
    for (const s of latestByUser.values()) {
      if (["active", "trialing", "past_due", "lifetime"].includes(s.status)) {
        const k = s.plan ?? "—";
        planMap[k] = (planMap[k] ?? 0) + 1;
      }
      if (s.status === "active") activeTotal++;
      else if (s.status === "trialing") trialingTotal++;
      else if (s.status === "lifetime") lifetimeTotal++;
    }
    const byPlan = Object.entries(planMap)
      .map(([plan, value]) => ({ plan, value }))
      .sort((a, b) => b.value - a.value);

    // Signups por usuário (tabela user).
    const userCreatedAt = new Map<string, number>();
    const userRows = await db()
      .select({ id: schema.user.id, createdAt: schema.user.createdAt })
      .from(schema.user);
    for (const usr of userRows) userCreatedAt.set(usr.id, usr.createdAt.getTime());
    const totalSignups = userCreatedAt.size;

    // Construir séries mensais.
    const monthly: MonthlyPoint[] = months.map(({ key, label, start, end }) => {
      const startMs = start.getTime();
      const endMs = end.getTime();
      let mrr = 0;
      let churned = 0;
      let newUsers = 0;
      const activeAtEnd = new Set<string>();

      for (const [uid, ts] of userCreatedAt) {
        if (ts >= startMs && ts < endMs) newUsers++;
        void uid;
      }

      // Para MRR/active no fim do mês: usar última linha de cada usuário com created_at < endMs.
      const lastByUserUpToMonth = new Map<string, SubRow>();
      for (const s of subs) {
        const c = s.created_at ? new Date(s.created_at).getTime() : 0;
        if (c < endMs) lastByUserUpToMonth.set(s.user_id, s);
      }
      for (const s of lastByUserUpToMonth.values()) {
        const monthlyPrice = priceToMonthlyBRL(s.price_id, s.plan);
        const status = s.status as string;
        const upd = new Date(s.updated_at ?? s.created_at ?? 0).getTime();
        // Considera ativo no fim do mês se status atual é ativo/trialing/past_due/lifetime
        // E updated_at < endMs (estado vigente).
        const isActiveLike =
          ["active", "trialing", "past_due", "lifetime"].includes(status) && upd < endMs;
        if (isActiveLike) {
          activeAtEnd.add(s.user_id);
          mrr += monthlyPrice;
        }
        // Churn: cancelado e updated_at dentro do mês.
        if (status === "canceled" && upd >= startMs && upd < endMs) churned++;
      }

      return {
        month: key,
        label,
        mrr: Math.round(mrr),
        churned,
        newUsers,
        activeUsers: activeAtEnd.size,
      };
    });

    // Funil de conversão (totais agregados).
    const trialUsers = new Set<string>();
    const paidAfterTrial = new Set<string>();
    for (const s of subs) if (s.status === "trialing") trialUsers.add(s.user_id);
    for (const s of subs) {
      if ((s.status === "active" || s.status === "lifetime") && trialUsers.has(s.user_id)) {
        paidAfterTrial.add(s.user_id);
      }
    }
    const funnel = [
      { stage: "Signups", value: totalSignups },
      { stage: "Iniciaram trial", value: trialUsers.size },
      { stage: "Convertidos (pago)", value: activeTotal + lifetimeTotal },
      { stage: "Ativos hoje", value: activeTotal + trialingTotal + lifetimeTotal },
    ];

    return {
      monthly,
      funnel,
      byPlan,
      generatedAt: new Date().toISOString(),
    };
  });
