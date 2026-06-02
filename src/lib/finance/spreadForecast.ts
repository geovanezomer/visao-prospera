import { AppState } from "./types";
import { buildDRE, calcIndicators } from "./calculations";
import { buildForecast, DEFAULT_FORECAST_CFG } from "./forecast";
import { sum } from "./format";

export interface SpreadYear {
  ano: number;
  label: string;
  ebit: number;
  nopat: number;
  capitalInvestido: number;
  roic: number;
  wacc: number;
  spread: number;
}

export interface SpreadForecastResult {
  years: SpreadYear[];
  waccConstant: number;
  /** True quando a projeção é praticamente igual ao ano-base (sem crescimento, sem capex). */
  degenerate: boolean;
  /** Em quantos anos a empresa cruza o ponto de equilíbrio (spread = 0). Null se nunca cruza. */
  breakEvenYear: number | null;
}

/**
 * Projeta ROIC × WACC ano a ano usando o forecast existente.
 * Premissas:
 *   • WACC constante (mesma estrutura de capital).
 *   • EBIT_ano = EBITDA projetado − depreciação anual base.
 *   • Alíquota efetiva do ano-base aplicada ao EBIT.
 *   • Capital Investido cresce com capex acumulado dos anos anteriores.
 */
export function buildSpreadForecast(state: AppState, horizonYears = 5): SpreadForecastResult {
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const wacc = ind.wacc;

  const horizonteMeses = horizonYears * 12;
  const forecast = buildForecast(state, { ...DEFAULT_FORECAST_CFG, horizonteMeses });

  const depAnual = sum(dre.depreciacao);
  const impostosAnual = sum(dre.impostos);
  const lairAnual = sum(dre.lair);
  const irShield = 0.34;
  const tcEfetiva = lairAnual > 0 ? Math.min(0.5, impostosAnual / lairAnual) : irShield;

  const PL = Math.max(0, state.capital.patrimonioLiquido);
  const D = Math.max(0, state.capital.dividaOnerosa);
  const caixaOcioso = Math.max(0, state.capital.caixaOcioso ?? 0);
  const passivosNaoOnerosos = Math.max(0, state.capital.passivosNaoOnerosos ?? 0);
  const ciBase = Math.max(1, PL + D - caixaOcioso - passivosNaoOnerosos);

  // Capex projetado por ano (vem do cashflow.capex mensal, replicado em todos os anos do forecast)
  const capexAnualBase = sum(state.cashflow.capex);

  const years: SpreadYear[] = [];
  let capexAcumulado = 0;
  for (let y = 1; y <= horizonYears; y++) {
    const mesesAno = forecast.meses.filter((m) => m.ano === y);
    const ebitda = sum(mesesAno.map((m) => m.ebitda));
    const ebit = ebitda - depAnual;
    const nopat = Math.max(0, ebit * (1 - tcEfetiva));
    // CI cresce com capex dos anos ANTERIORES (capex do ano y vira ativo no fim do ano).
    const ci = Math.max(1, ciBase + capexAcumulado);
    capexAcumulado += capexAnualBase;
    const roic = (nopat / ci) * 100;
    const spread = roic - wacc;
    years.push({
      ano: y,
      label: `Y${y}`,
      ebit,
      nopat,
      capitalInvestido: ci,
      roic,
      wacc,
      spread,
    });
  }

  // Detecta projeção degenerada: spreads praticamente iguais ao do ano-base.
  const variacao = Math.max(...years.map((y) => y.spread)) - Math.min(...years.map((y) => y.spread));
  const degenerate = variacao < 0.1; // menos de 0.1 p.p. de variação em 5 anos

  // Ano em que cruza o break-even (de neg para pos, ou pos para neg).
  let breakEvenYear: number | null = null;
  for (let i = 1; i < years.length; i++) {
    if (Math.sign(years[i].spread) !== Math.sign(years[i - 1].spread) && years[i - 1].spread !== 0) {
      breakEvenYear = years[i].ano;
      break;
    }
  }

  return { years, waccConstant: wacc, degenerate, breakEvenYear };
}
