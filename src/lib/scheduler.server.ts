// ============================================================================
// Agendador interno — substitui o pg_cron/pg_net do Supabase.
//
// Sobe uma vez por processo, depois do bootstrap do banco (src/server.ts).
// Com mais de uma réplica do app, deixe JOBS_ENABLED="ON" em apenas uma.
// As rotinas são idempotentes; uma execução que ainda está rodando não é
// sobreposta pela próxima (protect: true).
// ============================================================================
import { Cron } from "croner";

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  if ((process.env.JOBS_ENABLED ?? "ON").toUpperCase() === "OFF") {
    console.log("[scheduler] desligado (JOBS_ENABLED=OFF).");
    return;
  }

  const run = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      const result = await fn();
      console.log(`[scheduler] ${name}:`, JSON.stringify(result));
    } catch (e) {
      console.error(`[scheduler] ${name} falhou:`, e instanceof Error ? e.message : e);
    }
  };

  const jobs = () => import("@/lib/jobs.server");
  const opts = { protect: true, timezone: "America/Sao_Paulo" };

  new Cron(
    "*/2 * * * *",
    opts,
    run("webhook-retry", async () => (await jobs()).runWebhookRetry()),
  );
  new Cron(
    "7 * * * *",
    opts,
    run("trial-cleanup", async () => (await jobs()).runTrialCleanup()),
  );
  new Cron(
    "*/30 * * * *",
    opts,
    run("reconcile-checkout", async () => (await jobs()).runCheckoutReconcile()),
  );
  console.log("[scheduler] rotinas agendadas: webhook-retry, trial-cleanup, reconcile-checkout.");
}
