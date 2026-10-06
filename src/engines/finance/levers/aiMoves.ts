// =====================================================================
// aiMoves.ts — Catálogo WHITELISTED de "movimentos" propositivos que a IA
// pode sugerir. Cada move tem:
//   - id  → identificador estável (vai no JSON da IA)
//   - label/description → consumidos pelo prompt + UI
//   - magnitude → faixa numérica permitida (mantém IA dentro do razoável)
//   - toParams(magnitude) → compila para Partial<SimulatorParams>
//
// REGRA DE OURO: a IA NÃO emite valores diretos de slider. Ela escolhe
// um move e uma magnitude. O engine traduz para params validados — isso
// impede que a IA proponha cenários absurdos (ex: priceDeltaPct: 9999).
// =====================================================================

import type { SimulatorParams } from "../simulator";

export interface AiMove {
  id: string;
  label: string;
  /** Texto que vai no prompt da IA explicando o efeito. */
  description: string;
  /** Unidade da magnitude (mostrada à IA e ao usuário). */
  unit: "pct" | "dias" | "BRL";
  /** Faixa permitida [min, max]. Magnitude fora é clipada. */
  range: [number, number];
  /** Mapeia magnitude validada → Partial<SimulatorParams>. */
  toParams: (magnitude: number) => Partial<SimulatorParams>;
}

export const AI_MOVE_CATALOG: AiMove[] = [
  {
    id: "corte_custos_fixos",
    label: "Cortar custos fixos (top 3 rubricas)",
    description: "Reduz as 3 maiores rubricas fixas em % indicado. Efeito imediato no EBITDA.",
    unit: "pct",
    range: [5, 30],
    toParams: (m) => ({ fixedCutPct: m, fixedCutTopN: 3 }),
  },
  {
    id: "repasse_preco",
    label: "Repasse de preço",
    description:
      "Ajusta preço de venda em %. Positivo = aumento, negativo = desconto. Avalia elasticidade.",
    unit: "pct",
    range: [-15, 15],
    toParams: (m) => ({ priceDeltaPct: m }),
  },
  {
    id: "ajuste_volume",
    label: "Ajuste de volume vendido",
    description:
      "Ajusta volume em %. Mexe receita + CPV variável juntos (mais conservador que preço).",
    unit: "pct",
    range: [-30, 30],
    toParams: (m) => ({ volumeDeltaPct: m }),
  },
  {
    id: "reduzir_cpv",
    label: "Renegociar Custo de Vendas (CMV/CPV)",
    description: "Ajusta linhas de custo direto em %. Negativo = corte por renegociação.",
    unit: "pct",
    range: [-25, 10],
    toParams: (m) => ({ cpvDeltaPct: m }),
  },
  {
    id: "ajuste_folha",
    label: "Ajuste da folha CLT",
    description:
      "Reescala todas as linhas com encargos automáticos em %. Negativo = corte de folha.",
    unit: "pct",
    range: [-25, 10],
    toParams: (m) => ({ payrollDeltaPct: m }),
  },
  {
    id: "reduzir_pmr",
    label: "Reduzir PMR (prazo de recebimento)",
    description: "Reduz prazo de recebimento em N dias. Acelera entrada de caixa (NCG menor).",
    unit: "dias",
    range: [5, 45],
    toParams: (m) => ({ pmrDeltaDays: -Math.abs(m) }),
  },
  {
    id: "aumentar_pmp",
    label: "Aumentar PMP (prazo de pagamento a fornecedores)",
    description: "Negocia prazo maior com fornecedores em N dias. Posterga saídas de caixa.",
    unit: "dias",
    range: [5, 45],
    toParams: (m) => ({ pmpDeltaDays: Math.abs(m) }),
  },
  {
    id: "captar_emprestimo_giro",
    label: "Captar empréstimo de capital de giro",
    description:
      "Captação no mês 1 (PRICE 12m @ 2%a.m. — taxa padrão). Magnitude = principal em R$.",
    unit: "BRL",
    range: [10_000, 2_000_000],
    toParams: (m) => ({ loanPrincipal: m, loanRatePctAm: 2, loanTermMonths: 12 }),
  },
  {
    id: "quitar_divida",
    label: "Quitar parte da dívida (uso de caixa)",
    description: "Quita % do principal da dívida no mês 1. Reduz juros futuros.",
    unit: "pct",
    range: [10, 100],
    toParams: (m) => ({ debtPaydownPct: m }),
  },
];

const MOVE_BY_ID = new Map(AI_MOVE_CATALOG.map((m) => [m.id, m]));

export function getAiMove(id: string): AiMove | undefined {
  return MOVE_BY_ID.get(id);
}

/**
 * Valida uma proposta vinda da IA e compila para Partial<SimulatorParams>.
 * Retorna null se moveId desconhecido ou magnitude inválida.
 * Clipa magnitudes fora do range (mantém dentro da faixa segura).
 */
export function compileAiMove(
  moveId: string,
  magnitude: unknown,
): { params: Partial<SimulatorParams>; magnitude: number; move: AiMove } | null {
  const move = MOVE_BY_ID.get(moveId);
  if (!move) return null;
  const n = typeof magnitude === "number" ? magnitude : Number(magnitude);
  if (!Number.isFinite(n)) return null;
  const [min, max] = move.range;
  const clipped = Math.max(min, Math.min(max, n));
  return { params: move.toParams(clipped), magnitude: clipped, move };
}

/** Render do catálogo para o prompt da IA. */
export function describeMoveCatalogForPrompt(): string {
  return AI_MOVE_CATALOG.map(
    (m) =>
      `- "${m.id}" — ${m.label}. ${m.description} Unidade: ${m.unit}. Faixa: ${m.range[0]}..${m.range[1]}.`,
  ).join("\n");
}
