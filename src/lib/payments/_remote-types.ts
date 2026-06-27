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
