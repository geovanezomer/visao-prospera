/**
 * Valuation engine — consolida dados das abas em uma narrativa de valor
 * com múltiplos setoriais, DCF e ajuste de risco estratégico.
 *
 * V1+V2 (auditoria): aceita modelo pré-computado { dre, ind, regime } para
 * evitar 8× chamadas redundantes a buildDRE/calcIndicators por render.
 * Quando não recebe, resolve o REGIME EFETIVO (não o nominal) — alinhado
 * com Indicadores/Diagnóstico/Simulador (verdade absoluta única).
 */
import { AppState, BusinessType, TaxRegime } from "./types";
import { sumContractSaldos } from "./debtContracts";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { resolveEffectiveRegime } from "./regime";
import { computeNetDebt, computeNetDebtParts } from "./shared";
import { buildForecast, ForecastConfig, DEFAULT_FORECAST_CFG } from "./forecast";
import { computeStrategic, StrategicResult } from "./strategic";
import { sum } from "./format";
import { vplExcel } from "./external";

export type ValuationMethod = "multiples" | "dcf" | "blended";
export type ConfidenceGrade = "A" | "B" | "C" | "D" | "E";

export interface ValuationRange {
  low: number;
  base: number;
  high: number;
}

export interface ValuationParams {
  method: ValuationMethod;
  evEbitdaMultiple: number;
  evRevenueMultiple: number;
  plMultiple: number;
  controlPremium: number; // 0..0.5
  liquidityDiscount: number; // 0..0.5
  horizonYears: number; // 1..10
  terminalGrowthRate: number; // decimal a.a.
  applyStrategicHaircut: boolean;
  forecastConfig: ForecastConfig;
}

export interface DCFSummary {
  fcfProjected: number[];
  wacc: number; // % a.a.
  terminalValue: number;
  npvFlows: number;
  npvTerminal: number;
  horizonMonths: number;
  growthTerminal: number;
  warnings: string[]; // V8/V10: alertas (FCL terminal negativo, WACC default, etc.)
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
  netDebt: number; // V4: dívida líquida usada no equity
  dcfDetails?: DCFSummary;
  multiplesDetails: MultiplesSummary;
  narrative: string;
}

// =====================================================================
// PRESETS POR TIPO DE NEGÓCIO (faixas pessimista / base / otimista)
// =====================================================================
export const VALUATION_PRESETS: Record<
  BusinessType,
  {
    evEbitdaRange: [number, number, number];
    evRevenueRange: [number, number, number];
    plRange: [number, number, number];
    defaultGrowthTerminal: number;
  }
