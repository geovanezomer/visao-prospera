// ============================================================================
// Adaptador Stripe — implementação real via REST API (sem SDK).
//
// Usar REST direto mantém o bundle leve e funciona em qualquer runtime
// (Node/Worker/Edge) sem dependências nativas. Endpoints usados:
//   - POST /v1/checkout/sessions      → criar checkout hospedado
//   - POST /v1/billing_portal/sessions → criar portal do cliente
//   - HMAC-SHA256 sobre `t.payload` → validação do webhook
// ============================================================================

import type { PaymentProvider, NormalizedEvent, PlanId, ProviderConfig } from "./types";
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

async function stripeFetch<T>(
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  opts?: { idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Stripe aceita Idempotency-Key em qualquer POST: garante que reenvio
  // da mesma chave devolve a sessão já criada (sem cobrar/criar de novo).
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers,
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
  private readonly apiKey: string;
  private readonly webhookSecret: string | null;

  /**
   * Aceita config explícita (preferido) ou cai para process.env como
   * fallback de compatibilidade. NUNCA muta env global.
   */
  constructor(config?: ProviderConfig) {
    this.apiKey = config?.apiKey ?? process.env.STRIPE_SECRET_KEY ?? "";
    this.webhookSecret = config?.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? null;
  }

  async createCheckout(input: {
    plan: PlanId;
    email: string;
    name?: string;
    cpfCnpj?: string;
    phone?: string;
    successUrl: string;
    cancelUrl: string;
    interval?: "month" | "year" | "week" | "day" | "lifetime" | "one_time";
    priceCents?: number;
    currency?: string;
    providerRef?: string | null;
    planName?: string;
    upsell?: {
      name: string;
      priceCents: number;
      stripePriceId?: string | null;
      asaasRef?: string | null;
    } | null;
    idempotencyKey?: string;
  }): Promise<{
    url: string;
    providerSessionId?: string | null;
    providerCustomerId?: string | null;
  }> {
    const isOneTime = input.interval === "one_time" || input.interval === "lifetime";
    const mode = isOneTime ? "payment" : "subscription";

    // Resolve referência do preço:
    // 1) providerRef explícito (stripe_price_id no plano do banco);
    // 2) fallback legacy via getProviderPlanRef + env vars (starter/pro).
    const explicitRef =
      input.providerRef && input.providerRef.trim() !== "" ? input.providerRef : null;

    const body: Record<string, string | number | boolean | undefined> = {
      mode,
      "line_items[0][quantity]": 1,
      customer_email: input.email,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "metadata[plan]": input.plan,
      // Email no metadata da Session para correlacionar antes do
      // customer.subscription.* (que não traz customer_email).
      "metadata[email]": input.email,
      allow_promotion_codes: "true",
    };

    if (explicitRef) {
      body["line_items[0][price]"] = explicitRef;
    } else if (typeof input.priceCents === "number" && input.priceCents > 0) {
      // price_data inline — suporta planos criados na UI sem mapear no Stripe.
      const currency = (input.currency || "BRL").toLowerCase();
      body["line_items[0][price_data][currency]"] = currency;
      body["line_items[0][price_data][unit_amount]"] = input.priceCents;
      body["line_items[0][price_data][product_data][name]"] =
        input.planName || `Plano ${input.plan}`;
      if (!isOneTime) {
        const interval =
          input.interval === "year"
            ? "year"
            : input.interval === "week"
              ? "week"
              : input.interval === "day"
                ? "day"
                : "month";
        body["line_items[0][price_data][recurring][interval]"] = interval;
      }
    } else {
      // Fallback legacy (starter/pro via env).
      body["line_items[0][price]"] = getProviderPlanRef(input.plan);
    }

    // Upsell — adicional opcional escolhido no checkout.
    // Stripe: em `mode=payment`, adicionamos um line_item extra (one-time).
    // Em `mode=subscription`, usamos `subscription_data[add_invoice_items]`
    // que cobra o valor na 1ª fatura sem virar recorrência.
    if (input.upsell && input.upsell.priceCents > 0) {
      const u = input.upsell;
      const currency = (input.currency || "BRL").toLowerCase();
      if (mode === "payment") {
        body["line_items[1][quantity]"] = 1;
        if (u.stripePriceId && u.stripePriceId.trim()) {
          body["line_items[1][price]"] = u.stripePriceId;
        } else {
          body["line_items[1][price_data][currency]"] = currency;
          body["line_items[1][price_data][unit_amount]"] = u.priceCents;
          body["line_items[1][price_data][product_data][name]"] = u.name;
        }
      } else {
        // Add invoice item — cobrado junto na primeira fatura da assinatura.
        if (u.stripePriceId && u.stripePriceId.trim()) {
          body["subscription_data[add_invoice_items][0][price]"] = u.stripePriceId;
          body["subscription_data[add_invoice_items][0][quantity]"] = 1;
        } else {
          body["subscription_data[add_invoice_items][0][quantity]"] = 1;
          body["subscription_data[add_invoice_items][0][price_data][currency]"] = currency;
          body["subscription_data[add_invoice_items][0][price_data][unit_amount]"] = u.priceCents;
          body["subscription_data[add_invoice_items][0][price_data][product_data][name]"] = u.name;
        }
      }
      body["metadata[upsell]"] = "1";
      body["metadata[upsell_name]"] = u.name;
    }

    if (mode === "subscription") {
      body["subscription_data[metadata][plan]"] = input.plan;
      body["subscription_data[metadata][email]"] = input.email;
    } else {
      body["payment_intent_data[metadata][plan]"] = input.plan;
      body["payment_intent_data[metadata][email]"] = input.email;
    }

    const session = await stripeFetch<{ id?: string; url: string; customer?: string | null }>(
      this.apiKey,
      "/checkout/sessions",
      body,
      input.idempotencyKey ? { idempotencyKey: `co_${input.idempotencyKey}` } : undefined,
    );
    return {
      url: session.url,
      providerSessionId: session.id ?? null,
      providerCustomerId: session.customer ?? null,
    };
  }

  async createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    const session = await stripeFetch<{ url: string }>(this.apiKey, "/billing_portal/sessions", {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  async verifyWebhook(req: Request, rawBody: string): Promise<NormalizedEvent> {
    const signature = req.headers.get("stripe-signature");
    const secret = this.webhookSecret;
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
    // F-05: comparação constant-time (evita timing attack via Array.includes).
    const { timingSafeEqual } = await import("@/lib/timingSafe");
    const match = v1.some((cand) => timingSafeEqual(cand, expected));
    if (!match) throw new Error("Stripe webhook: assinatura inválida.");

    const event = JSON.parse(rawBody) as import("./_remote-types").StripeWebhookEvent;
    return this.parseEvent(event);
  }

  // Converte evento bruto do Stripe em NormalizedEvent.
  private parseEvent(event: import("./_remote-types").StripeWebhookEvent): NormalizedEvent {
    const obj = event.data.object;
    switch (event.type) {
      case "checkout.session.completed": {
        // Primeira ativação — Stripe envia em ambos os modos:
        //   - mode=subscription: subscription preenchido
        //   - mode=payment (one_time/lifetime): payment_intent preenchido
        // Para pagamentos únicos usamos `pi_<id>` como subscriptionId sintético
        // (correlaciona com checkout_intents e identifica o pagamento).
        const email = obj.customer_email ?? obj.customer_details?.email ?? "";
        const isSub = obj.mode === "subscription";
        const subscriptionId = isSub
          ? String(obj.subscription ?? "")
          : `pi_${String(obj.payment_intent ?? obj.id)}`;
        return {
          type: "subscription.activated",
          email,
          customerId: String(obj.customer ?? ""),
          subscriptionId,
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
          status:
            (obj.status as "active" | "canceled" | "incomplete" | "past_due" | "trialing") ??
            "active",
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
      case "customer.subscription.trial_will_end":
        return {
          type: "subscription.trial_will_end",
          customerId: String(obj.customer),
          subscriptionId: String(obj.id),
          trialEnd: obj.trial_end ? new Date(obj.trial_end * 1000).toISOString() : null,
        };
      default:
        return { type: "ignored", reason: event.type };
    }
  }
}
