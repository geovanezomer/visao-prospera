// Server functions de assinatura do usuário logado (substitui o RPC
// get_active_plan do Supabase).
import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/lib/requireAuth";

export type ActivePlanRow = {
  plan: string;
  status: string;
  current_period_end: string | null;
  provider: string;
  cancel_at_period_end: boolean;
};

const ACTIVE_STATUSES = ["active", "trialing", "lifetime", "past_due"];

/** Assinatura mais recente do usuário com status que dá (ou quase dá) acesso; null se nenhuma. */
export const getMyActivePlan = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<ActivePlanRow | null> => {
    const { db, schema } = await import("@/db/client.server");
    const { and, eq, inArray, desc } = await import("drizzle-orm");
    const s = schema.subscriptions;
    const rows = await db()
      .select({
        plan: s.plan,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        provider: s.provider,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      })
      .from(s)
      .where(and(eq(s.userId, context.userId), inArray(s.status, ACTIVE_STATUSES)))
      .orderBy(desc(s.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const end = row.currentPeriodEnd as unknown;
    return {
      plan: row.plan,
      status: row.status,
      current_period_end:
        end == null ? null : end instanceof Date ? end.toISOString() : String(end),
      provider: row.provider,
      cancel_at_period_end: !!row.cancelAtPeriodEnd,
    };
  });