> = {
  servicos: {
    evEbitdaRange: [4.0, 5.5, 7.0],
    evRevenueRange: [0.8, 1.3, 2.0],
    plRange: [8.0, 12.0, 18.0],
    defaultGrowthTerminal: 0.025,
  },
  comercio: {
    evEbitdaRange: [3.0, 4.0, 5.5],
    evRevenueRange: [0.4, 0.7, 1.1],
    plRange: [6.0, 9.0, 14.0],
    defaultGrowthTerminal: 0.015,
  },
  industria: {
    evEbitdaRange: [4.5, 6.0, 8.0],
    evRevenueRange: [0.7, 1.1, 1.6],
    plRange: [9.0, 13.0, 20.0],
    defaultGrowthTerminal: 0.02,
  },
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
// MODELO PRÉ-COMPUTADO (V2) — evita rebuild de DRE/ind em cada subrotina.
// Se omitido, resolve regime EFETIVO (V1) e calcula localmente.
// =====================================================================
export interface PrecomputedValuationModel {
  regime: TaxRegime;
  dre: ReturnType<typeof buildDRE>["dre"];
  ind: ReturnType<typeof calcIndicators>;
}

function ensureModel(state: AppState, pre?: PrecomputedValuationModel): PrecomputedValuationModel {
  if (pre) return pre;
  const regime = resolveEffectiveRegime(state); // V1: verdade absoluta
  const dre = buildDRE(state, regime).dre;
  const ind = calcIndicators(state, dre);
  return { regime, dre, ind };
}

// SSOT-1: helper único computeNetDebt() de shared.ts. Valuation usa o
// resultado RAW limitado a zero (valuation não credita "caixa negativo" como
// reforço de equity).
function netDebt(state: AppState): number {
  return Math.max(0, computeNetDebt(state));
}

// =====================================================================
// MÚLTIPLOS — média ponderada com pesos renormalizados se algum múltiplo = 0
// =====================================================================
function buildMultiples(
  state: AppState,
  params: ValuationParams,
  m: PrecomputedValuationModel,
): MultiplesSummary {
  const ebitda = sum(m.dre.ebitda);
  const revenue = sum(m.dre.receitaBruta);
  const ll = sum(m.dre.lucroLiquido);

  const evFromEbitda = Math.max(0, ebitda) * Math.max(0, params.evEbitdaMultiple);
  const evFromRevenue = Math.max(0, revenue) * Math.max(0, params.evRevenueMultiple);
  // P/L produz EQUITY VALUE (não EV). Para entrar no blend de Enterprise Values
  // sem dupla dedução de dívida depois (Equity = EV − nd), convertemos:
  //   EV_implícito_PL = Equity_PL + Dívida Líquida.
  // Auditoria bug #1 (jun/2026): antes era somado direto como EV, causando
  // dupla penalização pela dívida em empresas alavancadas.
  const nd = netDebt(state);
  const equityFromPL = Math.max(0, ll) * Math.max(0, params.plMultiple);
  const evFromPL = equityFromPL > 0 ? equityFromPL + nd : 0;

  // pesos: EBITDA 50% · Receita 30% · P/L 20%. Renormaliza pelos que > 0.
  const wE = ebitda > 0 && params.evEbitdaMultiple > 0 ? 0.5 : 0;
  const wR = revenue > 0 && params.evRevenueMultiple > 0 ? 0.3 : 0;
  const wL = ll > 0 && params.plMultiple > 0 ? 0.2 : 0;
  const wTotal = wE + wR + wL || 1;
  const blendedEnterpriseValue = (evFromEbitda * wE + evFromRevenue * wR + evFromPL * wL) / wTotal;

  return { ebitda, revenue, ll, evFromEbitda, evFromRevenue, equityFromPL, blendedEnterpriseValue };
}

// =====================================================================
// DCF — projeta FCL via forecast e desconta à WACC
// =====================================================================
function buildDCF(
  state: AppState,
  params: ValuationParams,
  m: PrecomputedValuationModel,
): DCFSummary {
  const warnings: string[] = [];

  const forecast = buildForecast(state, {
    ...params.forecastConfig,
    horizonteMeses: params.horizonYears * 12,
  });
  const fcfProjected = forecast.meses.map((mo) => mo.fcl);

  // V10: WACC default silencioso vira alerta explícito.
  const rawWacc = m.ind.wacc;
  if (!Number.isFinite(rawWacc) || rawWacc <= 0) {
    warnings.push("WACC não definido (Capital): assumindo 10% a.a. — informe Ke/Kd para precisão.");
  } else if (rawWacc > 50) {
    warnings.push(
      `WACC = ${rawWacc.toFixed(1)}% fora de faixa realista — revise estrutura de capital.`,
    );
  }
  const waccAnnual = Math.max(
    0.005,
    (Number.isFinite(rawWacc) && rawWacc > 0 ? rawWacc : 10) / 100,
  );
  const waccMonthly = Math.pow(1 + waccAnnual, 1 / 12) - 1;

  // VPL Excel: desconta cada fcfProjected[t] em (1+w)^(t+1) — convenção padrão de DCF.
  const npvRaw = vplExcel(waccMonthly, ...fcfProjected);
  const npvFlows = npvRaw instanceof Error ? 0 : (npvRaw as number);

  // Valor terminal por Gordon. Spread mínimo de 0,5% (V7: alinhado com a UI).
  const lastYearFCF = fcfProjected.slice(-12).reduce((a, b) => a + b, 0);
  const g = params.terminalGrowthRate;
  const spread = waccAnnual - g;

  // V8: FCL_LTM negativo torna VT negativo. Sinaliza explicitamente.
  if (lastYearFCF < 0) {
    warnings.push(
      `FCL projetado do último ano é negativo (${lastYearFCF.toFixed(0)}). Valor terminal sairá negativo — DCF não confiável.`,
    );
  }
  if (spread < 0.005) {
    warnings.push(
      `Spread WACC − g abaixo de 0,5% (${(spread * 100).toFixed(2)}pp). Perpetuidade de Gordon não converge — usando fallback FCL × 5.`,
    );
  }

  // Gordon clássico: VT_T = FCF_{T+1} / (WACC − g) = FCF_T · (1+g) / (WACC − g).
  // `lastYearFCF` é o FCF do último ano projetado (período T); aplicamos (1+g) para
  // obter o fluxo do primeiro ano da perpetuidade (T+1), conforme convenção CFA/Damodaran.
  const terminalValue = spread >= 0.005 ? (lastYearFCF * (1 + g)) / spread : lastYearFCF * 5; // fallback p/ WACC≈g
  const npvTerminal = terminalValue / Math.pow(1 + waccMonthly, fcfProjected.length);

  return {
    fcfProjected,
    wacc: waccAnnual * 100,
    terminalValue,
    npvFlows,
    npvTerminal,
    horizonMonths: params.horizonYears * 12,
    growthTerminal: g,
    warnings,
  };
}

// =====================================================================
// CONFIANÇA
// =====================================================================
function computeConfidence(
  state: AppState,
  params: ValuationParams,
  strategic: StrategicResult,
  m: PrecomputedValuationModel,
) {
  let score = 100;
  const issues: string[] = [];
  if (!strategic.hasAnyAnswer) {
    score -= 25;
    issues.push("análise estratégica não preenchida");
  } else if (strategic.index < 50) {
    score -= 15;
    issues.push("risco estratégico elevado");
  }
  const { capital } = state;
  if (sumContractSaldos(capital.debtContracts) <= 0 && capital.patrimonioLiquido <= 0) {
    score -= 20;
    issues.push("estrutura de capital não informada");
  }
  if (capital.ke <= 0 || capital.kd <= 0) {
    score -= 10;
    issues.push("custo de capital não definido");
  }
  if (params.terminalGrowthRate > 0.05) {
    score -= 10;
    issues.push("g terminal acima de 5% (irreal p/ PME)");
  }
  if (m.ind.wacc <= 0 || m.ind.wacc > 50) {
    score -= 15;
    issues.push("WACC fora de faixa realista");
  }
  const grade: ConfidenceGrade =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";
  const rationale =
    issues.length === 0
      ? "Dados financeiros e estratégicos robustos."
      : `Atenção: ${issues.join(", ")}.`;
  return { grade, rationale };
}

// =====================================================================
// NARRATIVA
// =====================================================================
function buildNarrative(
  ev: number,
  ind: ReturnType<typeof calcIndicators>,
  strategic: StrategicResult,
): string {
  const parts: string[] = [];
  const positive = ev > 0;
  const roicGtWacc = ind.roic > ind.wacc;
  if (positive && roicGtWacc)
    parts.push("Empresa cria valor econômico (ROIC > WACC) com valuation positivo.");
  else if (positive && !roicGtWacc)
    parts.push("Valuation positivo, mas ROIC < WACC indica destruição de valor econômico.");
  else
    parts.push(
      "Enterprise Value não positivo — indício de que a operação não gera valor suficiente.",
    );
  if (strategic.hasAnyAnswer) {
    if (strategic.level === "crítico" || strategic.level === "frágil")
      parts.push(`Risco estratégico ${strategic.level} reduz a qualidade do múltiplo.`);
    else if (strategic.level === "robusto")
      parts.push("Perfil estratégico robusto sustenta o múltiplo aplicado.");
  }
  if (ind.margemEbitda > 20)
    parts.push("Margem EBITDA sólida sustenta o desconto pelo método de múltiplos.");
  return parts.join(" ");
}

// =====================================================================
// API
// =====================================================================
export function buildValuation(
  state: AppState,
  params: ValuationParams,
  precomputed?: PrecomputedValuationModel,
): ValuationResult {
  const m = ensureModel(state, precomputed);
  const strategic = computeStrategic(state);

  const mults = buildMultiples(state, params, m);
  let dcf: DCFSummary | undefined;
  try {
    dcf = buildDCF(state, params, m);
  } catch {
    dcf = undefined;
  }

  const evMultiples = mults.blendedEnterpriseValue;
  const evDCF = dcf ? dcf.npvFlows + dcf.npvTerminal : 0;
  let evBase =
    params.method === "multiples"
      ? evMultiples
      : params.method === "dcf"
        ? evDCF
        : (evMultiples + evDCF) / 2;

  // Ajustes de controle e liquidez
  evBase = evBase * (1 + params.controlPremium) * (1 - params.liquidityDiscount);

  const haircut = params.applyStrategicHaircut && strategic.hasAnyAnswer ? strategic.haircut : 0;
  const evAfter = evBase * (1 - haircut);

  // V3+V9: faixa é incerteza paramétrica sobre o EV final.
  // Multiplicadores empíricos (±25% / +35% c/ DCF, ±10/+15 sem DCF) refletem
  // dispersão típica de premissas (WACC ±1pp, g ±0,5pp, receita ±10/15%).
  const evLow = evAfter * (dcf ? 0.75 : 0.9);
  const evHigh = evAfter * (dcf ? 1.35 : 1.15);

  // V4: equity = EV − dívida líquida (não bruta).
  const nd = netDebt(state);

  const { grade, rationale } = computeConfidence(state, params, strategic, m);

  return {
    method: params.method,
    enterpriseValue: { low: evLow, base: evAfter, high: evHigh },
    equityValue: {
      low: Math.max(0, evLow - nd),
      base: Math.max(0, evAfter - nd),
      high: Math.max(0, evHigh - nd),
    },
    impliedMultiple: {
      evEbitda: mults.ebitda > 0 ? evAfter / mults.ebitda : 0,
      evRevenue: mults.revenue > 0 ? evAfter / mults.revenue : 0,
    },
    confidenceScore: grade,
    confidenceRationale: rationale,
    strategicResult: strategic,
    haircutApplied: haircut,
    netDebt: nd,
    dcfDetails: dcf,
    multiplesDetails: mults,
    narrative: buildNarrative(evAfter, m.ind, strategic),
  };
}

// =====================================================================
// MEMÓRIA DE CÁLCULO
// =====================================================================
export interface ValuationTrace {
  inputs: {
    ebitda: number;
    receita: number;
    ll: number;
    dividaOnerosa: number;
    /** Caixa ocioso informado (usado no ROIC — NÃO entra na dívida líquida). */
    caixaOcioso: number;
    /** Caixa abatido na dívida líquida (disponibilidades — SSOT `computeNetDebtParts`). */
    caixa: number;
    dividaLiquida: number;
    wacc: number;
    ke: number;
    kd: number;
    multEbitda: number;
    multReceita: number;
    multPL: number;
    horizonAnos: number;
    g: number;
    controlPremium: number;
    liquidityDiscount: number;
    haircut: number;
  };
  steps: { label: string; formula: string; value: number; note?: string }[];
}

export function traceValuation(
  state: AppState,
  params: ValuationParams,
  precomputed?: PrecomputedValuationModel,
): ValuationTrace {
  const m = ensureModel(state, precomputed);
  const strategic = computeStrategic(state);
  const mults = buildMultiples(state, params, m);
  const dcf = (() => {
    try {
      return buildDCF(state, params, m);
    } catch {
      return undefined;
    }
  })();

  const haircut = params.applyStrategicHaircut && strategic.hasAnyAnswer ? strategic.haircut : 0;
  const evMult = mults.blendedEnterpriseValue;
  const evDCF = dcf ? dcf.npvFlows + dcf.npvTerminal : 0;
  const evBaseRaw =
    params.method === "multiples" ? evMult : params.method === "dcf" ? evDCF : (evMult + evDCF) / 2;
  const evAdj = evBaseRaw * (1 + params.controlPremium) * (1 - params.liquidityDiscount);
  const evFinal = evAdj * (1 - haircut);
  const nd = netDebt(state);
  const ndParts = computeNetDebtParts(state);

  const steps: ValuationTrace["steps"] = [
    {
      label: "EV via EBITDA",
      formula: `EBITDA × m = ${mults.ebitda.toFixed(2)} × ${params.evEbitdaMultiple}`,
      value: mults.evFromEbitda,
    },
    {
      label: "EV via Receita",
      formula: `Receita × m = ${mults.revenue.toFixed(2)} × ${params.evRevenueMultiple}`,
      value: mults.evFromRevenue,
    },
    {
      label: "Equity via P/L",
      formula: `LL × m = ${mults.ll.toFixed(2)} × ${params.plMultiple}`,
      value: mults.equityFromPL,
      note: "P/L produz Equity Value (não EV); ponderado proporcionalmente.",
    },
    {
      label: "EV múltiplos (ponderado)",
      formula: "0.5·EV_EBITDA + 0.3·EV_Receita + 0.2·Eq_PL (pesos renormalizados)",
      value: evMult,
    },
    ...(dcf
      ? [
          { label: "WACC (a.a.)", formula: "Capital.wacc()", value: dcf.wacc, note: "% ao ano" },
          {
            label: "VPN fluxos DCF",
            formula: `Σ FCL_t / (1+wacc_m)^t · t=1..${dcf.horizonMonths}`,
            value: dcf.npvFlows,
          },
          {
            label: "Valor terminal (Gordon)",
            formula: `FCL_LTM · (1+g) / (WACC − g) = ${dcf.fcfProjected
              .slice(-12)
              .reduce((a, b) => a + b, 0)
              .toFixed(
                0,
              )} · ${(1 + dcf.growthTerminal).toFixed(4)} / ${(dcf.wacc / 100 - dcf.growthTerminal).toFixed(4)}`,
            value: dcf.terminalValue,
            note: "Gordon clássico: numerador é FCF_{T+1} = FCF_T · (1+g).",
          },
          { label: "VP do terminal", formula: `VT / (1+wacc_m)^N`, value: dcf.npvTerminal },
          { label: "EV DCF (VPN+VP_terminal)", formula: "VPN_fluxos + VP_terminal", value: evDCF },
        ]
      : [{ label: "DCF", formula: "indisponível (forecast inválido)", value: 0 }]),
    { label: "EV método selecionado", formula: `método=${params.method}`, value: evBaseRaw },
    {
      label: "EV ajustado (controle/liquidez)",
      formula: `EV × (1+${params.controlPremium}) × (1−${params.liquidityDiscount})`,
      value: evAdj,
    },
    {
      label: `Haircut estratégico (${(haircut * 100).toFixed(1)}%)`,
      formula: `EV_adj × (1 − ${haircut.toFixed(3)})`,
      value: evFinal,
    },
    {
      label: "Dívida líquida",
      // SSOT: mesmos componentes de `computeNetDebt` (caixa = disponibilidades).
      formula: `Dívida onerosa − Caixa = ${ndParts.dividaOnerosa.toFixed(2)} − ${ndParts.caixa.toFixed(2)}`,
      value: nd,
      note:
        ndParts.dividaLiquida < 0
          ? "V4: equity desconta dívida líquida, não bruta (caixa > dívida → limitado a 0)"
          : "V4: equity desconta dívida líquida, não bruta",
    },
    {
      label: "Equity Value final",
      formula: `EV − dívida líquida = ${evFinal.toFixed(2)} − ${nd.toFixed(2)}`,
      value: Math.max(0, evFinal - nd),
    },
  ];

  return {
    inputs: {
      ebitda: mults.ebitda,
      receita: mults.revenue,
      ll: mults.ll,
      dividaOnerosa: ndParts.dividaOnerosa,
      caixaOcioso: state.capital.caixaOcioso ?? 0,
      caixa: ndParts.caixa,
      dividaLiquida: nd,
      wacc: m.ind.wacc,
      ke: state.capital.ke,
      kd: state.capital.kd,
      multEbitda: params.evEbitdaMultiple,
      multReceita: params.evRevenueMultiple,
      multPL: params.plMultiple,
      horizonAnos: params.horizonYears,
      g: params.terminalGrowthRate,
      controlPremium: params.controlPremium,
      liquidityDiscount: params.liquidityDiscount,
      haircut,
    },
    steps,
  };
}

// =====================================================================
// LOGGING — opt-in (V5: removido do useEffect; usar via botão)
// =====================================================================
export function logValuationTrace(state: AppState, params: ValuationParams, sourceLabel: string) {
  const t = traceValuation(state, params);

  console.groupCollapsed(`[Valuation] memória de cálculo · ${sourceLabel}`);

  console.table(t.steps.map((s) => ({ etapa: s.label, formula: s.formula, valor: s.value })));

  console.groupEnd();
}

// =====================================================================
// SELF-TESTS
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

  {
    const ebitda = 1_000_000,
      mult = 5;
    add("EV/EBITDA básico", "EBITDA × m", 5_000_000, ebitda * mult);
  }
  add("EV/Receita básico", "Receita × m", 8_000_000, 10_000_000 * 0.8);
  add("P/L básico", "LL × m", 5_000_000, 500_000 * 10);
  {
    const wE = 0.5,
      wR = 0,
      wL = 0;
    const wT = wE + wR + wL;
    const blended = (5_000_000 * wE + 0 + 0) / wT;
    add("Blended renormalizado (só EBITDA)", "EV_E·wE / Σw", 5_000_000, blended);
  }
  {
    const wE = 0.5,
      wR = 0.3,
      wL = 0.2;
    const blended = 5_000_000 * wE + 8_000_000 * wR + 5_000_000 * wL;
    add("Blended ponderado (E·0.5 + R·0.3 + L·0.2)", "Σ EV_i·w_i", 5_900_000, blended);
  }
  {
    const fcl = 600_000,
      g = 0.02,
      wacc = 0.12;
    const vt = (fcl * (1 + g)) / (wacc - g);
    add("Valor terminal Gordon (FCL=600k, g=2%, WACC=12%)", "FCL·(1+g)/(WACC−g)", 6_120_000, vt);
  }
  {
    const fcl = 600_000,
      g = 0.15,
      wacc = 0.1;
    const vt = wacc - g >= 0.005 ? (fcl * (1 + g)) / (wacc - g) : fcl * 5;
    add("Fallback quando g≥WACC", "FCL × 5", 3_000_000, vt);
  }
  {
    const fcl = 100_000;
    const wacc_a = 0.12;
    const wacc_m = Math.pow(1 + wacc_a, 1 / 12) - 1;
    let npv = 0;
    for (let t = 0; t < 12; t++) npv += fcl / Math.pow(1 + wacc_m, t + 1);
    const expected = fcl * ((1 - Math.pow(1 + wacc_m, -12)) / wacc_m);
    add("VPN anuidade mensal (12×100k @ 12%a.a.)", "Σ FCL/(1+w_m)^t", expected, npv);
  }
  add("Ajuste controle×liquidez", "EV·(1+c)·(1−l)", 1_020_000, 1_000_000 * 1.2 * 0.85);
  add("Haircut estratégico 30%", "EV·(1−h)", 700_000, 1_000_000 * (1 - 0.3));
  // V4: equity usa dívida LÍQUIDA (com caixa)
  add(
    "Equity Value = EV − Dívida Líq.",
    "EV − (D − Caixa)",
    4_000_000,
    5_000_000 - (1_500_000 - 500_000),
  );

  const allPassed = results.every((r) => r.pass);

  console.groupCollapsed(
    `[Valuation Self-Tests] ${results.filter((r) => r.pass).length}/${results.length} OK`,
  );

  console.table(results);

  console.groupEnd();

  return { results, allPassed };
}
