/**
 * Valuation engine — consolida dados das abas em uma narrativa de valor
 * com múltiplos setoriais, DCF e ajuste de risco estratégico.
 */
import { AppState, BusinessType } from "./types";
import { buildDRE, calcIndicators } from "./calculations";
import { buildForecast, ForecastConfig, DEFAULT_FORECAST_CFG } from "./forecast";
import { computeStrategic, StrategicResult } from "./strategic";
import { sum } from "./format";

export type ValuationMethod = "multiples" | "dcf" | "blended";
export type ConfidenceGrade = "A" | "B" | "C" | "D" | "E";

export interface ValuationRange { low: number; base: number; high: number }

export interface ValuationParams {
  method: ValuationMethod;
  evEbitdaMultiple: number;
  evRevenueMultiple: number;
  plMultiple: number;
  controlPremium: number;        // 0..0.5
  liquidityDiscount: number;     // 0..0.5
  horizonYears: number;          // 1..10
  terminalGrowthRate: number;    // decimal a.a.
  applyStrategicHaircut: boolean;
  forecastConfig: ForecastConfig;
}

export interface DCFSummary {
  fcfProjected: number[];
  wacc: number;          // % a.a.
  terminalValue: number;
  npvFlows: number;
  npvTerminal: number;
  horizonMonths: number;
  growthTerminal: number;
}

export interface MultiplesSummary {
  ebitda: number;
  revenue: number;
  ll: number;
  evFromEbitda: number;
  evFromRevenue: number;
  equityFromPL: number;
  blendedEnterpriseValue: number;
}

export interface ValuationResult {
  method: ValuationMethod;
  enterpriseValue: ValuationRange;
  equityValue: ValuationRange;
  impliedMultiple: { evEbitda: number; evRevenue: number };
  confidenceScore: ConfidenceGrade;
  confidenceRationale: string;
  strategicResult: StrategicResult;
  haircutApplied: number;
  dcfDetails?: DCFSummary;
  multiplesDetails: MultiplesSummary;
  narrative: string;
}

// =====================================================================
// PRESETS POR TIPO DE NEGÓCIO (faixas pessimista / base / otimista)
// =====================================================================
export const VALUATION_PRESETS: Record<BusinessType, {
  evEbitdaRange: [number, number, number];
  evRevenueRange: [number, number, number];
  plRange: [number, number, number];
  defaultGrowthTerminal: number;
}> = {
  servicos: { evEbitdaRange: [4.0, 5.5, 7.0], evRevenueRange: [0.8, 1.3, 2.0], plRange: [8.0, 12.0, 18.0], defaultGrowthTerminal: 0.025 },
  comercio: { evEbitdaRange: [3.0, 4.0, 5.5], evRevenueRange: [0.4, 0.7, 1.1], plRange: [6.0, 9.0, 14.0], defaultGrowthTerminal: 0.015 },
  industria: { evEbitdaRange: [4.5, 6.0, 8.0], evRevenueRange: [0.7, 1.1, 1.6], plRange: [9.0, 13.0, 20.0], defaultGrowthTerminal: 0.020 },
};

export const defaultValuationParams = (b: BusinessType): ValuationParams => {
  const p = VALUATION_PRESETS[b];
  return {
    method: "blended",
    evEbitdaMultiple: p.evEbitdaRange[1],
    evRevenueMultiple: p.evRevenueRange[1],
    plMultiple: p.plRange[1],
    controlPremium: 0,
    liquidityDiscount: 0.15,
    horizonYears: 3,
    terminalGrowthRate: p.defaultGrowthTerminal,
    applyStrategicHaircut: true,
    forecastConfig: DEFAULT_FORECAST_CFG,
  };
};

// =====================================================================
// MÚLTIPLOS — média ponderada com pesos renormalizados se algum múltiplo = 0
// =====================================================================
function buildMultiples(state: AppState, params: ValuationParams): MultiplesSummary {
  const { dre } = buildDRE(state, state.tax.regime);
  const ebitda = sum(dre.ebitda);
  const revenue = sum(dre.receitaBruta);
  const ll = sum(dre.lucroLiquido);

  const evFromEbitda = Math.max(0, ebitda) * Math.max(0, params.evEbitdaMultiple);
  const evFromRevenue = Math.max(0, revenue) * Math.max(0, params.evRevenueMultiple);
  const equityFromPL = Math.max(0, ll) * Math.max(0, params.plMultiple);

  // pesos: EBITDA 50% · Receita 30% · P/L 20%. Renormaliza pelos que > 0.
  const wE = ebitda > 0 && params.evEbitdaMultiple > 0 ? 0.5 : 0;
  const wR = revenue > 0 && params.evRevenueMultiple > 0 ? 0.3 : 0;
  const wL = ll > 0 && params.plMultiple > 0 ? 0.2 : 0;
  const wTotal = wE + wR + wL || 1;
  const blendedEnterpriseValue =
    (evFromEbitda * wE + evFromRevenue * wR + equityFromPL * wL) / wTotal;

  return { ebitda, revenue, ll, evFromEbitda, evFromRevenue, equityFromPL, blendedEnterpriseValue };
}

