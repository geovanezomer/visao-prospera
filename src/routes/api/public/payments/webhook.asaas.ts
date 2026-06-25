// ============================================================================
// POST /api/public/payments/webhook/asaas
//
// Recebe eventos do Asaas. Verificação por token (header asaas-access-token)
// contra ASAAS_WEBHOOK_TOKEN. Persiste estado e dispara magic link.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { AsaasProvider } from "@/lib/payments/asaas";
import { handleNormalizedEvent } from "@/lib/payments/webhook-handler.server";

export const Route = createFileRoute("/api/public/payments/webhook/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          const provider = new AsaasProvider();
          const event = await provider.verifyWebhook(request, rawBody);
          await handleNormalizedEvent("asaas", event);
          return Response.json({ received: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro";
          console.error("[webhook asaas]", msg);
          return new Response(`Webhook error: ${msg}`, { status: 400 });
        }
      },
    },
  },
});
