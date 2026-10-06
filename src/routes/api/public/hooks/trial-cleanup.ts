// ============================================================================
// POST /api/public/hooks/trial-cleanup — disparo manual da limpeza de trials.
// A rotina roda sozinha pelo agendador interno (lib/scheduler.server.ts).
// Acesso: `Authorization: Bearer <CRON_SECRET>` (ver lib/cronAuth.server.ts).
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { rejectUnlessCron } from "@/lib/cronAuth.server";

export const Route = createFileRoute("/api/public/hooks/trial-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = rejectUnlessCron(request);
        if (denied) return denied;
        const { runTrialCleanup } = await import("@/lib/jobs.server");
        return Response.json(await runTrialCleanup());
      },
    },
  },
});
