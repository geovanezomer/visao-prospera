// ============================================================================
// Endpoint público chamado pelo pg_cron para reprocessar webhooks pendentes.
// Autenticação: header `apikey` igual ao SUPABASE_PUBLISHABLE_KEY/ANON_KEY.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/webhook-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        let limit = 25;
        try {
          const body = await request.json().catch(() => ({}));
          if (typeof body?.limit === "number" && body.limit > 0 && body.limit <= 100)
            limit = body.limit;
        } catch {
          /* corpo opcional */
        }
        const { runRetryBatch } = await import("@/lib/payments/webhook-handler.server");
        const result = await runRetryBatch(limit);
        return Response.json({ ...result });
      },
    },
  },
});
