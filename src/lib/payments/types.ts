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
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;

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
