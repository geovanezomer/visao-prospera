// ============================================================================
// POST /api/public/payments/webhook/asaas
// Carrega config do Asaas do banco (sem mutar process.env) e instancia o
// provider com a config própria daquela requisição.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { loadProviderConfig } from "@/lib/payments";
import { AsaasProvider } from "@/lib/payments/asaas";
import { handleNormalizedEvent } from "@/lib/payments/webhook-handler.server";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

export const Route = createFileRoute("/api/public/payments/webhook/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const rl = await rlConsume(`wh:asaas:${ip}`, 120, 60);
        if (!rl.allowed) return tooManyRequests(rl.retryAfter);

        const rawBody = await request.text();
        try {
          const cfg = (await loadProviderConfig("asaas")) ?? undefined;
          const provider = new AsaasProvider(cfg);
          const event = await provider.verifyWebhook(request, rawBody);
          // FIX P0 — extrai event.id do payload para replay protection.
          let providerEventId: string | null = null;
          try {
            providerEventId = (JSON.parse(rawBody)?.id ?? null) as string | null;
          } catch {
            /* noop */
          }
          await handleNormalizedEvent("asaas", event, providerEventId);
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
