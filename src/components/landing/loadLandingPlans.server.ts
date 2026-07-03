// ============================================================================
// loadLandingPlans — server-only helper para o loader da rota /landing.
//
// Tenta listPlansPublic; em falha OU lista vazia, cai para PLANS_FALLBACK
// e sinaliza { source: "fallback" }. Também dispara notifyAdmin com dedupe
// de 1 hora (in-memory) para o admin ver que o fallback está em uso.
// ============================================================================
import { PLANS_FALLBACK } from "@/components/landing/plansFallback";
import type { PlanRow } from "@/lib/admin/plans.functions";
import { listPlansPublic } from "@/lib/admin/plans.functions";

export type LandingPlans = {
  plans: PlanRow[];
  source: "db" | "fallback";
};

// Dedupe in-memory: 1 aviso por hora por worker é suficiente — o objetivo
// é acordar o admin, não spam de logs.
const NOTIFY_DEDUPE_MS = 60 * 60_000;
const lastNotifiedAt: Record<string, number> = {};

async function notifyAdmin(event: string, meta: Record<string, unknown>): Promise<void> {
  const now = Date.now();
  const last = lastNotifiedAt[event] ?? 0;
  if (now - last < NOTIFY_DEDUPE_MS) return;
  lastNotifiedAt[event] = now;
  try {
    const { logAudit } = await import("@/lib/admin/audit.server");
    await logAudit({
      action: `system.${event}`,
      resource: "landing",
      metadata: meta,
    });
  } catch (e) {
    console.warn("[landing] notifyAdmin falhou:", e);
  }
}

export async function loadLandingPlans(): Promise<LandingPlans> {
  try {
    const { plans } = await listPlansPublic();
    if (!plans || plans.length === 0) {
      console.error("[landing] planos servidos do fallback estático (lista vazia no DB)");
      await notifyAdmin("landing_fallback", { reason: "empty" });
      return { plans: PLANS_FALLBACK, source: "fallback" };
    }
    return { plans, source: "db" };
  } catch (e) {
    console.error(
      "[landing] planos servidos do fallback estático (erro no DB):",
      e instanceof Error ? e.message : e,
    );
    await notifyAdmin("landing_fallback", {
      reason: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    return { plans: PLANS_FALLBACK, source: "fallback" };
  }
}
