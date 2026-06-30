// =====================================================================
// SSOT — rótulo/valor/tone para indicadores de alavancagem (DL/EBITDA,
// DL/EBIT, DL/PL). Centraliza tratamento de:
//   - cash-rich (Dívida Líquida < 0) → "Posição Líquida de Caixa" + tone "pos".
//   - prejuízo / base ≤ 0 → ratio indefinido, exibe "—".
//   - thresholds clássicos por métrica.
// Usado por IndicatorsCard e IndicatorsTab para evitar divergências.
// =====================================================================

export type LeverageMetric = "ebitda" | "ebit" | "pl";

export interface LeverageDisplay {
  /** Rótulo do card — substituído por "Posição Líquida de Caixa" quando cash-rich. */
  label: string;
  /** Valor formatado pronto para render. */
  value: string;
  /** Cor do card. */
  tone: "pos" | "neg";
  /** Chip opcional (e.g. "Cash-rich") — null quando não aplicável. */
  chip: string | null;
  /** Override de descrição/fórmula no tooltip (cash-rich explica numerador). */
  desc?: string;
  /** Override da fórmula exibida no tooltip. */
  formula?: string;
  /** Memória de cálculo — fórmula resolvida com os números atuais. */
  calc?: string;
}

const THRESHOLDS: Record<LeverageMetric, number> = {
  ebitda: 3,
  ebit: 4,
  pl: 1,
};

const DEFAULT_LABEL: Record<LeverageMetric, string> = {
  ebitda: "Dívida Líq. / EBITDA",
  ebit: "Dívida Líq. / EBIT",
  pl: "Dívida Líq. / PL",
};

/**
 * @param metric   qual indicador (ebitda/ebit/pl).
 * @param ratio    Indicators.dividaLiqEbitda | dividaLiqEbit | dividaLiqPl (já clipado).
 * @param dividaLiquida  Indicators.dividaLiquida (negativo = cash-rich).
 * @param base     valor anual da base (EBITDA / EBIT / PL) p/ distinguir "—" de "0".
 */
export function leverageDisplay(
  metric: LeverageMetric,
  ratio: number,
  dividaLiquida: number,
  base: number,
): LeverageDisplay {
  // Observação: tratamento "cash-rich" (Dívida Líquida < 0) foi removido a
  // pedido do usuário. O card agora exibe sempre o múltiplo padrão; quando
  // a dívida líquida é negativa, o ratio será negativo (tone "pos").
  if (!(base > 0)) {
    return {
      label: DEFAULT_LABEL[metric],
      value: dividaLiquida === 0 ? "0,0×" : "—",
      tone: dividaLiquida === 0 ? "pos" : "neg",
      chip: dividaLiquida > 0 && base <= 0 ? "Sem geração" : null,
    };
  }
  const threshold = THRESHOLDS[metric];
  return {
    label: DEFAULT_LABEL[metric],
    value: `${ratio.toFixed(2)}×`,
    tone: ratio <= threshold ? "pos" : "neg",
    chip: null,
  };
}
