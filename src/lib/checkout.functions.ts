// ============================================================================
// Server function que cria uma sessão de Checkout Stripe (modo redirect/hosted).
// Detecta automaticamente se é recorrente (subscription) ou one-time (payment)
// consultando o price antes. Anexa metadata.user_id para correlação no webhook.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({
  priceId: z.string().min(1),
  origin: z.string().url(),
});

type StripePrice = {
  id: string;
  recurring: { interval: string } | null;
};

type StripeList<T> = { data: T[] };

type StripeSession = {
  id: string;
  url: string;
};

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { stripeFetch, toFormBody } = await import("./stripe.server");

    // 1) Resolve o price.
    //    Os IDs no .env são lookup_keys (ex: "plano_mensal_recorrente"),
    //    NÃO IDs internos do Stripe (price_xxx). Buscamos via ?lookup_keys[].
    //    Se o input já vier no formato price_xxx, usamos direto.
    let price: StripePrice;
    if (data.priceId.startsWith("price_")) {
      price = await stripeFetch<StripePrice>(`/v1/prices/${encodeURIComponent(data.priceId)}`);
    } else {
      const list = await stripeFetch<StripeList<StripePrice>>(
        `/v1/prices?lookup_keys[]=${encodeURIComponent(data.priceId)}&limit=1`,
      );
      if (!list.data.length) {
        throw new Error(`Price não encontrado para lookup_key='${data.priceId}'. Verifique se o produto foi sincronizado no Stripe.`);
      }
      price = list.data[0];
    }
    const isSubscription = price.recurring !== null;
    const mode: "subscription" | "payment" = isSubscription ? "subscription" : "payment";

    const userId = context.userId;
    const email = (context.claims as { email?: string } | undefined)?.email;

    // 2) Monta o body do checkout session usando o ID real (price.id).
    const body: Record<string, string | number | undefined> = {
      mode,
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": 1,
      success_url: `${data.origin}/app?checkout=success`,
      cancel_url: `${data.origin}/planos?canceled=1`,
      customer_email: email,
      "metadata[user_id]": userId,
      "metadata[price_id]": data.priceId,
      allow_promotion_codes: "true",
    };

    if (isSubscription) {
      body["subscription_data[metadata][user_id]"] = userId;
      body["subscription_data[metadata][price_id]"] = data.priceId;
    } else {
      body["payment_intent_data[metadata][user_id]"] = userId;
      body["payment_intent_data[metadata][price_id]"] = data.priceId;
    }

    const session = await stripeFetch<StripeSession>("/v1/checkout/sessions", {
      method: "POST",
      body: toFormBody(body),
    });

    return { url: session.url };
  });
