// =====================================================================
// COMPARE — comparativos de regimes tributários e projeção ano-a-ano
// sob o cronograma da Reforma (LC 214/2025).
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// =====================================================================

import { AppState, TaxRegime, TaxEra } from "../types";
import { sum } from "../format";
import { buildDRE } from "../dre";
import { simplesExcedeLimite } from "../regime";
import { calcSimples } from "./simples";
import { calcPresumido } from "./presumido";
import { calcReal } from "./real";
import { getReformaRatesForYear, eraForYear, type ReformaRates } from "./reforma";
import { getCbsAliquota, getIbsAliquotaRef } from "../taxDefaults";
import type { MonthlyTax } from "./shared";

/**
 * Projeção da carga efetiva ano-a-ano para um regime, aplicando o cronograma
 * oficial. Reaproveita o engine existente sobrescrevendo os multiplicadores de
 * transição via `ratesOverride`.
 *
 * 2026 é calculado com as regras atuais: a CBS de 0,9% e o IBS de 0,1% da
 * fase de teste são integralmente compensáveis com PIS/COFINS (LC 214/2025,
 * art. 343), e PIS/COFINS seguem devidos. Calcular 2026 pela era "transicao"
 * zerava PIS/COFINS e subestimava a carga (≈2,65 p.p. no Presumido).
 */
export function compareYearsForRegime(
  state: AppState,
  regime: TaxRegime,
  years: number[],
): { year: number; era: TaxEra; effective: number; annual: number; rates: ReformaRates }[] {
  const ibsFull = getIbsAliquotaRef(state.tax);
  return years.map((year) => {
    const rates = getReformaRatesForYear(year, state.tax);
    const ibsFrac = ibsFull > 0 ? rates.ibsPct / ibsFull : 0;
    const era = eraForYear(year);
    const calcEra: TaxEra = year === 2026 ? "atual" : era;
    const s: AppState = {
      ...state,
      tax: {
        ...state.tax,
        era: calcEra,
        cbsAliquota: getCbsAliquota(state.tax),
        ratesOverride: {
          ...(state.tax.ratesOverride ?? {}),
          reformaTransicaoIbsMult: ibsFrac,
          reformaTransicaoIcmsIssMult: rates.icmsIssMult,
        },
      },
    };
    let tax: MonthlyTax;
    if (regime === "simples") tax = calcSimples(s);
    else if (regime === "presumido") tax = calcPresumido(s);
    else {
      const baseLair = buildDRE(s, "real").dre.lair;
      tax = calcReal(s, baseLair);
    }
    return { year, era, effective: tax.effective, annual: tax.annual, rates };
  });
}

/**
 * SSOT-4: comparativo de regimes COM lucro líquido e regime ótimo embutidos.
 */
export function compareRegimes(state: AppState, era?: TaxEra) {
  const s: AppState = era ? { ...state, tax: { ...state.tax, era } } : state;
  const baseLair = buildDRE(s, "presumido").dre.lair;
  const simples = calcSimples(s);
  const presumido = calcPresumido(s);
  const real = calcReal(s, baseLair);
  const llBy: Record<TaxRegime, number> = {
    simples: sum(buildDRE(s, "simples").dre.lucroLiquido),
    presumido: sum(buildDRE(s, "presumido").dre.lucroLiquido),
    real: sum(buildDRE(s, "real").dre.lucroLiquido),
  };
  const desenquadrado = simplesExcedeLimite(s);
  const candidates: TaxRegime[] = desenquadrado
    ? ["presumido", "real"]
    : ["simples", "presumido", "real"];
  const best = candidates.reduce((a, b) => (llBy[b] > llBy[a] ? b : a));
  return { simples, presumido, real, llBy, best, desenquadradoSimples: desenquadrado };
}

/** Projeção da carga efetiva (%) por era para um dado regime, mantendo o resto do estado fixo. */
export function compareErasForRegime(
  state: AppState,
  regime: TaxRegime,
): { era: TaxEra; effective: number; annual: number }[] {
  const eras: TaxEra[] = ["atual", "transicao", "pleno"];
  return eras.map((era) => {
    const s: AppState = { ...state, tax: { ...state.tax, era } };
    let tax: MonthlyTax;
    if (regime === "simples") tax = calcSimples(s);
    else if (regime === "presumido") tax = calcPresumido(s);
    else {
      const baseLair = buildDRE(s, "real").dre.lair;
      tax = calcReal(s, baseLair);
    }
    return { era, effective: tax.effective, annual: tax.annual };
  });
}
