// =====================================================================
// CALCULATIONS — fachada legada do engine financeiro.
// Após o refactor (Fases 1–4), todo o conteúdo foi extraído para
// submódulos coesos. Este arquivo agora existe APENAS para preservar
// a API pública consumida pelos call sites (`@/engines/finance/calculations`).
//
// @deprecated Para código novo, importe direto do submódulo específico:
//   - ./tax/simples · ./tax/presumido · ./tax/real · ./tax/compare · ./tax/reforma
//   - ./dre · ./indicators · ./diagnose
//   - ./costs · ./regime · ./shared
// =====================================================================

// Helpers compartilhados
export { computeNetDebt, outrasDeducoesMensal, splitReceitasFinanceiras, cagr12m } from "./shared";

// Reforma Tributária (CBS/IBS — LC 214/2025)
export {
  type ReformaRates,
  getReformaRates,
  getIbsFractionForYear,
  getIcmsIssFractionForYear,
  getPisCofinsFractionForYear,
  getCbsPctForYear,
  getReformaRatesForYear,
  eraForYear,
} from "./tax/reforma";

// Custos e regime efetivo
export { isCpvCost, fixedCostBase, effectiveMonthValues, monthValues } from "./costs";
export {
  folhaAnual,
  resolveSimplesAnexo,
  simplesExcedeLimite,
  resolveEffectiveRegime,
} from "./regime";

// Regimes tributários
export { simplesAliquotaEfetiva, calcSimples } from "./tax/simples";
export { presumidoBases, calcPresumido } from "./tax/presumido";
export { calcReal, irShieldForRegime } from "./tax/real";
export type { MonthlyTax } from "./tax/shared";

// Comparadores de regime / era
export { compareYearsForRegime, compareRegimes, compareErasForRegime } from "./tax/compare";

// DRE, Indicadores e Diagnóstico
export { type DRE, buildDRE } from "./dre";
export { type Indicators, calcIndicators } from "./indicators";
export { type Diagnostic, diagnose } from "./diagnose";
