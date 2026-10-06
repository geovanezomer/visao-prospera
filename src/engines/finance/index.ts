/**
 * API pública da engine financeira (`@/engines/finance`).
 *
 * Este é o ponto de entrada oficial — consumidores (UI, AI tools, rotas)
 * devem preferir importar daqui em vez de submódulos profundos. Submódulos
 * permanecem importáveis (ex.: `@/engines/finance`) para casos
 * de tree-shaking fino, testes, e re-exports que ainda não foram migrados,
 * mas novos call sites devem usar este barrel.
 *
 * Organização (espelha o domínio, não a UI):
 *   - Tipos centrais (AppState, DRE, Indicators, etc.)
 *   - Estado/store (Zustand) e persistência
 *   - Engine de cálculo (DRE, indicadores, tributos)
 *   - Projeções (forecast, monte carlo, sensitivity, simulator)
 *   - Análises (valuation, prescritivo, estratégico, saúde, cross-validation)
 *   - Helpers (formatação, defaults tributários)
 */

// ============= Tipos e contratos =============
export type {
  Months,
  TabKey,
  BusinessType,
  TaxRegime,
  SimplesAnexo,
  TaxEra,
  CostCategory,
  CostSubcategory,
  CostLine,
  Revenue,
  RevenueDeducao,
  CapitalStructure,
  CapexAtivacao,
  CashFlowConfig,
  TaxConfig,
  AppState,
  Scenario,
} from "./types";
export {
  TAB_KEYS,
  TAX_ERAS,
  TAX_ERA_LABEL,
  TAX_ERA_SHORT,
  APP_STATE_SCHEMA_VERSION,
  COST_VENDAS_LABEL,
  SUBCATEGORIES,
  COST_VENDAS_TABLE_CONFIG,
  DEFAULT_ENCARGOS_PCT,
} from "./types";

// ============= Engine de cálculo (DRE + indicadores + tributos) =============
// Importa direto dos submódulos coesos (fachada `./calculations` foi removida).
export type { DRE } from "./dre";
export { buildDRE } from "./dre";
export type { Indicators } from "./indicators";
export { calcIndicators } from "./indicators";
export type { Diagnostic } from "./diagnose";
export { diagnose } from "./diagnose";
export type { MonthlyTax } from "./tax/shared";
export { calcSimples, simplesAliquotaEfetiva } from "./tax/simples";
export { calcPresumido, presumidoBases } from "./tax/presumido";
export { calcReal, irShieldForRegime } from "./tax/real";
export {
  folhaAnual,
  folhaFatorR,
  resolveEffectiveRegime,
  resolveSimplesAnexo,
  simplesExcedeLimite,
} from "./regime";
export {
  type ReformaRates,
  getReformaRates,
  getReformaRatesForYear,
  eraForYear,
  getIbsFractionForYear,
  getIcmsIssFractionForYear,
  getPisCofinsFractionForYear,
  getCbsPctForYear,
} from "./tax/reforma";
export { compareYearsForRegime, compareRegimes, compareErasForRegime } from "./tax/compare";
export { isCpvCost, fixedCostBase, effectiveMonthValues, monthValues } from "./costs";
export { splitReceitasFinanceiras, outrasDeducoesMensal, computeNetDebt, cagr12m } from "./shared";

// ============= Estado e persistência =============
export { useAppState, useScenarios } from "./store";
export { useFinanceModel } from "./useFinanceModel";
export { useFinnanceFile } from "./useFinnanceFile";

// ============= Fluxo de caixa =============
export * from "./cashflow";

// ============= Projeções e simulações =============
export { applySimulator, countActiveLevers, DEFAULT_SIM, type SimulatorParams } from "./simulator";
export {
  buildForecast,
  DEFAULT_FORECAST_CFG,
  type ForecastConfig,
  type ForecastResult,
} from "./forecast";
export {
  runSensitivity,
  type DriverKey,
  type OutputKey,
  type SensitivityResult,
} from "./sensitivity";
export * from "./montecarlo";

// ============= Análises =============
export { buildValuation, defaultValuationParams } from "./valuation";
export * from "./prescriptive";
export * from "./strategic";
export * from "./health";
export * from "./crossValidation";
export {
  buildBriefing,
  classify,
  briefingCacheKey,
  type Briefing,
  type ClassificacaoIndicador,
  type PadraoDetectado,
  type AlavancaSugerida,
  type ContextoEmpresa,
  type Nivel,
} from "./briefing";

// ============= Helpers =============
export * from "./format";
export * from "./taxDefaults";
