// ============================================================================
// Shapes mínimos das respostas remotas (Stripe / Asaas) que efetivamente
// consumimos. NÃO replica a API inteira de propósito — só os campos lidos
// pelo código. Se um campo novo passar a ser usado, adicione aqui.
// ============================================================================

// ─────────────── Stripe ───────────────────────────────────────────────────
export type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  items?: {
    data: Array<{
      price?: { id?: string | null } | null;
    }>;
  };
  latest_invoice?: string | null;
};

export type StripeInvoice = {
  id: string;
  amount_paid?: number | null;
  charge?: string | null;
  payment_intent?: string | null;
  status?: string | null;
};

export type StripeRefund = {
  id: string;
  amount: number;
  status: string;
  charge?: string | null;
  payment_intent?: string | null;
  created?: number;
};

// ─────────────── Asaas ────────────────────────────────────────────────────
export type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  customer?: string;
  subscription?: string | null;
  dateCreated?: string;
  billingType?: string;
};

export type AsaasRefund = {
  id: string;
  status: string;
  value: number;
  refundedValue?: number;
  description?: string;
  dateCreated?: string;
};

// ─────────────── Webhook payloads brutos (subset consumido) ──────────────
// Apenas os campos que o parseEvent lê. Mantém validação local (switch +
// ?.) — payload final externo é JSON dinâmico, não cabe contrato 100% rígido.

export type StripeWebhookObject = {
  customer_email?: string;
  customer_details?: { email?: string };
  customer?: string;
  subscription?: string;
  payment_intent?: string;
  id?: string;
  mode?: string;
  metadata?: { plan?: string };
  items?: {
    data?: Array<{
      price?: { lookup_key?: string; id?: string } | null;
      current_period_end?: number;
    }>;
  };
  current_period_end?: number;
  trial_end?: number;
  status?: "active" | "canceled" | "incomplete" | "past_due" | "trialing" | string;
};
export type StripeWebhookEvent = { type: string; data: { object: StripeWebhookObject } };

export type AsaasWebhookPayment = {
  id?: string;
  customer?: string;
  customerEmail?: string;
  subscription?: string;
  externalReference?: string;
  value?: number | string;
  dueDate?: string;
};
export type AsaasWebhookSubscription = {
  id?: string;
  customer?: string;
  externalReference?: string;
  value?: number | string;
  status?: string;
  nextDueDate?: string;
};
export type AsaasWebhookEvent = {
  event: string;
  payment?: AsaasWebhookPayment;
  subscription?: AsaasWebhookSubscription;
};
