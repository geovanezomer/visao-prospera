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

type StripeSession = {
  id: string;
  url: string;
};

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { stripeFetch, toFormBody } = await import("./stripe.server");

    // 1) Consulta o price para descobrir se é recorrente
    const price = await stripeFetch<StripePrice>(`/v1/prices/${encodeURIComponent(data.priceId)}`);
    const isSubscription = price.recurring !== null;
    const mode: "subscription" | "payment" = isSubscription ? "subscription" : "payment";

    const userId = context.userId;
    const email = (context.claims as { email?: string } | undefined)?.email;

    // 2) Monta o body do checkout session.
    //    metadata.user_id é replicado em subscription_data / payment_intent_data
    //    para que o webhook consiga correlacionar mesmo em eventos posteriores.
    const body: Record<string, string | number | undefined> = {
      mode,
      "line_items[0][price]": data.priceId,
      "line_items[0][quantity]": 1,
      success_url: `${data.origin}/app?checkout=success`,
      cancel_url: `${data.origin}/?checkout=cancel`,
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
