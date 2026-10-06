// ============================================================================
// PLANS_FALLBACK — planos vigentes hardcoded, espelho da tabela `plans`.
//
// ATUALIZAR MANUALMENTE quando os preços mudarem no Admin — usado APENAS
// quando o banco está indisponível (loader falha ou devolve lista vazia).
// Evita renderizar a landing sem preços em campanhas pagas.
//
// Formato = shape de PlanRow (camelCase) que a landing já mapeia.
// ============================================================================
import type { PlanRow } from "@/lib/admin/plans.functions";

export const PLANS_FALLBACK: PlanRow[] = [
  {
    id: "fallback-starter",
    slug: "starter",
    name: "Mensal",
    description: "Acesso completo ao FinnancePRO mês a mês.",
    priceCents: 500,
    currency: "BRL",
    interval: "one_time",
    features: [
      "DRE, Balanço e Fluxo de Caixa",
      "Simulador CBS/IBS",
      "40+ indicadores",
      "Cálculos trabalhistas",
      "Análises com I.A.",
    ],
    limits: {},
    stripePriceId: null,
    asaasPlanRef: null,
    active: true,
    sortOrder: 1,
    upsellEnabled: false,
    upsellName: null,
    upsellDescription: null,
    upsellPriceCents: 0,
    upsellStripePriceId: null,
    upsellAsaasRef: null,
  },
  {
    id: "fallback-pro",
    slug: "pro",
    name: "Anual",
    description: "Tudo do plano Mensal com 2 meses grátis.",
    priceCents: 97000,
    currency: "BRL",
    interval: "year",
    features: ["Tudo do plano Mensal", "Economia equivalente a 2 meses", "Suporte prioritário"],
    limits: {},
    stripePriceId: null,
    asaasPlanRef: null,
    active: true,
    sortOrder: 2,
    upsellEnabled: false,
    upsellName: null,
    upsellDescription: null,
    upsellPriceCents: 0,
    upsellStripePriceId: null,
    upsellAsaasRef: null,
  },
];
