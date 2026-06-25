// ============================================================================
// Estornos (refunds) — server-only.
//
// Não vive na interface PaymentProvider porque é uma operação administrativa
// rara e cada provedor tem fluxo bem distinto:
//
//   - Stripe: subscription → latest_invoice → payment_intent → POST /refunds
//     `amount` em centavos. Omitir = estorno total.
//
//   - Asaas:  GET /payments?subscription=… (pega o último CONFIRMED/RECEIVED)
//     → POST /payments/{id}/refund { value? }. `value` em reais. Omitir = total.
// ============================================================================

export type RefundInput = {
  provider: string; // "stripe" | "asaas"
  subscriptionId: string | null;
  customerId: string | null;
  amount?: number; // Stripe: centavos | Asaas: reais
  reason?: string;
};

export type RefundResult = {
  ok: true;
  provider: string;
  refundId: string;
  amount: number | null;
  status: string;
};

export async function refundLastPayment(input: RefundInput): Promise<RefundResult> {
  if (input.provider === "stripe") return refundStripe(input);
  if (input.provider === "asaas") return refundAsaas(input);
  throw new Error(`Provedor não suportado para estorno: ${input.provider}`);
}

// ----------------------------------------------------------------------------
// Stripe
// ----------------------------------------------------------------------------
async function stripeGet<T>(path: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY ausente.");
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`Stripe ${path}: ${j.error?.message ?? r.statusText}`);
  return j as T;
}

async function stripePost<T>(path: string, body: Record<string, string | number>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY ausente.");
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) u.set(k, String(v));
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: u.toString(),
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`Stripe ${path}: ${j.error?.message ?? r.statusText}`);
  return j as T;
}

async function refundStripe(input: RefundInput): Promise<RefundResult> {
  if (!input.subscriptionId) throw new Error("Stripe: subscriptionId ausente.");
  const sub = await stripeGet<any>(`/subscriptions/${input.subscriptionId}`);
  const invoiceId = sub.latest_invoice;
  if (!invoiceId) throw new Error("Stripe: assinatura sem fatura.");
  const invoice = await stripeGet<any>(`/invoices/${invoiceId}`);
  const paymentIntent = invoice.payment_intent;
  if (!paymentIntent) throw new Error("Stripe: fatura sem payment_intent.");

  const body: Record<string, string | number> = { payment_intent: paymentIntent };
  if (input.amount && input.amount > 0) body.amount = Math.round(input.amount);
  if (input.reason) body["metadata[reason]"] = input.reason.slice(0, 500);

  const refund = await stripePost<any>("/refunds", body);
  return {
    ok: true,
    provider: "stripe",
    refundId: String(refund.id),
    amount: typeof refund.amount === "number" ? refund.amount : null,
    status: String(refund.status ?? "succeeded"),
  };
}

// ----------------------------------------------------------------------------
// Asaas
// ----------------------------------------------------------------------------
async function asaasReq<T>(
  path: string,
  init?: { method?: string; body?: Record<string, unknown> },
): Promise<T> {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY ausente.");
  const env = (process.env.ASAAS_ENV || "production").toLowerCase();
  const base = env === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://api.asaas.com/v3";
  const r = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: { access_token: key, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`Asaas ${path}: ${JSON.stringify(j)}`);
  return j as T;
}

async function refundAsaas(input: RefundInput): Promise<RefundResult> {
  if (!input.subscriptionId) throw new Error("Asaas: subscriptionId ausente.");
  const payments = await asaasReq<{ data: Array<any> }>(
    `/payments?subscription=${encodeURIComponent(input.subscriptionId)}&status=CONFIRMED&limit=10`,
  );
  const paid = payments.data?.find((p) => p.status === "CONFIRMED" || p.status === "RECEIVED");
  if (!paid) throw new Error("Asaas: nenhum pagamento confirmado para estornar.");

  const body: Record<string, unknown> = {};
  if (input.amount && input.amount > 0) body.value = input.amount;
  if (input.reason) body.description = input.reason.slice(0, 500);

  const refund = await asaasReq<any>(`/payments/${paid.id}/refund`, {
    method: "POST",
    body,
  });
  return {
    ok: true,
    provider: "asaas",
    refundId: String(refund.id ?? paid.id),
    amount: typeof refund.value === "number" ? refund.value : null,
    status: String(refund.status ?? "REFUNDED"),
  };
}
