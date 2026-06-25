// ============================================================================
// Adaptador Asaas — REST API v3.
//
// Docs:
//   - Checkout: https://docs.asaas.com/reference/criar-nova-cobranca (subscriptions)
//   - Portal:   "Central do Cliente" — Asaas gera link único via
//               POST /v3/customers/{id}/payments (link autosserviço).
//   - Webhook:  header `asaas-access-token` deve bater com ASAAS_WEBHOOK_TOKEN.
// ============================================================================

import type { PaymentProvider, NormalizedEvent, PlanId } from "./types";
import { getProviderPlanRef } from "./index";

function asaasBase(): string {
  const env = (process.env.ASAAS_ENV || "production").toLowerCase();
  return env === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
}

async function asaasFetch<T>(
  path: string,
  init?: { method?: string; body?: Record<string, unknown>; headers?: Record<string, string>; idempotencyKey?: string },
): Promise<T> {
  const key = process.env.ASAAS_API_KEY!;
  const headers: Record<string, string> = {
    access_token: key,
    "Content-Type": "application/json",
    ...(init?.headers || {}),
  };
  // Asaas: header "idempotency-key" garante que reposts não duplicam
  // customer/subscription/payment. Vale por 24h no lado do Asaas.
  if (init?.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  const res = await fetch(`${asaasBase()}${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Asaas API ${path}: ${JSON.stringify(json)}`);
  }
  return json as T;
}


function planFromValue(value: number): PlanId {
  // Heurística simples — preço PRO costuma ser maior. Asaas não tem
  // lookup_key; usamos o valor cobrado para mapear de volta.
  // Para precisão, podemos comparar com env vars de preço.
  const priceStarter = Number(process.env.ASAAS_PRICE_STARTER ?? 0);
  const pricePro = Number(process.env.ASAAS_PRICE_PRO ?? 0);
  if (pricePro && Math.abs(value - pricePro) < 0.5) return "pro";
  if (priceStarter && Math.abs(value - priceStarter) < 0.5) return "starter";
  return value >= 500 ? "pro" : "starter";
}

export class AsaasProvider implements PaymentProvider {
  readonly name = "asaas" as const;

  async createCheckout(input: {
    plan: PlanId;
    email: string;
    successUrl: string;
    cancelUrl: string;
    interval?: "month" | "year" | "week" | "day" | "lifetime" | "one_time";
    priceCents?: number;
    currency?: string;
    providerRef?: string | null;
    planName?: string;
    upsell?: { name: string; priceCents: number; stripePriceId?: string | null; asaasRef?: string | null } | null;
  }): Promise<{ url: string }> {
    // 1) Garante customer
    const found = await asaasFetch<{ data: Array<{ id: string }> }>(
      `/customers?email=${encodeURIComponent(input.email)}`,
    );
    let customerId = found.data?.[0]?.id;
    if (!customerId) {
      const created = await asaasFetch<{ id: string }>("/customers", {
        method: "POST",
        body: { name: input.email.split("@")[0], email: input.email },
      });
      customerId = created.id;
    }

    // 2) Resolve valor e ciclo.
    // Prioridade: priceCents (DB) → ASAAS_PLAN_* env legacy ("97.00:MONTHLY").
    let value: number;
    let cycle = "MONTHLY";
    if (typeof input.priceCents === "number" && input.priceCents > 0) {
      value = input.priceCents / 100;
      cycle = input.interval === "year" ? "YEARLY"
        : input.interval === "week" ? "WEEKLY"
        : input.interval === "day" ? "DAILY"
        : "MONTHLY";
    } else {
      const ref = input.providerRef || getProviderPlanRef(input.plan);
      const [valueStr, cycleStr] = ref.split(":");
      value = Number(valueStr);
      cycle = (cycleStr || "MONTHLY").toUpperCase();
    }

    const nextDueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const isOneTime = input.interval === "one_time" || input.interval === "lifetime";
    const upsellValue = input.upsell && input.upsell.priceCents > 0 ? input.upsell.priceCents / 100 : 0;
    const description = `${input.planName || `FinancePRO — plano ${input.plan}`}${isOneTime ? " (pagamento único)" : ""}`;

    if (isOneTime) {
      // Cobrança única: soma o upsell direto no valor para uma só cobrança.
      const totalValue = value + upsellValue;
      const fullDesc = upsellValue > 0
        ? `${description} + ${input.upsell!.name}`
        : description;
      const pay = await asaasFetch<{ id: string; invoiceUrl?: string }>("/payments", {
        method: "POST",
        body: {
          customer: customerId,
          billingType: "UNDEFINED",
          value: totalValue,
          dueDate: nextDueDate,
          description: fullDesc,
          externalReference: input.plan,
        },
      });
      if (!pay.invoiceUrl) throw new Error("Asaas: invoiceUrl não retornado para cobrança única.");
      return { url: pay.invoiceUrl };
    }

    // Recorrente — assinatura.
    const sub = await asaasFetch<{ id: string; invoiceUrl?: string }>("/subscriptions", {
      method: "POST",
      body: {
        customer: customerId,
        billingType: "UNDEFINED", // permite cartão/pix/boleto na tela
        value,
        nextDueDate,
        cycle, // MONTHLY | YEARLY
        description,
        externalReference: input.plan,
      },
    });

    // Upsell em assinatura — cria uma cobrança avulsa (one-shot) para o mesmo
    // customer, vencendo amanhã. Não vira recorrência. Fica separado da
    // primeira fatura da assinatura, mas é apresentado em paralelo.
    if (upsellValue > 0) {
      try {
        await asaasFetch<{ id: string }>("/payments", {
          method: "POST",
          body: {
            customer: customerId,
            billingType: "UNDEFINED",
            value: upsellValue,
            dueDate: nextDueDate,
            description: `Upsell: ${input.upsell!.name}`,
            externalReference: `${input.plan}__upsell`,
          },
        });
      } catch (e) {
        // Não bloqueia o checkout principal — apenas loga.
        console.error("[asaas] falha ao criar upsell:", e);
      }
    }

    // 3) Recupera primeira cobrança para obter o link de checkout hospedado.
    const payments = await asaasFetch<{ data: Array<{ invoiceUrl: string }> }>(
      `/payments?subscription=${sub.id}`,
    );
    const url = payments.data?.[0]?.invoiceUrl ?? sub.invoiceUrl;
    if (!url) throw new Error("Asaas: invoiceUrl não retornado.");
    return { url };
  }

