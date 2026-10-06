// ============================================================================
// Admin · Operação: saúde (banco, backup, restauração, Odoo, erros) e a lista
// de erros capturados.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { requireAuth } from "@/lib/requireAuth";

export const getOpsHealth = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { collectOpsHealth } = await import("@/lib/ops/health.server");
    const { listErrorEvents } = await import("@/lib/ops/errors.server");
    const [health, errors] = await Promise.all([collectOpsHealth(), listErrorEvents(30)]);
    return { ...health, errors };
  });

export const runOpsAlertsNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { runOpsAlerts } = await import("@/lib/ops/alerts.server");
    return runOpsAlerts();
  });
