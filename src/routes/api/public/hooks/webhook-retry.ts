// ============================================================================
// Disparo manual do reprocessamento de webhooks pendentes. A rotina roda
// sozinha pelo agendador interno (lib/scheduler.server.ts).
// Autenticação: `Authorization: Bearer <CRON_SECRET>` (ver lib/cronAuth.server.ts).
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { rejectUnlessCron } from "@/lib/cronAuth.server";

export const Route = createFileRoute("/api/public/hooks/webhook-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = rejectUnlessCron(request);
        if (denied) return denied;
        let limit = 25;
        try {
          const body = await request.json().catch(() => ({}));
          if (typeof body?.limit === "number" && body.limit > 0 && body.limit <= 100)
            limit = body.limit;
        } catch {
          /* corpo opcional */
        }
        const { runWebhookRetry } = await import("@/lib/jobs.server");
        const result = await runWebhookRetry(limit);
        return Response.json({ ...result });
      },
    },
  },
});
