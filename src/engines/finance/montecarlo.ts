import { AppState } from "./types";
import { buildDRE } from "./dre";
import { isLaborLine } from "./costs";
import { resolveEffectiveRegime } from "./regime";
import { buildCashFlow } from "./cashflow";
import { sum } from "./format";

/**
 * Matriz de correlação 4x4 entre os choques [preço, volume, CPV, folha].
 * Simétrica, diagonal=1, elementos em [-1, 1]. Deve ser positiva
 * semidefinida (Cholesky falha caso contrário — fallback é identidade).
 */
export type CorrelationMatrix = number[][];

export interface MCConfig {
  iterations: number;
  precoSigmaPct: number; // desvio-padrão em pp do crescimento de preço (ex 5 → ±5%)
  volumeSigmaPct: number;
  cpvSigmaPct: number;
  folhaSigmaPct: number;
  /** Matriz de correlação 4x4 entre [preço, volume, CPV, folha].
   *  Quando omitida, usa DEFAULT_CORRELATIONS (correlações economicamente
   *  defensáveis: lei da demanda, economias de escala, inflação setorial). */
  correlations?: CorrelationMatrix;
}

/**
 * Correlações default — fundamentação econômica:
 *  - preço × volume = −0.30 → lei da demanda (preço↑ ⇒ volume↓)
 *  - preço × CPV    = +0.20 → repasse inflacionário a custos de aquisição
 *  - preço × folha  = +0.10 → reajustes salariais e dissídios acompanham preços
 *  - volume × CPV   = −0.20 → economias de escala (volume↑ ⇒ CPV unitário↓)
 *  - volume × folha = +0.30 → horas extras / contratações em picos de demanda
 *  - CPV × folha    = +0.40 → ambos sensíveis à inflação setorial e câmbio
 *
 * Ordem dos índices: 0=preço, 1=volume, 2=CPV, 3=folha.
 */
export const DEFAULT_CORRELATIONS: CorrelationMatrix = [
  [1.0, -0.3, 0.2, 0.1],
  [-0.3, 1.0, -0.2, 0.3],
  [0.2, -0.2, 1.0, 0.4],
  [0.1, 0.3, 0.4, 1.0],
];

export const IDENTITY_CORRELATIONS: CorrelationMatrix = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

export const DEFAULT_MC: MCConfig = {
  iterations: 1000,
  precoSigmaPct: 5,
  volumeSigmaPct: 8,
  cpvSigmaPct: 5,
  folhaSigmaPct: 3,
  correlations: DEFAULT_CORRELATIONS,
};

export interface MCDist {
  label: string;
  values: number[]; // ordenado
  mean: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  probPositive: number; // % de cenários com valor > 0
}

export interface MCResult {
  iterations: number;
  ebitda: MCDist;
  lucroLiquido: MCDist;
  saldoCaixaFinal: MCDist;
  probPrejuizo: number;
  probCaixaNegativo: number;
  /** True se a matriz informada não passou no teste de positiva semidefinida
   *  (Cholesky falhou) e o motor caiu para choques independentes. */
  correlationFellBackToIdentity?: boolean;
}

// Box-Muller para amostragem normal padrão N(0,1).
// M10: aproveita o par (cos, sin) — cada 2 chamadas usam apenas 2 randoms
// (antes: 2 chamadas × 2 randoms = 4). Cache do valor spare entre chamadas.
let __randnSpare: number | null = null;
function randn(): number {
  if (__randnSpare !== null) {
    const v = __randnSpare;
    __randnSpare = null;
    return v;
  }
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  const theta = 2 * Math.PI * v;
  __randnSpare = r * Math.sin(theta);
  return r * Math.cos(theta);
}

/**
 * Decomposição de Cholesky: dada matriz simétrica positiva-definida Σ,
 * retorna L triangular inferior tal que L · Lᵀ = Σ. Retorna null se a
 * matriz não é PD (raiz quadrada de número não-positivo na diagonal).
 *
 * Algoritmo clássico O(n³), suficiente para n=4.
 */
export function choleskyDecompose(m: CorrelationMatrix): number[][] | null {
  const n = m.length;
  if (n === 0 || !m.every((row) => row.length === n)) return null;
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
      if (i === j) {
        const diag = m[i][i] - s;
        // Tolerância numérica: matriz "quase singular" ainda é aceitável.
        if (diag <= -1e-10) return null;
        L[i][j] = Math.sqrt(Math.max(0, diag));
      } else {
        if (L[j][j] === 0) return null;
        L[i][j] = (m[i][j] - s) / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Gera um vetor de n choques normais correlacionados a partir de L
 * (Cholesky de Σ). Se z ~ N(0, I), então L·z ~ N(0, Σ).
 */
function correlatedNormals(L: number[][]): number[] {
  const n = L.length;
  const z = Array.from({ length: n }, () => randn());
  const out = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j <= i; j++) s += L[i][j] * z[j];
    out[i] = s;
  }
  return out;
}

