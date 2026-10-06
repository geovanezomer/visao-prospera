// ============================================================================
// Dashboard admin — KPIs do negócio com janelas comparáveis
// (atual vs período anterior imediatamente antes), série diária para
// sparklines e funil de conversão (trials → checkouts → pagos).
//
// Pure read; custo único por hit. periodDays: 7 | 30 | 90 (default 30d).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { gte } from "drizzle-orm";
import { requireAuth } from "@/lib/requireAuth";

// Preços fixos por price_id (centavos/mês). Mantemos local para evitar
// dependência de Stripe API aqui. Atualize se mudar o pricing.
const PRICE_TABLE_BRL_MONTH: Record<string, number> = {
  starter_monthly: 4900,
  starter_yearly: 4900 * 10, // 10 meses equivalente
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

// ── Tipos ────────────────────────────────────────────────────────────────────
export type PeriodDays = 7 | 30 | 90;
export type Delta = { current: number; previous: number };
export type SeriesPoint = { day: string; mrrCents: number; signups: number; churn: number };
export type Funnel = {
  trialsRequested: number;
  trialsActivated: number;
  checkoutsStarted: number;
  paid: number;
};

export type DashboardMetrics = {
  periodDays: PeriodDays;
  windows: {
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
  };
  mrr: Delta; // MRR reconstruído ao fim de cada janela
  arr: Delta;
  activeSubs: Delta; // ativos ao fim de cada janela
  signups: Delta; // novos usuários na janela
  churn: Delta; // cancelamentos na janela
  trials: Delta; // trial_requests na janela
  conversion: Delta; // paid/trialsRequested na mesma janela (0..1)
  series: SeriesPoint[];
  funnel: Funnel;
  // Snapshot atual (não janelado) — mantém compat com resto do painel.
  snapshot: {
    trialing: number;
    pastDue: number;
    canceled: number;
    lifetime: number;
    byProvider: { stripe: number; asaas: number };
    byPlan: Record<string, number>;
    webhook24h: { total: number; ok: number; failed: number };
  };
  generatedAt: string;
};

// ── Helpers de janela ────────────────────────────────────────────────────────
/**
 * Calcula duas janelas contíguas de mesmo tamanho (dias), sem sobreposição.
 * currentEnd = `now`; previousEnd = currentStart.
 * Exportado para teste unitário.
 */
export function computeWindows(now: Date, periodDays: PeriodDays) {
  const ms = periodDays * 86400_000;
  const currentEnd = now.getTime();
  const currentStart = currentEnd - ms;
  const previousEnd = currentStart; // sem overlap
  const previousStart = previousEnd - ms;
  return {
    currentStart: new Date(currentStart),
    currentEnd: new Date(currentEnd),
    previousStart: new Date(previousStart),
    previousEnd: new Date(previousEnd),
  };
}

function inWindow(ts: string | null | undefined, start: Date, end: Date): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/**
 * Reconstrói MRR ao fim de `atDate` a partir das linhas de subscriptions:
 * conta ativo/trialing/past_due criado antes de `atDate` e que ainda não
 * havia sido cancelado antes desse instante.
 */
export function mrrAt(subs: SubRow[], atDate: Date): number {
  const cutoff = atDate.getTime();
  let mrr = 0;
  // Última linha por usuário (mais recente até `atDate`).
  const latestByUser = new Map<string, SubRow>();
  for (const s of subs) {
    const created = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (created > cutoff) continue;
    const cur = latestByUser.get(s.user_id);
    if (!cur) latestByUser.set(s.user_id, s);
    else {
      const curT = cur.updated_at ? new Date(cur.updated_at).getTime() : 0;
      const sT = s.updated_at ? new Date(s.updated_at).getTime() : 0;
      if (sT > curT) latestByUser.set(s.user_id, s);
    }
  }
  for (const s of latestByUser.values()) {
    const status = s.status;
    // Se cancelou depois de atDate, ainda estava ativo naquele instante.
    const canceledBefore =
      status === "canceled" && s.updated_at && new Date(s.updated_at).getTime() <= cutoff;
    if (canceledBefore) continue;
    if (status === "active" || status === "trialing" || status === "past_due") {
      mrr += priceToMonthlyBRL(s.price_id, s.plan);
    }
  }
  return Math.round(mrr);
}

/** Conta ativos (active+trialing+past_due) ao fim de `atDate`. */
function activeAt(subs: SubRow[], atDate: Date): number {
  const cutoff = atDate.getTime();
  const latestByUser = new Map<string, SubRow>();
  for (const s of subs) {
    const created = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (created > cutoff) continue;
    latestByUser.set(s.user_id, latestByUser.get(s.user_id) ?? s);
  }
  let n = 0;
  for (const s of latestByUser.values()) {
    if (s.status === "canceled" && s.updated_at && new Date(s.updated_at).getTime() <= cutoff)
      continue;
    if (s.status === "active" || s.status === "trialing" || s.status === "past_due") n++;
  }
  return n;
}

export type SubRow = {
  user_id: string;
  plan: string | null;
  status: string;
  price_id: string | null;
  provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type TrialRow = { user_id: string | null; created_at: string | null; consumed_at: string | null };
type IntentRow = {
  status: string;
  created_at: string;
  confirmed_at: string | null;
  updated_at: string | null;
};

/**
 * Constrói o funil da janela (pure — separado para teste).
 */
export function buildFunnel(
  trials: TrialRow[],
  intents: IntentRow[],
  start: Date,
  end: Date,
): Funnel {
  const trialsRequested = trials.filter((t) => inWindow(t.created_at, start, end)).length;
  const trialsActivated = trials.filter((t) => inWindow(t.consumed_at, start, end)).length;
  const checkoutsStarted = intents.filter((i) => inWindow(i.created_at, start, end)).length;
  const paid = intents.filter(
    (i) => i.status === "paid" && inWindow(i.confirmed_at ?? i.updated_at, start, end),
  ).length;
  return { trialsRequested, trialsActivated, checkoutsStarted, paid };
}

// ── Server function ──────────────────────────────────────────────────────────
export const getDashboardMetrics = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: { periodDays?: PeriodDays } | undefined) => {
    const p = data?.periodDays;
    const periodDays: PeriodDays = p === 7 || p === 90 ? p : 30;
    return { periodDays };
  })
  .handler(async ({ context, data }): Promise<DashboardMetrics> => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const { loadSubRows } = await import("./dashboardData.server");

    const { periodDays } = data;
    const now = new Date();
    const w = computeWindows(now, periodDays);

    // ── Subscriptions (cap prático para PMEs) ────────────────────────────────
    const subs: SubRow[] = await loadSubRows("desc");

    // Snapshot atual (não janelado).
    const latestByUser = new Map<string, SubRow>();
    for (const s of subs) if (!latestByUser.has(s.user_id)) latestByUser.set(s.user_id, s);
    let trialing = 0,
      pastDue = 0,
      canceled = 0,
      lifetime = 0;
    const byProvider = { stripe: 0, asaas: 0 };
    const byPlan: Record<string, number> = {};
    for (const s of latestByUser.values()) {
      if (s.status === "trialing") trialing++;
      else if (s.status === "past_due") pastDue++;
      else if (s.status === "canceled") canceled++;
      else if (s.status === "lifetime") lifetime++;
      if (s.status === "active" || s.status === "trialing" || s.status === "past_due") {
        if (s.provider === "stripe") byProvider.stripe++;
        else if (s.provider === "asaas") byProvider.asaas++;
        byPlan[s.plan ?? "—"] = (byPlan[s.plan ?? "—"] ?? 0) + 1;
      }
    }

    // MRR/ARR/Ativos ao fim de cada janela.
    const mrrCurrent = mrrAt(subs, w.currentEnd);
    const mrrPrevious = mrrAt(subs, w.previousEnd);
    const activeCurrent = activeAt(subs, w.currentEnd);
    const activePrevious = activeAt(subs, w.previousEnd);

    // Churn por janela: cancelados cujo updated_at cai na janela.
    const churnCurrent = subs.filter(
      (s) => s.status === "canceled" && inWindow(s.updated_at, w.currentStart, w.currentEnd),
    ).length;
    const churnPrevious = subs.filter(
      (s) => s.status === "canceled" && inWindow(s.updated_at, w.previousStart, w.previousEnd),
    ).length;

    // ── Signups por janela (tabela user). ────────────────────────────────────
    let signupsCurrent = 0,
      signupsPrevious = 0;
    const allUsers = (
      await db().select({ createdAt: schema.user.createdAt }).from(schema.user)
    ).map((u) => ({ created_at: u.createdAt.toISOString() }));
    for (const usr of allUsers) {
      if (inWindow(usr.created_at, w.currentStart, w.currentEnd)) signupsCurrent++;
      else if (inWindow(usr.created_at, w.previousStart, w.previousEnd)) signupsPrevious++;
    }

    // ── Trials (server-side filtrado pela janela ampla p/ economia). ─────────
    const sinceFar = w.previousStart.toISOString();
    const tr = schema.trialRequests;
    const trials: TrialRow[] = await db()
      .select({ user_id: tr.userId, created_at: tr.createdAt, consumed_at: tr.consumedAt })
      .from(tr)
      .where(gte(tr.createdAt, sinceFar))
      .limit(50000);
    const trialsCurrent = trials.filter((t) =>
      inWindow(t.created_at, w.currentStart, w.currentEnd),
    ).length;
    const trialsPrevious = trials.filter((t) =>
      inWindow(t.created_at, w.previousStart, w.previousEnd),
    ).length;

    // ── Checkout intents (para funil e conversão). ───────────────────────────
    const ci = schema.checkoutIntents;
    const intents: IntentRow[] = await db()
      .select({
        status: ci.status,
        created_at: ci.createdAt,
        confirmed_at: ci.confirmedAt,
        updated_at: ci.updatedAt,
      })
      .from(ci)
      .where(gte(ci.createdAt, sinceFar))
      .limit(50000);

    const funnel = buildFunnel(trials, intents, w.currentStart, w.currentEnd);
    const funnelPrev = buildFunnel(trials, intents, w.previousStart, w.previousEnd);

    // Conversão = paid/trialsRequested por janela (0..1 em base 10k p/ int).
    const convCurrent = funnel.trialsRequested > 0 ? funnel.paid / funnel.trialsRequested : 0;
    const convPrevious =
      funnelPrev.trialsRequested > 0 ? funnelPrev.paid / funnelPrev.trialsRequested : 0;

    // ── Webhooks 24h (snapshot). ─────────────────────────────────────────────
    const since24 = new Date(now.getTime() - 86400_000).toISOString();
    const hooks = await db()
      .select({ status: schema.webhookEvents.status })
      .from(schema.webhookEvents)
      .where(gte(schema.webhookEvents.receivedAt, since24));
    let wOk = 0,
      wFail = 0;
    for (const r of hooks) {
      if (r.status === "failed") wFail++;
      else if (r.status === "processed" || r.status === "replayed") wOk++;
    }

    // ── Série diária (mrrCents / signups / churn por dia da janela atual). ──
    const series: SeriesPoint[] = [];
    const dayMs = 86400_000;
    const startDay = new Date(w.currentStart);
    startDay.setUTCHours(0, 0, 0, 0);
    for (let d = startDay.getTime(); d < w.currentEnd.getTime(); d += dayMs) {
      const dayEnd = new Date(d + dayMs);
      const dayStart = new Date(d);
      const signups = allUsers.filter((u) => inWindow(u.created_at, dayStart, dayEnd)).length;
      const churn = subs.filter(
        (s) => s.status === "canceled" && inWindow(s.updated_at, dayStart, dayEnd),
      ).length;
      series.push({
        day: dayStart.toISOString().slice(0, 10),
        mrrCents: mrrAt(subs, dayEnd),
        signups,
        churn,
      });
    }

    return {
      periodDays,
      windows: {
        currentStart: w.currentStart.toISOString(),
        currentEnd: w.currentEnd.toISOString(),
        previousStart: w.previousStart.toISOString(),
        previousEnd: w.previousEnd.toISOString(),
      },
      mrr: { current: mrrCurrent, previous: mrrPrevious },
      arr: { current: mrrCurrent * 12, previous: mrrPrevious * 12 },
      activeSubs: { current: activeCurrent, previous: activePrevious },
      signups: { current: signupsCurrent, previous: signupsPrevious },
      churn: { current: churnCurrent, previous: churnPrevious },
      trials: { current: trialsCurrent, previous: trialsPrevious },
      conversion: { current: convCurrent, previous: convPrevious },
      series,
      funnel,
      snapshot: {
        trialing,
        pastDue,
        canceled,
        lifetime,
        byProvider,
        byPlan,
        webhook24h: { total: hooks.length, ok: wOk, failed: wFail },
      },
      generatedAt: now.toISOString(),
    };
  });
