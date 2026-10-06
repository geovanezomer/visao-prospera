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
 *  - IRRF: tabela da Lei 15.191/2025 (vigente desde maio/2025), mantida em
 *    2026 — a Lei 15.270/2025 não alterou a tabela, criou um redutor
 *    (ver `redutorLei15270` em rescisao.ts).
 */

export const ANO_VIGENTE = 2026;

export interface InssFaixa {
  readonly ate: number;
  readonly aliquota: number;
}

export interface IrrfFaixa {
  readonly ate: number;
  readonly aliquota: number;
  readonly deduzir: number;
}

export interface TabelaAno {
  readonly salarioMinimo: number;
  readonly inssTeto: number;
  readonly inssFaixas: readonly InssFaixa[];
  readonly salarioFamiliaCota: number;
  readonly salarioFamiliaLimite: number;
  /** DAS mensal do MEI — serviços (INSS 5% × SM + ISS R$ 5). */
  readonly meiDasServicos: number;
  /** Tabela progressiva mensal do IRRF. */
  readonly irrfFaixas: readonly IrrfFaixa[];
  /** Dedução mensal por dependente no IRRF. */
  readonly irrfDependente: number;
  /** Desconto simplificado mensal (substitui as deduções legais quando melhor). */
  readonly irrfDescontoSimplificado: number;
}

/** Lei 15.191/2025 — vigente desde maio/2025 e em 2026. */
const IRRF_LEI_15191: readonly IrrfFaixa[] = [
  { ate: 2428.8, aliquota: 0.0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
];

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
    // Jan–abr/2025 vigorou a tabela da Lei 14.848/2024; usamos a de maio em diante.
    irrfFaixas: IRRF_LEI_15191,
    irrfDependente: 189.59,
    irrfDescontoSimplificado: 607.2,
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
    irrfFaixas: IRRF_LEI_15191,
    irrfDependente: 189.59,
    irrfDescontoSimplificado: 607.2,
  },
};

/** Retorna as tabelas do ano solicitado (fallback: ano vigente). */
export function getTabelas(ano: number = ANO_VIGENTE): TabelaAno {
  return TABELAS[ano] ?? TABELAS[ANO_VIGENTE];
}
