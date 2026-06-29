// =====================================================================
// DUPONT — Decomposição do ROE em 3 e 5 fatores.
// Submódulo coeso da engine financeira — função pura, zero UI.
//
// 3 Fatores:  ROE = Margem Líquida × Giro do Ativo × MAF
// 5 Fatores:  ROE = Margem EBIT × Giro × MAF × Carga Financeira × Carga Tributária
//   onde: Carga Financeira = LAIR ÷ EBIT,  Carga Tributária = LL ÷ LAIR
//
// Reusa SOMENTE valores já calculados em `Indicators` e `DRE` (SSOT).
// =====================================================================
import type { AppState } from "./types";
import type { DRE } from "./dre";
import type { Indicators } from "./indicators";
import { sum } from "./format";
import { safeDivide } from "./safeMath";

export interface DupontModel {
  // Bases (valores anuais já calculados pela engine)
  receitaLiquida: number;
  ebit: number;
  lair: number;
  lucroLiquido: number;
  ativoTotalMedio: number;
  plMedio: number;

  // 3 fatores (frações 0..1 e ratio para MAF)
  margemLiquida: number;       // LL / RL
  giroAtivo: number;           // RL / AT_medio
  maf: number;                  // AT_medio / PL_medio

  // 5 fatores adicionais
  margemEbit: number;          // EBIT / RL
  cargaFinanceira: number;     // LAIR / EBIT  (1 = sem juros)
  cargaTributaria: number;     // LL / LAIR    (1 − alíquota efetiva)

  // ROE reconstruído (validação de identidade)
  roeReconstruido3F: number;   // m × g × maf  (decimal)
  roeReconstruido5F: number;
  roeEngine: number;           // ind.roe / 100 (decimal)

  // Flags de qualidade
  ativoEstimado: boolean;      // true quando AT não foi informado pelo consultor
  ebitNegativo: boolean;
  lairNegativo: boolean;

  /** Fator dominante (maior contribuição log-relativa ao ROE). */
  fatorDominante: "operacional" | "alavancagem" | "tributario" | "indefinido";
}

export function buildDupont(state: AppState, dre: DRE, ind: Indicators): DupontModel {
  const RL = ind.receitaLiquidaAnual;
  const EBIT = ind.ebitAnual;
  const juros = sum(dre.custosFinanceirosTotal);
  const impLucro = sum(dre.impostos);
  const resFin = sum(dre.resultadoFinanceiro); // já contém juros (negativo) e receitas financ.
  // LAIR = EBIT + Resultado Financeiro (consistente com DRE da engine).
  const LAIR = EBIT + resFin;
  const LL = ind.lucroLiquidoAnual;

  const PL = Math.max(0, state.capital.patrimonioLiquido);
  const PLab = Math.max(0, state.capital.patrimonioLiquidoAbertura ?? 0);
  const plMedio = PLab > 0 ? (PLab + PL) / 2 : PL;

  const AT = state.capital.ativoTotal;
  const ATab = Math.max(0, state.capital.ativoTotalAbertura ?? 0);
  const atMedio = ATab > 0 && AT > 0 ? (ATab + AT) / 2 : AT;

  const margemLiquida = RL > 0 ? safeDivide(LL, RL) : 0;
  const margemEbit = RL > 0 ? safeDivide(EBIT, RL) : 0;
  const giroAtivo = atMedio > 0 ? safeDivide(RL, atMedio) : 0;
  const maf = plMedio > 0 && atMedio > 0 ? safeDivide(atMedio, plMedio) : 0;
  const cargaFinanceira = Math.abs(EBIT) > 1 ? safeDivide(LAIR, EBIT) : 0;
  const cargaTributaria = Math.abs(LAIR) > 1 ? safeDivide(LL, LAIR) : 0;

  const roeReconstruido3F = margemLiquida * giroAtivo * maf;
  const roeReconstruido5F = margemEbit * giroAtivo * maf * cargaFinanceira * cargaTributaria;
  const roeEngine = (ind.roe ?? 0) / 100;

  // Fator dominante: maior |log| do componente entre operação (m×g),
  // alavancagem (maf), tributário (cf×ct). Usa log para neutralizar escala.
  const op = Math.max(1e-6, Math.abs(margemEbit * giroAtivo));
  const alv = Math.max(1e-6, Math.abs(maf));
  const trib = Math.max(1e-6, Math.abs(cargaFinanceira * cargaTributaria));
  const candidates = [
    { k: "operacional" as const, w: Math.abs(Math.log(op)) },
    { k: "alavancagem" as const, w: Math.abs(Math.log(alv)) },
    { k: "tributario" as const, w: Math.abs(Math.log(trib)) },
  ];
  const top = candidates.reduce((a, b) => (b.w > a.w ? b : a));
  const fatorDominante = top.w > 0.05 ? top.k : "indefinido";
  void juros; void impLucro;

  return {
    receitaLiquida: RL,
    ebit: EBIT,
    lair: LAIR,
    lucroLiquido: LL,
    ativoTotalMedio: atMedio,
    plMedio,
    margemLiquida,
    giroAtivo,
    maf,
    margemEbit,
    cargaFinanceira,
    cargaTributaria,
    roeReconstruido3F,
    roeReconstruido5F,
    roeEngine,
    ativoEstimado: !(AT > 0),
    ebitNegativo: EBIT <= 0,
    lairNegativo: LAIR <= 0,
    fatorDominante,
  };
}