// =====================================================================
// DCF — projeta FCL via forecast e desconta à WACC
// =====================================================================
function buildDCF(state: AppState, params: ValuationParams): DCFSummary {
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);

  const forecast = buildForecast(state, {
    ...params.forecastConfig,
    horizonteMeses: params.horizonYears * 12,
  });
  const fcfProjected = forecast.meses.map((m) => m.fcl);

  const waccAnnual = Math.max(0.005, (ind.wacc || 10) / 100);
  const waccMonthly = Math.pow(1 + waccAnnual, 1 / 12) - 1;

  let npvFlows = 0;
  for (let t = 0; t < fcfProjected.length; t++) {
    npvFlows += fcfProjected[t] / Math.pow(1 + waccMonthly, t + 1);
  }

  // Valor terminal por Gordon: usa FCF anualizado dos últimos 12 meses
  const lastYearFCF = fcfProjected.slice(-12).reduce((a, b) => a + b, 0);
  const g = params.terminalGrowthRate;
  const terminalValue = waccAnnual > g
    ? (lastYearFCF * (1 + g)) / (waccAnnual - g)
    : lastYearFCF * 10;
  const npvTerminal = terminalValue / Math.pow(1 + waccMonthly, fcfProjected.length);

  return {
    fcfProjected,
    wacc: waccAnnual * 100,
    terminalValue,
    npvFlows,
    npvTerminal,
    horizonMonths: params.horizonYears * 12,
    growthTerminal: g,
  };
}

// =====================================================================
// CONFIANÇA
// =====================================================================
function computeConfidence(state: AppState, params: ValuationParams, strategic: StrategicResult) {
  let score = 100;
  const issues: string[] = [];
  if (!strategic.hasAnyAnswer) { score -= 25; issues.push("análise estratégica não preenchida"); }
  else if (strategic.index < 50) { score -= 15; issues.push("risco estratégico elevado"); }
  const { capital } = state;
  if (capital.dividaOnerosa <= 0 && capital.patrimonioLiquido <= 0) { score -= 20; issues.push("estrutura de capital não informada"); }
  if (capital.ke <= 0 || capital.kd <= 0) { score -= 10; issues.push("custo de capital não definido"); }
  if (params.terminalGrowthRate > 0.05) { score -= 10; issues.push("g terminal acima de 5% (irreal p/ PME)"); }
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  if (ind.wacc <= 0 || ind.wacc > 50) { score -= 15; issues.push("WACC fora de faixa realista"); }
  const grade: ConfidenceGrade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";
  const rationale = issues.length === 0
    ? "Dados financeiros e estratégicos robustos."
    : `Atenção: ${issues.join(", ")}.`;
  return { grade, rationale };
}

// =====================================================================
// NARRATIVA
// =====================================================================
function buildNarrative(ev: number, ind: ReturnType<typeof calcIndicators>, strategic: StrategicResult): string {
  const parts: string[] = [];
  const positive = ev > 0;
  const roicGtWacc = ind.roic > ind.wacc;
  if (positive && roicGtWacc) parts.push("Empresa cria valor econômico (ROIC > WACC) com valuation positivo.");
  else if (positive && !roicGtWacc) parts.push("Valuation positivo, mas ROIC < WACC indica destruição de valor econômico.");
  else parts.push("Enterprise Value não positivo — indício de que a operação não gera valor suficiente.");
  if (strategic.hasAnyAnswer) {
    if (strategic.level === "crítico" || strategic.level === "frágil")
      parts.push(`Risco estratégico ${strategic.level} reduz a qualidade do múltiplo.`);
    else if (strategic.level === "robusto") parts.push("Perfil estratégico robusto sustenta o múltiplo aplicado.");
  }
  if (ind.margemEbitda > 20) parts.push("Margem EBITDA sólida sustenta o desconto pelo método de múltiplos.");
  return parts.join(" ");
}

// =====================================================================
// API
// =====================================================================
export function buildValuation(state: AppState, params: ValuationParams): ValuationResult {
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const strategic = computeStrategic(state);

  const mults = buildMultiples(state, params);
  let dcf: DCFSummary | undefined;
  try { dcf = buildDCF(state, params); } catch { dcf = undefined; }

  const evMultiples = mults.blendedEnterpriseValue;
  const evDCF = dcf ? dcf.npvFlows + dcf.npvTerminal : 0;
  let evBase =
    params.method === "multiples" ? evMultiples :
    params.method === "dcf" ? evDCF :
    (evMultiples + evDCF) / 2;

  // Ajustes de controle e liquidez
  evBase = evBase * (1 + params.controlPremium) * (1 - params.liquidityDiscount);

  const haircut = params.applyStrategicHaircut && strategic.hasAnyAnswer ? strategic.haircut : 0;
  const evAfter = evBase * (1 - haircut);

  const evLow = evAfter * (dcf ? 0.75 : 0.9);
  const evHigh = evAfter * (dcf ? 1.35 : 1.15);
  const D = state.capital.dividaOnerosa;

  const { grade, rationale } = computeConfidence(state, params, strategic);

  return {
    method: params.method,
    enterpriseValue: { low: evLow, base: evAfter, high: evHigh },
    equityValue: {
      low: Math.max(0, evLow - D),
      base: Math.max(0, evAfter - D),
      high: Math.max(0, evHigh - D),
    },
    impliedMultiple: {
      evEbitda: mults.ebitda > 0 ? evAfter / mults.ebitda : 0,
      evRevenue: mults.revenue > 0 ? evAfter / mults.revenue : 0,
    },
    confidenceScore: grade,
    confidenceRationale: rationale,
    strategicResult: strategic,
    haircutApplied: haircut,
    dcfDetails: dcf,
    multiplesDetails: mults,
    narrative: buildNarrative(evAfter, ind, strategic),
  };
}