/**
 * Aplica choques (já em unidades de desvio-padrão) ao AppState.
 * Recebe vetor [zPreco, zVolume, zCpv, zFolha] em N(0,1) correlacionados.
 */
function shockState(s: AppState, cfg: MCConfig, shocks: number[]): AppState {
  const [zPreco, zVol, zCpv, zFolha] = shocks;
  // Bloco 8 (auditoria): clipping a [0.05, +∞). Sem clip, choques negativos
  // grandes (z ≤ −1/σ) produzem fator NEGATIVO → receita/CPV/folha negativos
  // contaminam a iteração com nonsense (EBITDA falsamente positivo via custo
  // negativo). Piso 5% representa "operação quase parada", interpretável.
  const clip = (f: number) => Math.max(0.05, f);
  const fPreco = clip(1 + (zPreco * cfg.precoSigmaPct) / 100);
  const fVol = clip(1 + (zVol * cfg.volumeSigmaPct) / 100);
  const fCpv = clip(1 + (zCpv * cfg.cpvSigmaPct) / 100);
  const fFolha = clip(1 + (zFolha * cfg.folhaSigmaPct) / 100);

  const fReceita = fPreco * fVol;
  const revenue = { ...s.revenue, bruta: s.revenue.bruta.map((v) => v * fReceita) };
  const costs = s.costs.map((c) => {
    const isLabor = isLaborLine(c); // SSOT costs.ts
    if (c.category === "custo_vendas") {
      // CPV total = volume × CPV unitário (ambos shocados).
      return { ...c, values: c.values.map((v) => v * fVol * fCpv) };
    }
    if (c.category === "variavel" || c.category === "despesa_comercial")
      return { ...c, values: c.values.map((v) => v * fVol) };
    if (isLabor) return { ...c, values: c.values.map((v) => v * fFolha) };
    return c;
  });
  return { ...s, revenue, costs };
}

function distFrom(values: number[], label: string): MCDist {
  const sorted = values.slice().sort((a, b) => a - b);
  // Auditoria #12: percentil sem viés — índice é floor(p × (n−1)) e não floor(p × n).
  // A forma anterior deslocava P95 em ~0,5pp em 200 iterações.
  const pct = (p: number) => {
    const n = sorted.length;
    if (n === 0) return 0;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((p / 100) * (n - 1))));
    return sorted[idx];
  };
  const mean = sum(sorted) / sorted.length;
  const median = pct(50);
  const probPositive = sorted.filter((v) => v > 0).length / sorted.length;
  return {
    label,
    values: sorted,
    mean,
    median,
    p5: pct(5),
    p25: pct(25),
    p75: pct(75),
    p95: pct(95),
    probPositive,
  };
}

export function runMonteCarlo(state: AppState, cfg: MCConfig = DEFAULT_MC): MCResult {
  const ebitdaArr: number[] = [];
  const llArr: number[] = [];
  const saldoArr: number[] = [];

  // Tenta Cholesky da matriz informada; se falhar (não-PSD), cai para
  // choques independentes (identidade) e sinaliza no resultado.
  const corr = cfg.correlations ?? DEFAULT_CORRELATIONS;
  let L = choleskyDecompose(corr);
  const fellBack = L === null;
  if (!L) L = choleskyDecompose(IDENTITY_CORRELATIONS)!;

  for (let it = 0; it < cfg.iterations; it++) {
    const shocks = correlatedNormals(L);
    const shocked = shockState(state, cfg, shocks);
    // SSOT: regime EFETIVO sobre o estado shockado (RBT12 simulada pode
    // ultrapassar o limite do Simples em iterações otimistas).
    const { dre } = buildDRE(shocked, resolveEffectiveRegime(shocked));
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
    probCaixaNegativo:
      saldoArr.filter((v) => v < state.cashflow.caixaMinimo).length / saldoArr.length,
    correlationFellBackToIdentity: fellBack || undefined,
  };
}

// Histograma simples para gráfico (n bins)
export function histogram(values: number[], bins = 30): { x: number; count: number }[] {
  if (values.length === 0) return [];
  // Min/Max explícitos — não assume input ordenado (era invariante implícita frágil).
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return [{ x: min, count: values.length }];
  const step = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({ x: min + step * (i + 0.5), count: 0 }));
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
    buckets[idx].count++;
  }
  return buckets;
}
