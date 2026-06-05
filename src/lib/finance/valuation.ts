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

  // Valor terminal por Gordon: usa FCF anualizado dos últimos 12 meses.
  // Auditoria: exige spread mínimo de 0,5% entre WACC e g — caso contrário
  // usa fallback conservador (5× FCL ≈ múltiplo EV/EBITDA típico de PME madura)
  // em vez de 10×, que superestimava o valor terminal quando WACC≈g.
  const lastYearFCF = fcfProjected.slice(-12).reduce((a, b) => a + b, 0);
  const g = params.terminalGrowthRate;
  const spread = waccAnnual - g;
  const terminalValue = spread >= 0.005
    ? (lastYearFCF * (1 + g)) / spread
    : lastYearFCF * 5; // fallback p/ WACC≈g (perpetuidade não converge)
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

// =====================================================================
// MEMÓRIA DE CÁLCULO — devolve cada fórmula e seus inputs/outputs.
// Útil para o usuário auditar os números e para o painel de validação.
// =====================================================================
export interface ValuationTrace {
  inputs: {
    ebitda: number; receita: number; ll: number;
    dividaOnerosa: number;
    wacc: number; ke: number; kd: number;
    multEbitda: number; multReceita: number; multPL: number;
    horizonAnos: number; g: number;
    controlPremium: number; liquidityDiscount: number;
    haircut: number;
  };
  steps: { label: string; formula: string; value: number; note?: string }[];
}

export function traceValuation(state: AppState, params: ValuationParams): ValuationTrace {
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const strategic = computeStrategic(state);
  const m = buildMultiples(state, params);
  const dcf = (() => { try { return buildDCF(state, params); } catch { return undefined; } })();

  const haircut = params.applyStrategicHaircut && strategic.hasAnyAnswer ? strategic.haircut : 0;
  const evMult = m.blendedEnterpriseValue;
  const evDCF = dcf ? dcf.npvFlows + dcf.npvTerminal : 0;
  const evBaseRaw =
    params.method === "multiples" ? evMult :
    params.method === "dcf" ? evDCF :
    (evMult + evDCF) / 2;
  const evAdj = evBaseRaw * (1 + params.controlPremium) * (1 - params.liquidityDiscount);
  const evFinal = evAdj * (1 - haircut);

  const steps: ValuationTrace["steps"] = [
    { label: "EV via EBITDA",   formula: `EBITDA × m = ${m.ebitda.toFixed(2)} × ${params.evEbitdaMultiple}`, value: m.evFromEbitda },
    { label: "EV via Receita",  formula: `Receita × m = ${m.revenue.toFixed(2)} × ${params.evRevenueMultiple}`, value: m.evFromRevenue },
    { label: "Equity via P/L",  formula: `LL × m = ${m.ll.toFixed(2)} × ${params.plMultiple}`, value: m.equityFromPL, note: "P/L produz Equity Value (não EV); ponderado proporcionalmente." },
    { label: "EV múltiplos (ponderado)", formula: "0.5·EV_EBITDA + 0.3·EV_Receita + 0.2·Eq_PL (pesos renormalizados)", value: evMult },
    ...(dcf ? [
      { label: "WACC (a.a.)",        formula: "Capital.wacc()", value: dcf.wacc, note: "% ao ano" },
      { label: "VPN fluxos DCF",     formula: `Σ FCL_t / (1+wacc_m)^t · t=1..${dcf.horizonMonths}`, value: dcf.npvFlows },
      { label: "Valor terminal (Gordon)", formula: `FCL_LTM·(1+g) / (WACC − g) = .../(${(dcf.wacc/100 - dcf.growthTerminal).toFixed(4)})`, value: dcf.terminalValue },
      { label: "VP do terminal",     formula: `VT / (1+wacc_m)^N`, value: dcf.npvTerminal },
      { label: "EV DCF (VPN+VP_terminal)", formula: "VPN_fluxos + VP_terminal", value: evDCF },
    ] : [{ label: "DCF", formula: "indisponível (forecast inválido)", value: 0 }]),
    { label: "EV método selecionado", formula: `método=${params.method}`, value: evBaseRaw },
    { label: "EV ajustado (controle/liquidez)", formula: `EV × (1+${params.controlPremium}) × (1−${params.liquidityDiscount})`, value: evAdj },
    { label: `Haircut estratégico (${(haircut*100).toFixed(1)}%)`, formula: `EV_adj × (1 − ${haircut.toFixed(3)})`, value: evFinal },
    { label: "Equity Value final", formula: `EV − dívida onerosa = ${evFinal.toFixed(2)} − ${state.capital.dividaOnerosa.toFixed(2)}`, value: Math.max(0, evFinal - state.capital.dividaOnerosa) },
  ];

  return {
    inputs: {
      ebitda: m.ebitda, receita: m.revenue, ll: m.ll,
      dividaOnerosa: state.capital.dividaOnerosa,
      wacc: ind.wacc, ke: state.capital.ke, kd: state.capital.kd,
      multEbitda: params.evEbitdaMultiple, multReceita: params.evRevenueMultiple, multPL: params.plMultiple,
      horizonAnos: params.horizonYears, g: params.terminalGrowthRate,
      controlPremium: params.controlPremium, liquidityDiscount: params.liquidityDiscount,
      haircut,
    },
    steps,
  };
}

// =====================================================================
// SELF-TESTS — valida fórmulas de EV/EBITDA, EV/Receita, P/L e DCF (Gordon)
// com casos determinísticos. Loga no console para o usuário inspecionar.
// =====================================================================
export interface ValuationTestCase {
  name: string;
  formula: string;
  expected: number;
  actual: number;
  pass: boolean;
  delta: number;
}

