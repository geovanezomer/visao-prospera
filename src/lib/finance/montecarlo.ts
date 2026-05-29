import { AppState } from "./types";
import { buildDRE } from "./calculations";
import { buildCashFlow } from "./cashflow";
import { sum } from "./format";

export interface MCConfig {
  iterations: number;
  precoSigmaPct: number;   // desvio-padrão em pp do crescimento de preço (ex 5 → ±5%)
  volumeSigmaPct: number;
  cpvSigmaPct: number;
  folhaSigmaPct: number;
}

export const DEFAULT_MC: MCConfig = {
  iterations: 1000,
  precoSigmaPct: 5,
  volumeSigmaPct: 8,
  cpvSigmaPct: 5,
  folhaSigmaPct: 3,
};

export interface MCDist {
  label: string;
  values: number[];           // ordenado
  mean: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  probPositive: number;       // % de cenários com valor > 0
}

export interface MCResult {
  iterations: number;
  ebitda: MCDist;
  lucroLiquido: MCDist;
  saldoCaixaFinal: MCDist;
  probPrejuizo: number;
  probCaixaNegativo: number;
}

// Box-Muller para amostragem normal padrão
function randn(): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const LABOR_RE = /sal[áa]rio|folha|clt|prolabore|pró-labore|mod|mão de obra/i;

function shockState(s: AppState, cfg: MCConfig): AppState {
  const fPreco = 1 + (randn() * cfg.precoSigmaPct) / 100;
  const fVol = 1 + (randn() * cfg.volumeSigmaPct) / 100;
  const fCpv = 1 + (randn() * cfg.cpvSigmaPct) / 100;
  const fFolha = 1 + (randn() * cfg.folhaSigmaPct) / 100;

  const fReceita = fPreco * fVol;
  const revenue = { ...s.revenue, bruta: s.revenue.bruta.map((v) => v * fReceita) };
  const costs = s.costs.map((c) => {
    const isLabor = c.encargosAuto || LABOR_RE.test(c.label);
    if (c.category === "custo_vendas") {
      // volume varia + cpv unitário varia
      return { ...c, values: c.values.map((v) => v * fVol * fCpv) };
    }
    if (c.category === "variavel") return { ...c, values: c.values.map((v) => v * fVol) };
    if (isLabor) return { ...c, values: c.values.map((v) => v * fFolha) };
    return c;
  });
  return { ...s, revenue, costs };
}

function distFrom(values: number[], label: string): MCDist {
  const sorted = values.slice().sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))];
  const mean = sum(sorted) / sorted.length;
  const median = pct(50);
  const probPositive = sorted.filter((v) => v > 0).length / sorted.length;
  return {
    label, values: sorted, mean, median,
    p5: pct(5), p25: pct(25), p75: pct(75), p95: pct(95),
    probPositive,
  };
}

export function runMonteCarlo(state: AppState, cfg: MCConfig = DEFAULT_MC): MCResult {
  const ebitdaArr: number[] = [];
  const llArr: number[] = [];
  const saldoArr: number[] = [];

  for (let it = 0; it < cfg.iterations; it++) {
    const shocked = shockState(state, cfg);
    const { dre } = buildDRE(shocked, shocked.tax.regime);
    const cf = buildCashFlow(shocked);
    ebitdaArr.push(sum(dre.ebitda));
    llArr.push(sum(dre.lucroLiquido));
    saldoArr.push(cf.totais.saldoFinal);
  }

  return {
    iterations: cfg.iterations,
    ebitda: distFrom(ebitdaArr, "EBITDA"),
    lucroLiquido: distFrom(llArr, "Lucro Líquido"),
    saldoCaixaFinal: distFrom(saldoArr, "Saldo de Caixa (Dez)"),
    probPrejuizo: llArr.filter((v) => v < 0).length / llArr.length,
    probCaixaNegativo: saldoArr.filter((v) => v < state.cashflow.caixaMinimo).length / saldoArr.length,
  };
}

// Histograma simples para gráfico (n bins)
export function histogram(values: number[], bins = 30): { x: number; count: number }[] {
  if (values.length === 0) return [];
  const min = values[0], max = values[values.length - 1];
  if (min === max) return [{ x: min, count: values.length }];
  const step = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({ x: min + step * (i + 0.5), count: 0 }));
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
    buckets[idx].count++;
  }
  return buckets;
}
