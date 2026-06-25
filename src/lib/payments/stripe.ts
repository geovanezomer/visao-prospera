// ============================================================================
// Adaptador Stripe — implementação real via REST API (sem SDK).
//
// Usar REST direto mantém o bundle leve e funciona em qualquer runtime
// (Node/Worker/Edge) sem dependências nativas. Endpoints usados:
//   - POST /v1/checkout/sessions      → criar checkout hospedado
//   - POST /v1/billing_portal/sessions → criar portal do cliente
//   - HMAC-SHA256 sobre `t.payload` → validação do webhook
// ============================================================================

import type { PaymentProvider, NormalizedEvent, PlanId } from "./types";
import { getProviderPlanRef } from "./index";

const STRIPE_API = "https://api.stripe.com/v1";

function form(data: Record<string, string | number | boolean | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    u.set(k, String(v));
  }
  return u.toString();
}

async function stripeFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY!;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(body as Record<string, string | number | boolean | undefined>),
  });
  const json = (await res.json()) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new Error(`Stripe API ${path}: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

/** Mapeia priceId (lookup_key) de volta para o PlanId interno. */
function planFromPriceRef(priceRef: string): PlanId {
  if (priceRef === process.env.STRIPE_PRICE_PRO) return "pro";
  return "starter";
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe" as const;

  async createCheckout(input: {
    plan: PlanId;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const price = getProviderPlanRef(input.plan);
    const session = await stripeFetch<{ url: string }>("/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": 1,
      customer_email: input.email,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "subscription_data[metadata][plan]": input.plan,
      "metadata[plan]": input.plan,
      allow_promotion_codes: "true",
    });
    return { url: session.url };
  }

  async createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    const session = await stripeFetch<{ url: string }>("/billing_portal/sessions", {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  async verifyWebhook(req: Request, rawBody: string): Promise<NormalizedEvent> {
    const signature = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!signature || !secret) throw new Error("Stripe webhook: assinatura/secret ausente.");

    let timestamp: string | undefined;
    const v1: string[] = [];
    for (const part of signature.split(",")) {
      const [k, v] = part.split("=", 2);
      if (k === "t") timestamp = v;
      if (k === "v1") v1.push(v);
    }
    if (!timestamp || v1.length === 0) throw new Error("Stripe webhook: assinatura malformada.");
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > 300) throw new Error("Stripe webhook: timestamp expirado.");

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    );
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (!v1.includes(expected)) throw new Error("Stripe webhook: assinatura inválida.");

    const event = JSON.parse(rawBody) as { type: string; data: { object: any } };
    return this.parseEvent(event);
  }

  // Converte evento bruto do Stripe em NormalizedEvent.
  private parseEvent(event: { type: string; data: { object: any } }): NormalizedEvent {
    const obj = event.data.object;
    switch (event.type) {
      case "checkout.session.completed": {
        // Primeira ativação — Stripe envia este evento com customer_email preenchido.
        if (obj.mode !== "subscription") return { type: "ignored", reason: "not subscription" };
        return {
          type: "subscription.activated",
          email: obj.customer_email ?? obj.customer_details?.email ?? "",
          customerId: String(obj.customer),
          subscriptionId: String(obj.subscription),
          plan: (obj.metadata?.plan as PlanId) ?? "starter",
          currentPeriodEnd: null,
        };
      }
      case "customer.subscription.updated": {
        const item = obj.items?.data?.[0];
        const priceRef = item?.price?.lookup_key ?? item?.price?.id ?? "";
        const periodEnd = item?.current_period_end ?? obj.current_period_end;
        return {
          type: "subscription.updated",
          customerId: String(obj.customer),
          subscriptionId: String(obj.id),
          plan: (obj.metadata?.plan as PlanId) ?? planFromPriceRef(priceRef),
          status: obj.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        };
      }
      case "customer.subscription.deleted":
        return {
          type: "subscription.canceled",
          customerId: String(obj.customer),
          subscriptionId: String(obj.id),
        };
      case "invoice.payment_failed":
        return {
          type: "subscription.past_due",
          customerId: String(obj.customer),
          subscriptionId: String(obj.subscription ?? ""),
        };
      default:
        return { type: "ignored", reason: event.type };
    }
  }
}
