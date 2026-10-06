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
import type {
  StripeSubscription,
  StripeInvoice,
  StripeRefund,
  AsaasPayment,
  AsaasRefund,
} from "./_remote-types";

type StripeErrJson = { error?: { message?: string } };
type AsaasErrJson = Record<string, unknown>;

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
  // Carrega config do provider do banco (sem mutar process.env) e usa
  // localmente nos helpers do refund.
  const { loadProviderConfig } = await import("./index");
  if (input.provider === "stripe") {
    const cfg = await loadProviderConfig("stripe");
    return refundStripe(input, cfg?.apiKey ?? process.env.STRIPE_SECRET_KEY ?? "");
  }
  if (input.provider === "asaas") {
    const cfg = await loadProviderConfig("asaas");
    const apiKey = cfg?.apiKey ?? process.env.ASAAS_API_KEY ?? "";
    const mode = cfg?.mode ?? (process.env.ASAAS_ENV === "sandbox" ? "sandbox" : "live");
    return refundAsaas(input, apiKey, mode);
  }
  throw new Error(`Provedor não suportado para estorno: ${input.provider}`);
}

// ----------------------------------------------------------------------------
// Stripe
// ----------------------------------------------------------------------------
async function stripeGet<T>(apiKey: string, path: string): Promise<T> {
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY ausente.");
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const j = (await r.json()) as T & StripeErrJson;
  if (!r.ok) throw new Error(`Stripe ${path}: ${j.error?.message ?? r.statusText}`);
  return j as T;
}

async function stripePost<T>(
  apiKey: string,
  path: string,
  body: Record<string, string | number>,
): Promise<T> {
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY ausente.");
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) u.set(k, String(v));
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: u.toString(),
  });
  const j = (await r.json()) as T & StripeErrJson;
  if (!r.ok) throw new Error(`Stripe ${path}: ${j.error?.message ?? r.statusText}`);
  return j as T;
}

