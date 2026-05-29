import { AppState } from "./types";
import { buildDRE, calcIndicators } from "./calculations";
import { sum } from "./format";

export interface ForecastMonth {
  idx: number;            // 0..35
  ano: number;            // 1..3
  mes: number;            // 1..12
  label: string;          // "Y1 Jan"
  receita: number;
  ebitda: number;
  lucroLiquido: number;
  fcl: number;            // EBITDA - impostos - capex (proxy de FCL)
  saldoCaixa: number;     // acumulado
}

export interface ForecastResult {
  meses: ForecastMonth[];
  totalReceita: number;
  totalEbitda: number;
  totalLucro: number;
  totalFcl: number;
  vpl: number;
  tir: number | null;     // %a.m.
  paybackMeses: number | null;
  taxaDescontoMensal: number;
}

/**
 * Projeta 36 meses aplicando crescimento mensal composto a receita e capex,
 * mantendo a estrutura de custos proporcional. EBITDA e LL escalam com a margem
 * efetiva do ano-base (ano 1). Aproximação consultiva — não substitui modelo formal.
 */
export function buildForecast(state: AppState, growthMonthlyPct: number, horizonMonths = 36, capexInicial = 0): ForecastResult {
  const { dre } = buildDRE(state, state.tax.regime);
  const receitaBase = dre.receitaBruta.slice();
  const ebitdaBase = dre.ebitda.slice();
  const llBase = dre.lucroLiquido.slice();
  const impostosBase = dre.impostos.slice();
  const capexBase = state.cashflow.capex.slice();

  const g = growthMonthlyPct / 100;
  const meses: ForecastMonth[] = [];
  let saldo = state.capital.disponibilidades - capexInicial;

  for (let i = 0; i < horizonMonths; i++) {
    const ano = Math.floor(i / 12) + 1;
    const mes = (i % 12);
    const fator = Math.pow(1 + g, i);

    const receita = receitaBase[mes] * fator;
    const ebitda = ebitdaBase[mes] * fator;
    const ll = llBase[mes] * fator;
    const imp = impostosBase[mes] * fator;
    const capex = capexBase[mes] * fator;
    const fcl = ebitda - imp - capex;
    saldo += fcl;

    meses.push({
      idx: i, ano, mes: mes + 1,
      label: `Y${ano} ${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][mes]}`,
      receita, ebitda, lucroLiquido: ll, fcl, saldoCaixa: saldo,
    });
  }

  // VPL: usa WACC anualizado convertido em mensal
  const ind = calcIndicators(state, dre);
  const waccA = Math.max(0.5, ind.wacc) / 100;
  const i_m = Math.pow(1 + waccA, 1 / 12) - 1;
  const flows: number[] = [-capexInicial, ...meses.map((m) => m.fcl)];
  const vpl = npv(flows, i_m);
  const tir = irr(flows);
  const payback = paybackMonths(flows);

  return {
    meses,
    totalReceita: sum(meses.map((m) => m.receita)),
    totalEbitda: sum(meses.map((m) => m.ebitda)),
    totalLucro: sum(meses.map((m) => m.lucroLiquido)),
    totalFcl: sum(meses.map((m) => m.fcl)),
    vpl,
    tir: tir == null ? null : tir * 100,
    paybackMeses: payback,
    taxaDescontoMensal: i_m * 100,
  };
}

// VPL: flows[0] no t=0
export function npv(flows: number[], rate: number): number {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) acc += flows[t] / Math.pow(1 + rate, t);
  return acc;
}

// TIR via Newton-Raphson com fallback bisseção
export function irr(flows: number[], guess = 0.01): number | null {
  // valida sinais
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;

  let r = guess;
  for (let iter = 0; iter < 80; iter++) {
    let f = 0, df = 0;
    for (let t = 0; t < flows.length; t++) {
      const d = Math.pow(1 + r, t);
      f += flows[t] / d;
      if (t > 0) df += -t * flows[t] / (d * (1 + r));
    }
    if (Math.abs(f) < 1e-7) return r;
    if (df === 0) break;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -0.999) break;
    r = next;
  }
  // bisseção fallback
  let lo = -0.99, hi = 10;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const v = npv(flows, mid);
    if (Math.abs(v) < 1e-6) return mid;
    if (npv(flows, lo) * v < 0) hi = mid; else lo = mid;
  }
  return null;
}

function paybackMonths(flows: number[]): number | null {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) {
    acc += flows[t];
    if (acc >= 0 && t > 0) return t;
  }
  return null;
}