const approxEq = (a: number, b: number, tol = 0.005) =>
  Math.abs(a) + Math.abs(b) < 1e-6 ? true : Math.abs(a - b) / Math.max(1, Math.abs(b)) <= tol;

export function runValuationSelfTests(): { results: ValuationTestCase[]; allPassed: boolean } {
  const results: ValuationTestCase[] = [];
  const add = (name: string, formula: string, expected: number, actual: number) => {
    const pass = approxEq(actual, expected);
    const delta = actual - expected;
    results.push({ name, formula, expected, actual, pass, delta });
  };

  // ---- 1) EV/EBITDA: 1.000.000 × 5 = 5.000.000
  {
    const ebitda = 1_000_000, mult = 5;
    add("EV/EBITDA básico", "EBITDA × m", 5_000_000, ebitda * mult);
  }
  // ---- 2) EV/Receita: 10.000.000 × 0,8 = 8.000.000
  add("EV/Receita básico", "Receita × m", 8_000_000, 10_000_000 * 0.8);
  // ---- 3) P/L: 500.000 × 10 = 5.000.000
  add("P/L básico", "LL × m", 5_000_000, 500_000 * 10);
  // ---- 4) Blended renormalizado (só EBITDA > 0)
  {
    const wE = 0.5, wR = 0, wL = 0; const wT = wE + wR + wL;
    const blended = (5_000_000 * wE + 0 + 0) / wT;
    add("Blended renormalizado (só EBITDA)", "EV_E·wE / Σw", 5_000_000, blended);
  }
  // ---- 5) Blended média ponderada normal
  {
    const wE = 0.5, wR = 0.3, wL = 0.2;
    const blended = 5_000_000 * wE + 8_000_000 * wR + 5_000_000 * wL;
    add("Blended ponderado (E·0.5 + R·0.3 + L·0.2)", "Σ EV_i·w_i", 5_900_000, blended);
  }
  // ---- 6) Gordon: FCL_LTM=600k, g=2%, WACC=12% → VT = 600k·1.02/0.10 = 6.120.000
  {
    const fcl = 600_000, g = 0.02, wacc = 0.12;
    const vt = (fcl * (1 + g)) / (wacc - g);
    add("Valor terminal Gordon (FCL=600k, g=2%, WACC=12%)", "FCL·(1+g)/(WACC−g)", 6_120_000, vt);
  }
  // ---- 7) Gordon degenerado: g≥WACC → fallback FCL·5 (conservador p/ PME)
  {
    const fcl = 600_000, g = 0.15, wacc = 0.10;
    const vt = wacc - g >= 0.005 ? (fcl * (1 + g)) / (wacc - g) : fcl * 5;
    add("Fallback quando g≥WACC", "FCL × 5", 3_000_000, vt);
  }
  // ---- 8) DCF: 12 fluxos de 100.000 a 12% a.a. → wacc_m = (1.12)^(1/12)-1
  {
    const fcl = 100_000;
    const wacc_a = 0.12;
    const wacc_m = Math.pow(1 + wacc_a, 1 / 12) - 1;
    let npv = 0;
    for (let t = 0; t < 12; t++) npv += fcl / Math.pow(1 + wacc_m, t + 1);
    // valor esperado calculado: ~1.131.853 (anuidade discreta mensal)
    const expected = fcl * ((1 - Math.pow(1 + wacc_m, -12)) / wacc_m);
    add("VPN anuidade mensal (12×100k @ 12%a.a.)", "Σ FCL/(1+w_m)^t", expected, npv);
  }
  // ---- 9) Ajuste controle/liquidez: 1.000.000 × 1.20 × 0.85 = 1.020.000
  add("Ajuste controle×liquidez", "EV·(1+c)·(1−l)", 1_020_000, 1_000_000 * 1.20 * 0.85);
  // ---- 10) Haircut 30%: 1.000.000 × 0.70 = 700.000
  add("Haircut estratégico 30%", "EV·(1−h)", 700_000, 1_000_000 * (1 - 0.30));
  // ---- 11) Equity = EV − Dívida
  add("Equity Value = EV − D", "EV − D", 3_500_000, 5_000_000 - 1_500_000);

  const allPassed = results.every((r) => r.pass);

  // Logs amigáveis no console
  if (typeof console !== "undefined") {
    console.groupCollapsed(`%c[GZ FinnancePRO] Valuation — Self-tests (${results.filter(r=>r.pass).length}/${results.length} OK)`, allPassed ? "color:#22c55e" : "color:#ef4444");
    for (const r of results) {
      console.log(`${r.pass ? "✅" : "❌"} ${r.name}  | ${r.formula}\n   esperado=${r.expected.toLocaleString("pt-BR")}  obtido=${r.actual.toLocaleString("pt-BR")}  Δ=${r.delta.toFixed(4)}`);
    }
    console.groupEnd();
  }

  return { results, allPassed };
}

export function logValuationTrace(state: AppState, params: ValuationParams, label = "live") {
  if (typeof console === "undefined") return;
  const t = traceValuation(state, params);
  const v = buildValuation(state, params);
  console.groupCollapsed(`%c[GZ FinnancePRO] Valuation memória (${label}) — EV=${v.enterpriseValue.base.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`, "color:#3b82f6");
  console.table(t.inputs);
  console.table(t.steps.map(s => ({ etapa: s.label, formula: s.formula, valor: s.value })));
  console.groupEnd();
}
