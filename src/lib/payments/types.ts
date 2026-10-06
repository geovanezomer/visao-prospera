// ============================================================================
// Tipos comuns da camada de pagamentos.
//
// Toda lógica do app fala APENAS com esta interface. Trocar de provedor
// (Stripe ↔ Asaas) = mudar PAYMENT_PROVIDER no .env e reiniciar o container.
// ============================================================================

/** Identificadores estáveis de plano (slug). Aceita qualquer slug do CRUD admin. */
export type PlanId = string;

/** Provedor ativo no boot. */
export type ProviderName = "stripe" | "asaas";

/**
 * Configuração por requisição/escopo — passada para o provider em vez de
 * mutar `process.env` global. Cada instância carrega suas próprias chaves
 * e webhook secret, eliminando o risco de vazamento entre requisições
 * concorrentes em ambientes edge.
 */
export type ProviderConfig = {
  apiKey: string;
  webhookSecret?: string | null;
  /** "live" | "sandbox" — usado pelo Asaas para escolher a URL base. */
  mode?: "live" | "sandbox" | null;
};

/** Evento normalizado vindo do webhook do provedor. */
export type NormalizedEvent =
  | {
      type: "subscription.activated";
      email: string;
      customerId: string;
      subscriptionId: string;
      plan: PlanId;
      currentPeriodEnd: string | null; // ISO
    }
  | {
      type: "subscription.updated";
      customerId: string;
      subscriptionId: string;
      plan: PlanId;
      status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
      currentPeriodEnd: string | null;
    }
  | {
      type: "subscription.canceled";
      customerId: string;
      subscriptionId: string;
    }
  | {
      type: "subscription.past_due";
      customerId: string;
      subscriptionId: string;
    }
  | {
      type: "subscription.trial_will_end";
      customerId: string;
      subscriptionId: string;
      trialEnd: string | null;
    }
  | { type: "ignored"; reason: string };

/** Contrato único que cada provedor (Stripe, Asaas) deve implementar. */
export interface PaymentProvider {
  /** Nome do provedor — usado em logs e na coluna `provider` do banco. */
  readonly name: ProviderName;

  /**
   * Cria uma sessão de checkout hospedada pelo provedor e retorna a URL
   * para a qual o navegador deve ser redirecionado.
   *
   * `email` é o identificador do comprador (usado pelo magic link).
   * `successUrl`/`cancelUrl` são as páginas de retorno do nosso app.
   */
  createCheckout(input: {
    plan: PlanId;
    email: string;
    /** Nome completo do comprador (coletado no formulário). */
    name?: string;
    /** CPF/CNPJ (apenas dígitos) — coletado para auditoria/compatibilidade do checkout. */
    cpfCnpj?: string;
    /** Telefone BR (apenas dígitos). */
    phone?: string;
    successUrl: string;
    cancelUrl: string;
    /** Intervalo de recorrência. "one_time" gera cobrança única. */
    interval?: "month" | "year" | "week" | "day" | "lifetime" | "one_time";
    /** Preço em centavos — usado quando não há providerRef pré-configurado. */
    priceCents?: number;
    /** Moeda ISO-4217 (ex. "BRL", "USD"). Default: "BRL". */
    currency?: string;
    /** Referência no provedor (Stripe price_id ou Asaas plan ref). */
    providerRef?: string | null;
    /** Nome legível do plano (description/product_data). */
    planName?: string;
    /** Upsell opcional adicionado pelo comprador no checkout. */
    upsell?: {
      name: string;
      priceCents: number;
      stripePriceId?: string | null;
      asaasRef?: string | null;
    } | null;
    /**
     * Chave de idempotência — quando presente, o provedor deve garantir
     * que a mesma chave não cria recursos duplicados (Stripe:
     * header `Idempotency-Key`; Asaas: header `idempotency-key`).
     */
    idempotencyKey?: string;
  }): Promise<{
    url: string;
    providerSessionId?: string | null;
    providerCustomerId?: string | null;
  }>;

  /**
   * Cria uma sessão do Portal do Cliente (cancelamento, troca de cartão,
   * faturas, NF) e retorna a URL externa. O usuário abre em nova aba.
   */
  createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;

  /**
   * Valida assinatura/token do webhook e devolve um evento normalizado.
   * DEVE lançar `Error` se a verificação falhar.
   */
  verifyWebhook(req: Request, rawBody: string): Promise<NormalizedEvent>;
}
