// ============================================================================
// POST /api/public/payments/webhook/stripe
// Carrega config do Stripe do banco (sem mutar process.env) e instancia o
// provider com a config própria daquela requisição.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { loadProviderConfig } from "@/lib/payments";
import { StripeProvider } from "@/lib/payments/stripe";
import { handleNormalizedEvent } from "@/lib/payments/webhook-handler.server";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

export const Route = createFileRoute("/api/public/payments/webhook/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Rate limit por IP — webhooks legítimos do Stripe vêm de poucos IPs
        // estáveis, então 120/min é largo o bastante e bloqueia floods.
        const ip = clientIp(request);
        const rl = await rlConsume(`wh:stripe:${ip}`, 120, 60);
        if (!rl.allowed) return tooManyRequests(rl.retryAfter);

        const rawBody = await request.text();
        try {
          const cfg = (await loadProviderConfig("stripe")) ?? undefined;
          const provider = new StripeProvider(cfg);
          const event = await provider.verifyWebhook(request, rawBody);
          // FIX P0 — extrai event.id do payload para replay protection.
          let providerEventId: string | null = null;
          try {
            providerEventId = (JSON.parse(rawBody)?.id ?? null) as string | null;
          } catch {
            /* noop */
          }
          await handleNormalizedEvent("stripe", event, providerEventId);
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
