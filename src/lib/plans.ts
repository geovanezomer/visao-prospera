// ============================================================================
// Catálogo de planos do FinnancePRO.
// Os price IDs ficam no .env (VITE_*) para centralizar a configuração e
// permitir trocar IDs sem alterar código. Atualize o .env após sincronizar
// produtos no Stripe.
// ============================================================================

export type PlanId = "mensal" | "anual" | "vitalicio";

export type PlanConfig = {
  id: PlanId;
  priceId: string;
  name: string;
  price: string;
  period: string;
  mode: "subscription" | "payment";
};

export const PLANS_CATALOG: Record<PlanId, PlanConfig> = {
  mensal: {
    id: "mensal",
    priceId: import.meta.env.VITE_STRIPE_PRICE_MENSAL ?? "plano_mensal_recorrente",
    name: "Mensal",
    price: "R$ 197",
    period: "/mês",
    mode: "subscription",
  },
  anual: {
    id: "anual",
    priceId: import.meta.env.VITE_STRIPE_PRICE_ANUAL ?? "plano_anual_recorrente",
    name: "Anual",
    price: "R$ 1.497",
    period: "/ano",
    mode: "subscription",
  },
  vitalicio: {
    id: "vitalicio",
    priceId: import.meta.env.VITE_STRIPE_PRICE_VITALICIO ?? "plano_vitalicio_unico",
    name: "Vitalício",
    price: "R$ 4.997",
    period: "pagamento único",
    mode: "payment",
  },
};

/** Mapa reverso: priceId -> PlanId. Usado no webhook para classificar. */
export function planIdFromPriceId(priceId: string): PlanId {
  for (const p of Object.values(PLANS_CATALOG)) {
    if (p.priceId === priceId) return p.id;
  }
  // Fallback heurístico
  if (priceId.includes("vitalic")) return "vitalicio";
  if (priceId.includes("anual") || priceId.includes("year")) return "anual";
  return "mensal";
}