async function refundStripe(input: RefundInput, apiKey: string): Promise<RefundResult> {
  if (!input.subscriptionId) throw new Error("Stripe: subscriptionId ausente.");
  const sub = await stripeGet<StripeSubscription>(apiKey, `/subscriptions/${input.subscriptionId}`);
  const invoiceId = sub.latest_invoice;
  if (!invoiceId) throw new Error("Stripe: assinatura sem fatura.");
  const invoice = await stripeGet<StripeInvoice>(apiKey, `/invoices/${invoiceId}`);
  const paymentIntent = invoice.payment_intent;
  if (!paymentIntent) throw new Error("Stripe: fatura sem payment_intent.");

  const body: Record<string, string | number> = { payment_intent: paymentIntent };
  if (input.amount && input.amount > 0) body.amount = Math.round(input.amount);
  if (input.reason) body["metadata[reason]"] = input.reason.slice(0, 500);

  const refund = await stripePost<StripeRefund>(apiKey, "/refunds", body);
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
  apiKey: string,
  mode: "live" | "sandbox",
  path: string,
  init?: { method?: string; body?: Record<string, unknown> },
): Promise<T> {
  if (!apiKey) throw new Error("ASAAS_API_KEY ausente.");
  const base = mode === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://api.asaas.com/v3";
  const r = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: { access_token: apiKey, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const j = (await r.json()) as T & AsaasErrJson;
  if (!r.ok) throw new Error(`Asaas ${path}: ${JSON.stringify(j)}`);
  return j as T;
}

async function refundAsaas(
  input: RefundInput,
  apiKey: string,
  mode: "live" | "sandbox",
): Promise<RefundResult> {
  if (!input.subscriptionId) throw new Error("Asaas: subscriptionId ausente.");
  const payments = await asaasReq<{ data: AsaasPayment[] }>(
    apiKey,
    mode,
    `/payments?subscription=${encodeURIComponent(input.subscriptionId)}&status=CONFIRMED&limit=10`,
  );
  const paid = payments.data?.find((p) => p.status === "CONFIRMED" || p.status === "RECEIVED");
  if (!paid) throw new Error("Asaas: nenhum pagamento confirmado para estornar.");

  const body: Record<string, unknown> = {};
  if (input.amount && input.amount > 0) body.value = input.amount;
  if (input.reason) body.description = input.reason.slice(0, 500);

  const refund = await asaasReq<AsaasRefund>(apiKey, mode, `/payments/${paid.id}/refund`, {
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

// ============================================================================
// refundAndRevoke — orquestração: estorno + (opcional) cancelamento imediato.
//
// Estornos manuais raramente disparam webhook de cancelamento; sem esta
// orquestração a assinatura fica "active" no banco mesmo após devolvermos o
// dinheiro. Cada etapa roda em try/catch independente para NÃO desfazer o
// estorno já executado se o cancelamento falhar — o admin vê o resultado
// composto e trata manualmente o que sobrou.
// ============================================================================

export type StepStatus = { ok: true; detail?: string } | { ok: false; error: string };

export type RefundAndRevokeResult = {
  refund: StepStatus & { data?: RefundResult };
  revoke: StepStatus;
  dbUpdate: StepStatus;
  audit: StepStatus;
  email: StepStatus;
};

export type RefundAndRevokeInput = RefundInput & {
  revoke: boolean;
  userId: string;
  actorId: string;
};

export async function refundAndRevoke(input: RefundAndRevokeInput): Promise<RefundAndRevokeResult> {
  const result: RefundAndRevokeResult = {
    refund: { ok: false, error: "not-run" },
    revoke: { ok: true, detail: "skipped" },
    dbUpdate: { ok: true, detail: "skipped" },
    audit: { ok: true, detail: "skipped" },
    email: { ok: true, detail: "skipped" },
  };

  // (a) refund — se falhar, aborta o resto (nada a revogar sem estorno)
  try {
    const refund = await refundLastPayment(input);
    result.refund = { ok: true, data: refund };
  } catch (e) {
    result.refund = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return result;
  }

  if (!input.revoke) return result;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // (b1) cancelamento imediato no provedor
  if (input.subscriptionId) {
    try {
      const { cancelSubscriptionNow } = await import("./cancelCore.server");
      await cancelSubscriptionNow({
        provider: input.provider,
        subscriptionId: input.subscriptionId,
      });
      result.revoke = { ok: true };
    } catch (e) {
      result.revoke = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    result.revoke = { ok: false, error: "subscriptionId ausente" };
  }

  // (b2) atualiza subscriptions no banco — INDEPENDENTE do sucesso do provider,
  // pois estornamos o dinheiro; o acesso tem de cair mesmo se o provider
  // rejeitar (ex.: assinatura já cancelada). O admin vê ambos os status.
  try {
    const patch = {
      status: "canceled" as const,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    };
    const q = supabaseAdmin.from("subscriptions").update(patch).eq("user_id", input.userId);

    const { error } = input.subscriptionId
      ? await q.eq("stripe_subscription_id", input.subscriptionId)
      : await q;
    if (error) throw new Error(error.message);
    result.dbUpdate = { ok: true };
  } catch (e) {
    result.dbUpdate = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // (b3) evento sintético em webhook_events (trilha de auditoria)
  try {
    const refundData = "data" in result.refund ? result.refund.data : undefined;
    const { error } = await supabaseAdmin.from("webhook_events").insert({
      provider: "admin",
      event_type: "admin.refund_revoke",
      subscription_id: input.subscriptionId,
      status: "processed",
      payload: {
        refundId: refundData?.refundId ?? null,
        amount: refundData?.amount ?? null,
        actorId: input.actorId,
        userId: input.userId,
        provider: input.provider,
        reason: input.reason ?? null,
        revokeStep: result.revoke,
        dbUpdateStep: result.dbUpdate,
      },
    });
    if (error) throw new Error(error.message);
    result.audit = { ok: true };
  } catch (e) {
    result.audit = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // (c) e-mail de estorno ao cliente (template "refund" já existente)
  try {
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan, stripe_subscription_id")
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(input.userId);
    const email = userRes?.user?.email;
    if (email) {
      const { getEmailConfig, getTemplate, renderTemplate } =
        await import("./lifecycleEmails.server");
      const cfg = await getEmailConfig(supabaseAdmin);
      const tpl = await getTemplate(supabaseAdmin, "refund");
      if (cfg && tpl) {
        const meta = (userRes?.user?.user_metadata ?? {}) as Record<string, unknown>;
        const name =
          (typeof meta.display_name === "string" && meta.display_name) ||
          email.split("@")[0] ||
          "Cliente";
        const refundData = "data" in result.refund ? result.refund.data : undefined;
        const vars: Record<string, string> = {
          name,
          plan: sub?.plan ?? "",
          amount: refundData?.amount != null ? String(refundData.amount) : "",
          reason: input.reason ?? "",
        };
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: cfg.from,
            to: email,
            subject: renderTemplate(tpl.subject, vars),
            html: renderTemplate(tpl.html, vars),
          }),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}`);
        result.email = { ok: true };
      } else {
        result.email = {
          ok: false,
          error: cfg ? "template refund desabilitado" : "email não configurado",
        };
      }
    } else {
      result.email = { ok: false, error: "usuário sem e-mail" };
    }
  } catch (e) {
    result.email = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return result;
}