  async createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    // Asaas Central do Cliente: URL pública por customer.
    // Fallback: lista de pagamentos do cliente (página hospedada).
    const env = (process.env.ASAAS_ENV || "production").toLowerCase();
    const base = env === "sandbox" ? "https://sandbox.asaas.com" : "https://www.asaas.com";
    return { url: `${base}/c/${input.customerId}` };
  }

  async verifyWebhook(req: Request, rawBody: string): Promise<NormalizedEvent> {
    const token = req.headers.get("asaas-access-token");
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) throw new Error("Asaas webhook: ASAAS_WEBHOOK_TOKEN não configurado.");
    if (token !== expected) throw new Error("Asaas webhook: token inválido.");

    const event = JSON.parse(rawBody) as { event: string; payment?: any; subscription?: any };
    return this.parseEvent(event);
  }

  private parseEvent(event: {
    event: string;
    payment?: any;
    subscription?: any;
  }): NormalizedEvent {
    const p = event.payment;
    const s = event.subscription;
    switch (event.event) {
      case "PAYMENT_CONFIRMED":
      case "PAYMENT_RECEIVED": {
        if (!p) return { type: "ignored", reason: "no payment" };
        const plan = (p.externalReference as PlanId) || planFromValue(Number(p.value ?? 0));
        return {
          type: "subscription.activated",
          email: p.customerEmail ?? "",
          customerId: String(p.customer),
          subscriptionId: String(p.subscription ?? p.id),
          plan,
          currentPeriodEnd: p.dueDate ? new Date(p.dueDate).toISOString() : null,
        };
      }
      case "SUBSCRIPTION_UPDATED": {
        if (!s) return { type: "ignored", reason: "no subscription" };
        return {
          type: "subscription.updated",
          customerId: String(s.customer),
          subscriptionId: String(s.id),
          plan: (s.externalReference as PlanId) || planFromValue(Number(s.value ?? 0)),
          status: s.status === "ACTIVE" ? "active" : "canceled",
          currentPeriodEnd: s.nextDueDate ? new Date(s.nextDueDate).toISOString() : null,
        };
      }
      case "SUBSCRIPTION_DELETED":
      case "PAYMENT_DELETED":
        return {
          type: "subscription.canceled",
          customerId: String((s ?? p)?.customer ?? ""),
          subscriptionId: String((s ?? p)?.id ?? ""),
        };
      case "PAYMENT_OVERDUE":
        return {
          type: "subscription.past_due",
          customerId: String(p?.customer ?? ""),
          subscriptionId: String(p?.subscription ?? ""),
        };
      default:
        return { type: "ignored", reason: event.event };
    }
  }
}
