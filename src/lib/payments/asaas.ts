// ============================================================================
// Adaptador Asaas — REST API v3.
//
// Docs:
//   - Checkout: https://docs.asaas.com/reference/criar-nova-cobranca (subscriptions)
//   - Portal:   "Central do Cliente" — Asaas gera link único via
//               POST /v3/customers/{id}/payments (link autosserviço).
//   - Webhook:  header `asaas-access-token` deve bater com ASAAS_WEBHOOK_TOKEN.
// ============================================================================

import type { PaymentProvider, NormalizedEvent, PlanId, ProviderConfig } from "./types";
import { getProviderPlanRef } from "./index";

function asaasBaseFor(mode: "live" | "sandbox" | null | undefined): string {
  const envMode = (mode ?? (process.env.ASAAS_ENV === "sandbox" ? "sandbox" : "live")) as
    | "live"
    | "sandbox";
  return envMode === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://api.asaas.com/v3";
}

type AsaasFetchOpts = {
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
};

async function asaasFetch<T>(
  apiKey: string,
  baseUrl: string,
  path: string,
  init?: AsaasFetchOpts,
): Promise<T> {
  const headers: Record<string, string> = {
    access_token: apiKey,
    "Content-Type": "application/json",
    ...(init?.headers || {}),
  };
  if (init?.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  const res = await fetch(`${baseUrl}${path}`, {
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
  const priceStarter = Number(process.env.ASAAS_PRICE_STARTER ?? 0);
  const pricePro = Number(process.env.ASAAS_PRICE_PRO ?? 0);
  if (pricePro && Math.abs(value - pricePro) < 0.5) return "pro";
  if (priceStarter && Math.abs(value - priceStarter) < 0.5) return "starter";
  return value >= 500 ? "pro" : "starter";
}

export class AsaasProvider implements PaymentProvider {
  readonly name = "asaas" as const;
  private readonly apiKey: string;
  private readonly webhookSecret: string | null;
  private readonly mode: "live" | "sandbox";
  private readonly baseUrl: string;

  constructor(config?: ProviderConfig) {
    this.apiKey = config?.apiKey ?? process.env.ASAAS_API_KEY ?? "";
    this.webhookSecret = config?.webhookSecret ?? process.env.ASAAS_WEBHOOK_TOKEN ?? null;
    this.mode = (config?.mode ?? (process.env.ASAAS_ENV === "sandbox" ? "sandbox" : "live")) as
      | "live"
      | "sandbox";
    this.baseUrl = asaasBaseFor(this.mode);
  }

  private fetch<T>(path: string, init?: AsaasFetchOpts): Promise<T> {
    return asaasFetch<T>(this.apiKey, this.baseUrl, path, init);
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
    const ik = input.idempotencyKey;
    const ikFor = (suffix: string) => (ik ? `${ik}:${suffix}` : undefined);

    // Resolve valor e ciclo.
    let value: number;
    let cycle = "MONTHLY";
    if (typeof input.priceCents === "number" && input.priceCents > 0) {
      value = input.priceCents / 100;
      cycle =
        input.interval === "year"
          ? "YEARLY"
          : input.interval === "week"
            ? "WEEKLY"
            : input.interval === "day"
              ? "DAILY"
              : "MONTHLY";
    } else {
      const ref = input.providerRef || getProviderPlanRef(input.plan);
      const [valueStr, cycleStr] = ref.split(":");
      value = Number(valueStr);
      cycle = (cycleStr || "MONTHLY").toUpperCase();
    }

    const isOneTime = input.interval === "one_time" || input.interval === "lifetime";
    const upsellValue =
      input.upsell && input.upsell.priceCents > 0 ? input.upsell.priceCents / 100 : 0;
    const planDesc = input.planName || `FinancePRO — plano ${input.plan}`;

    // Asaas Checkout hospedado — o link é criado sem pré-cadastrar cliente;
    // a página do Asaas coleta/valida os dados completos do pagador.
    // Docs: https://docs.asaas.com/reference/criar-novo-checkout
    const expirationMinutes = 1440; // 24h (máx permitido pelo Asaas)
    // Asaas exige name <= 30 caracteres por item e, na referência OpenAPI
    // atual do /v3/checkouts, imageBase64 também aparece como obrigatório.
    // Usamos um pixel transparente para não depender de URL pública de imagem.
    const truncate30 = (s: string) => (s.length > 30 ? s.slice(0, 30) : s);
    const transparentPixelBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const items: Array<{
      name: string;
      description: string;
      quantity: number;
      value: number;
      imageBase64: string;
    }> = [
      {
        name: truncate30(planDesc),
        description: planDesc.slice(0, 150),
        quantity: 1,
        value,
        imageBase64: transparentPixelBase64,
      },
    ];
    if (upsellValue > 0) {
      items.push({
        name: truncate30(input.upsell!.name),
        description: input.upsell!.name.slice(0, 150),
        quantity: 1,
        value: upsellValue,
        imageBase64: transparentPixelBase64,
      });
    }
    const totalValue = items.reduce((s, it) => s + it.value * it.quantity, 0);

    // Asaas /v3/checkouts só aceita CREDIT_CARD e PIX em billingTypes.
    // Porém, para RECURRENT o Asaas permite apenas CREDIT_CARD; PIX só pode
    // ser usado em DETACHED. BOLETO não é suportado neste endpoint.
    const body: Record<string, unknown> = {
      billingTypes: isOneTime ? ["CREDIT_CARD", "PIX"] : ["CREDIT_CARD"],
      chargeTypes: isOneTime ? ["DETACHED"] : ["RECURRENT"],
      minutesToExpire: expirationMinutes,
      callback: {
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        expiredUrl: input.cancelUrl,
      },
      items,
      externalReference: input.plan,
    };

    // IMPORTANTE: no Checkout hospedado v3, quando `customerData` é enviado,
    // o Asaas valida um cadastro quase completo (nome, CPF/CNPJ, telefone,
    // endereço, número, CEP e bairro). Como nossa landing coleta apenas dados
    // básicos, omitir `customerData` é intencional: o próprio checkout Asaas
    // coleta/valida os dados obrigatórios do pagador sem recusar a criação do
    // link por campos de endereço ausentes.
    if (!isOneTime) {
      // subscription é obrigatório quando chargeTypes = RECURRENT.
      // endDate é opcional — omitimos ao invés de enviar null.
      body.subscription = {
        cycle,
        nextDueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      };
    }

    const checkout = await this.fetch<{ id: string; link?: string; url?: string }>("/checkouts", {
      method: "POST",
      body,
      idempotencyKey: ikFor("checkout"),
    });
    const url = checkout.link || checkout.url;
    if (!url) throw new Error(`Asaas: link de checkout não retornado (total ${totalValue}).`);
    return { url, providerSessionId: checkout.id ?? null, providerCustomerId: null };
  }

  async createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    // Asaas Central do Cliente: URL pública por customer.
    const base = this.mode === "sandbox" ? "https://sandbox.asaas.com" : "https://www.asaas.com";
    return { url: `${base}/c/${input.customerId}` };
  }

  async verifyWebhook(req: Request, rawBody: string): Promise<NormalizedEvent> {
    const token = req.headers.get("asaas-access-token");
    const expected = this.webhookSecret;
    if (!expected) throw new Error("Asaas webhook: ASAAS_WEBHOOK_TOKEN não configurado.");
    // Constant-time compare para evitar timing attack na descoberta do token.
    const { timingSafeEqual } = await import("@/lib/timingSafe");
    if (!timingSafeEqual(token, expected)) throw new Error("Asaas webhook: token inválido.");

    const event = JSON.parse(rawBody) as import("./_remote-types").AsaasWebhookEvent;
    return await this.parseEvent(event);
  }

  // Asaas não envia customerEmail no webhook por padrão. Quando faltar,
  // buscamos no endpoint /customers/{id} para conseguir liberar o acesso.
  private async fetchCustomerEmail(customerId: string): Promise<string> {
    if (!customerId) return "";
    try {
      const c = await this.fetch<{ email?: string }>(`/customers/${customerId}`);
      return c?.email ?? "";
    } catch (e) {
      console.error("[asaas] fetchCustomerEmail falhou:", e);
      return "";
    }
  }

  private async parseEvent(
    event: import("./_remote-types").AsaasWebhookEvent,
  ): Promise<NormalizedEvent> {
    const p = event.payment;
    const s = event.subscription;
    switch (event.event) {
      case "PAYMENT_CONFIRMED":
      case "PAYMENT_RECEIVED": {
        if (!p) return { type: "ignored", reason: "no payment" };
        const plan = (p.externalReference as PlanId) || planFromValue(Number(p.value ?? 0));
        // Fallback: busca email do customer se o webhook não trouxer.
        const email = p.customerEmail || (await this.fetchCustomerEmail(String(p.customer ?? "")));
        return {
          type: "subscription.activated",
          email,
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
