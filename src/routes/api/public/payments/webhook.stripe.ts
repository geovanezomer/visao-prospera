// ============================================================================
// POST /api/public/payments/webhook/stripe
//
// Recebe eventos do Stripe, verifica assinatura HMAC-SHA256 e persiste o
// estado da assinatura em public.subscriptions. Na primeira ativação,
// dispara magic link de acesso via Supabase Admin.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { StripeProvider } from "@/lib/payments/stripe";
import { handleNormalizedEvent } from "@/lib/payments/webhook-handler.server";

export const Route = createFileRoute("/api/public/payments/webhook/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        try {
          const provider = new StripeProvider();
          const event = await provider.verifyWebhook(request, rawBody);
          await handleNormalizedEvent("stripe", event);
          return Response.json({ received: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro";
          console.error("[webhook stripe]", msg);
          // 400 para problemas de assinatura; Stripe não retentará indefinidamente
          // mas relançará por horas — suficiente para diagnóstico.
          return new Response(`Webhook error: ${msg}`, { status: 400 });
        }
      },
    },
  },
});
