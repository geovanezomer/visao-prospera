// ============================================================================
// Seletor do provedor de pagamentos.
//
// Estratégia (em ordem):
//   1. PAYMENT_PROVIDER=stripe|asaas  → escolha explícita (recomendado).
//   2. Se ausente: detecta pelas chaves presentes (STRIPE_SECRET_KEY ou
//      ASAAS_API_KEY). Garante o padrão "comentou a linha → desligou".
//
// Lê env DENTRO da função (Cloudflare/VPS bindam env por request).
// ============================================================================

import type { PaymentProvider, ProviderName } from "./types";

let _cached: PaymentProvider | null = null;

export function getProvider(): PaymentProvider {
  if (_cached) return _cached;

  const explicit = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  const hasStripe = !!process.env.STRIPE_SECRET_KEY;
  const hasAsaas = !!process.env.ASAAS_API_KEY;

  let choice: ProviderName | null = null;
  if (explicit === "stripe" || explicit === "asaas") {
    choice = explicit as ProviderName;
  } else if (hasStripe) {
    choice = "stripe";
  } else if (hasAsaas) {
    choice = "asaas";
  }

  if (!choice) {
    throw new Error(
      "Nenhum provedor de pagamento configurado. Defina PAYMENT_PROVIDER no .env " +
        "ou forneça STRIPE_SECRET_KEY / ASAAS_API_KEY.",
    );
  }

  // Import dinâmico evita carregar SDK do provedor inativo.
  if (choice === "stripe") {
    const { StripeProvider } = require("./stripe") as typeof import("./stripe");
    _cached = new StripeProvider();
  } else {
    const { AsaasProvider } = require("./asaas") as typeof import("./asaas");
    _cached = new AsaasProvider();
  }
  return _cached;
}

/** Resolve o priceId/planId nativo do provedor ativo. Lê do .env. */
export function getProviderPlanRef(plan: "starter" | "pro"): string {
  const provider = getProvider().name;
  const key =
    provider === "stripe"
      ? plan === "starter"
        ? "STRIPE_PRICE_STARTER"
        : "STRIPE_PRICE_PRO"
      : plan === "starter"
        ? "ASAAS_PLAN_STARTER"
        : "ASAAS_PLAN_PRO";
  const value = process.env[key];
  if (!value) throw new Error(`Variável ${key} não configurada no .env`);
  return value;
}

export type { PaymentProvider, NormalizedEvent, PlanId, ProviderName } from "./types";
