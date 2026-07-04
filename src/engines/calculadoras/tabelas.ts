/**
 * Tabelas trabalhistas/previdenciárias VERSIONADAS por ano.
 *
 * SSOT único das constantes que mudam anualmente por Portaria
 * Interministerial MPS/MF (salário mínimo, faixas INSS, salário-família,
 * MEI DAS). Sempre que a Portaria do próximo ano for publicada, basta
 * adicionar UMA nova entrada em `TABELAS` e apontar `ANO_VIGENTE` — todo
 * o resto do sistema (calculadoras + UI) recalcula sozinho.
 *
 * Fontes:
 *  - 2025: Portaria Interministerial MPS/MF nº 6, de 10/01/2025.
 *  - 2026: Portaria Interministerial MPS/MF nº 13, de 09/01/2026.
 */

export const ANO_VIGENTE = 2026;

export interface InssFaixa {
  readonly ate: number;
  readonly aliquota: number;
}

export interface TabelaAno {
  readonly salarioMinimo: number;
  readonly inssTeto: number;
  readonly inssFaixas: readonly InssFaixa[];
  readonly salarioFamiliaCota: number;
  readonly salarioFamiliaLimite: number;
  /** DAS mensal do MEI — serviços (INSS 5% × SM + ISS R$ 5). */
  readonly meiDasServicos: number;
}

export const TABELAS: Readonly<Record<number, TabelaAno>> = {
  2025: {
    salarioMinimo: 1518.0,
    inssTeto: 8157.41,
    inssFaixas: [
      { ate: 1518.0, aliquota: 0.075 },
      { ate: 2793.88, aliquota: 0.09 },
      { ate: 4190.83, aliquota: 0.12 },
      { ate: 8157.41, aliquota: 0.14 },
    ],
    salarioFamiliaCota: 65.0,
    salarioFamiliaLimite: 1906.04,
    meiDasServicos: 80.9,
  },
  2026: {
    // Portaria Interministerial MPS/MF nº 13, de 09/01/2026.
    salarioMinimo: 1621.0,
    inssTeto: 8475.55,
    inssFaixas: [
      { ate: 1621.0, aliquota: 0.075 },
      { ate: 2902.84, aliquota: 0.09 },
      { ate: 4354.27, aliquota: 0.12 },
      { ate: 8475.55, aliquota: 0.14 },
    ],
    salarioFamiliaCota: 67.54,
    salarioFamiliaLimite: 1980.38,
    // 5% × R$ 1.621 = R$ 81,05 + ISS R$ 5,00 = R$ 86,05.
    meiDasServicos: 86.05,
  },
};

/** Retorna as tabelas do ano solicitado (fallback: ano vigente). */
export function getTabelas(ano: number = ANO_VIGENTE): TabelaAno {
  return TABELAS[ano] ?? TABELAS[ANO_VIGENTE];
}
