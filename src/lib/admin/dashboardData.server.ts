// ============================================================================
// Leituras compartilhadas pelos dashboards admin (server-only).
// ============================================================================
import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import type { SubRow } from "./dashboard.functions";

/**
 * Assinaturas no formato snake_case consumido pelas funções puras de
 * métricas (mrrAt, buildFunnel...). Cap prático de 10k linhas (PME).
 */
export async function loadSubRows(order: "asc" | "desc"): Promise<SubRow[]> {
  const t = schema.subscriptions;
  return db()
    .select({
      user_id: t.userId,
      plan: t.plan,
      status: t.status,
      price_id: t.priceId,
      provider: t.provider,
      current_period_end: t.currentPeriodEnd,
      cancel_at_period_end: t.cancelAtPeriodEnd,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })
    .from(t)
    .orderBy(order === "asc" ? asc(t.createdAt) : desc(t.createdAt))
    .limit(10000);
}
