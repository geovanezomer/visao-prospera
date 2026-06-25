// ============================================================================
// POST /api/public/payments/webhook/stripe
// Hidrata STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET do banco antes de validar.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { hydrateProviderEnv } from "@/lib/payments";
import { StripeProvider } from "@/lib/payments/stripe";
import { handleNormalizedEvent } from "@/lib/payments/webhook-handler.server";

export const Route = createFileRoute("/api/public/payments/webhook/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          await hydrateProviderEnv("stripe");
          const provider = new StripeProvider();
          const event = await provider.verifyWebhook(request, rawBody);
          await handleNormalizedEvent("stripe", event);
          return Response.json({ received: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro";
          console.error("[webhook stripe]", msg);
          return new Response(`Webhook error: ${msg}`, { status: 400 });
        }
      },
    },
  },
});
