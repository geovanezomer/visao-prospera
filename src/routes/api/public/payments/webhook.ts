// ============================================================================
// Webhook Stripe — recebe eventos e atualiza public.subscriptions.
// Path obrigatório: /api/public/payments/webhook (registrado pelo Lovable).
// Query string ?env=sandbox|live indica de qual ambiente veio o evento.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { planIdFromPriceId } from "@/lib/plans";

/**
 * Verifica assinatura do Stripe (formato: t=timestamp,v1=hex,v1=hex...).
 * Implementação enxuta equivalente a stripe.webhooks.constructEvent.
 */
function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  if (!header || !secret) return false;
  const parts: Record<string, string[]> = {};
  for (const item of header.split(",")) {
    const [k, v] = item.split("=");
    if (!k || !v) continue;
    (parts[k] ||= []).push(v);
  }
  const t = parts.t?.[0];
  const v1List = parts.v1 ?? [];
  if (!t || v1List.length === 0) return false;

  const signedPayload = `${t}.${payload}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  for (const v1 of v1List) {
    const gotBuf = Buffer.from(v1, "utf8");
    if (gotBuf.length === expectedBuf.length && timingSafeEqual(gotBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const env = url.searchParams.get("env") === "live" ? "live" : "sandbox";

        const secret =
          env === "live"
            ? process.env.PAYMENTS_WEBHOOK_SECRET
            : process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET;

        if (!secret) {
          console.error(`[stripe-webhook] Secret ausente para env=${env}`);
          return new Response("Webhook secret not configured", { status: 500 });
        }

        const sig = request.headers.get("stripe-signature") ?? "";
        const body = await request.text();

        if (!verifyStripeSignature(body, sig, secret)) {
          console.warn(`[stripe-webhook] Assinatura inválida (env=${env})`);
          return new Response("Invalid signature", { status: 401 });
        }

        let event: StripeEvent;
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          switch (event.type) {
            // -------- Compra única (Vitalício) --------
            case "checkout.session.completed": {
              const s = event.data.object as {
                mode: string;
                metadata?: { user_id?: string; price_id?: string };
                customer?: string;
                payment_status?: string;
              };
              if (s.mode === "payment" && s.payment_status === "paid") {
                const userId = s.metadata?.user_id;
                const priceId = s.metadata?.price_id ?? "";
                if (!userId) break;
                await supabaseAdmin.from("subscriptions").insert({
                  user_id: userId,
                  stripe_customer_id: s.customer ?? null,
                  price_id: priceId,
                  plan: planIdFromPriceId(priceId),
                  status: "lifetime",
                });
              }
              break;
            }

            // -------- Assinaturas (Mensal / Anual) --------
            case "customer.subscription.created":
            case "customer.subscription.updated": {
              const sub = event.data.object as {
                id: string;
                customer: string;
                status: string;
                current_period_end: number;
                metadata?: { user_id?: string };
                items: { data: Array<{ price: { id: string; recurring?: { interval: string } | null } }> };
              };
              const userId = sub.metadata?.user_id;
              if (!userId) break;
              const priceId = sub.items.data[0]?.price?.id ?? "";

              await supabaseAdmin
                .from("subscriptions")
                .upsert(
                  {
                    user_id: userId,
                    stripe_customer_id: sub.customer,
                    stripe_subscription_id: sub.id,
                    price_id: priceId,
                    plan: planIdFromPriceId(priceId),
                    status: sub.status,
                    current_period_end: sub.current_period_end
                      ? new Date(sub.current_period_end * 1000).toISOString()
                      : null,
                  },
                  { onConflict: "stripe_subscription_id" },
                );
              break;
            }

            case "customer.subscription.deleted": {
              const sub = event.data.object as { id: string };
              await supabaseAdmin
                .from("subscriptions")
                .update({ status: "canceled" })
                .eq("stripe_subscription_id", sub.id);
              break;
            }

            default:
              // outros eventos são ignorados silenciosamente
              break;
          }

          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("[stripe-webhook] erro processando evento:", err);
          // Retornar 500 faz o Stripe re-tentar.
          return new Response("Internal error", { status: 500 });
        }
      },
    },
  },
});
