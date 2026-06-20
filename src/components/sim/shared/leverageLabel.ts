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
  // Cash-rich domina: sobreposição independe da base ser positiva ou não.
  // Removemos o múltiplo entre parênteses porque ele representa |DL|/base
  // (EBITDA/EBIT/PL), e não Caixa/Dívida — gerava confusão de leitura.
  if (dividaLiquida < 0) {
    return {
      label: "Posição Líquida de Caixa",
      value: "Caixa supera a dívida",
      tone: "pos",
      chip: "Cash-rich",
    };
  }
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
