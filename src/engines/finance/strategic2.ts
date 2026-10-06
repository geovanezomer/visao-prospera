// ============================================================================
// Simulador estratégico 2.0 — insights de decisão sobre o motor do simulador.
//
// Tudo é função pura sobre (estado-base, parâmetros do simulador). No modo
// Odoo o estado-base é ancorado no razão, então cada resposta parte do
// realizado e mede o EFEITO das decisões (ver engines/finance/anchor.ts).
//
//   bridge          → quanto cada alavanca contribui (valor de Shapley — a
//                     soma bate exatamente com a diferença total, sem
//                     depender da ordem em que as alavancas são aplicadas)
//   tornado         → sensibilidade: ±1 passo de cada alavanca
//   priceVolume     → volume necessário para compensar preço (margem de contribuição)
//   goalSeek        → "que valor da alavanca X atinge a meta Y?"
//   stressTests     → choques de mercado: caixa mínimo, crédito necessário
//   valueCreation   → ROIC × WACC e EVA, base × simulado
//   regimeAdvice    → melhor regime no cenário simulado
// ============================================================================
import type { AppState } from "./types";
import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "./simulator";
import { buildDRE } from "./dre";
import { buildCashFlow } from "./cashflow";
import { resolveEffectiveRegime, simplesExcedeLimite } from "./regime";
import { buildFinancialModel } from "./financialModel";
import { compareRegimes } from "./tax/compare";

const sum = (a: number[]) => a.reduce((x, y) => x + (y || 0), 0);

export type MetricKey = "ebitda" | "lucroLiquido" | "caixaFinal" | "caixaMinimo" | "receitaLiquida";

export const METRIC_LABELS: Record<MetricKey, string> = {
  ebitda: "EBITDA",
  lucroLiquido: "Lucro líquido",
  caixaFinal: "Caixa no fim do período",
  caixaMinimo: "Pior saldo de caixa do período",
  receitaLiquida: "Receita líquida",
};

export type Metrics = Record<MetricKey, number> & { caixaMinimoMes: number };

/** Métricas de um estado (já simulado). */
export function metricsOf(state: AppState): Metrics {
  const regime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, regime);
  const cf = buildCashFlow(state, regime);
  let minI = 0;
  for (let i = 1; i < 12; i++) if (cf.saldoFinal[i] < cf.saldoFinal[minI]) minI = i;
  return {
    ebitda: sum(dre.ebitda),
    lucroLiquido: sum(dre.lucroLiquido),
    caixaFinal: cf.saldoFinal[11] ?? 0,
    caixaMinimo: cf.saldoFinal[minI] ?? 0,
    caixaMinimoMes: minI,
    receitaLiquida: sum(dre.receitaLiquida),
  };
}

export const simMetrics = (base: AppState, p: SimulatorParams) =>
  metricsOf(applySimulator(base, p));

// ---------------------------------------------------------------------------
// Alavancas como "jogadores" (grupos de parâmetros que andam juntos)
// ---------------------------------------------------------------------------

export type Player = { id: string; label: string; keys: (keyof SimulatorParams)[] };

export const PLAYERS: Player[] = [
  { id: "preco", label: "Preço", keys: ["priceDeltaPct", "priceElasticity"] },
  { id: "volume", label: "Volume", keys: ["volumeDeltaPct"] },
  { id: "cpv", label: "Custo dos produtos/serviços", keys: ["cpvDeltaPct"] },
  { id: "folha", label: "Folha", keys: ["payrollDeltaPct"] },
  { id: "prolabore", label: "Pró-labore", keys: ["prolaboreDeltaPct"] },
  { id: "fixos", label: "Despesas fixas", keys: ["fixedCutPct", "fixedCutTopN"] },
  { id: "pmr", label: "Prazo de recebimento", keys: ["pmrDeltaDays"] },
  { id: "pmp", label: "Prazo de pagamento", keys: ["pmpDeltaDays"] },
  { id: "antecip", label: "Antecipação de recebíveis", keys: ["antecipPctAm", "antecipShare"] },
  { id: "inadimp", label: "Inadimplência", keys: ["inadimplenciaDeltaPp"] },
  {
    id: "divida",
    label: "Novo empréstimo",
    keys: ["loanPrincipal", "loanTermMonths", "loanRatePctAm"],
  },
  { id: "quitacao", label: "Quitação de dívida", keys: ["debtPaydownPct"] },
  { id: "kd", label: "Custo da dívida (Selic)", keys: ["kdDeltaPp"] },
  { id: "distrib", label: "Distribuição de lucros", keys: ["distribuicaoDeltaPct"] },
  { id: "regime", label: "Regime tributário", keys: ["regimeOverride"] },
];

/** Jogador está ativo quando algum parâmetro "de efeito" difere do padrão. */
function isActive(pl: Player, p: SimulatorParams): boolean {
  const effect: Partial<Record<string, keyof SimulatorParams>> = {
    preco: "priceDeltaPct",
    fixos: "fixedCutPct",
    antecip: "antecipPctAm",
    divida: "loanPrincipal",
  };
  const k = effect[pl.id] ?? pl.keys[0];
  return p[k] !== DEFAULT_SIM[k];
}

function paramsFor(players: Player[], p: SimulatorParams): SimulatorParams {
  const out = { ...DEFAULT_SIM } as Record<string, unknown>;
  for (const pl of players) for (const k of pl.keys) out[k] = p[k];
  return out as unknown as SimulatorParams;
}

export type BridgeItem = { id: string; label: string } & Record<MetricKey, number>;
export type BridgeResult = {
  base: Metrics;
  simulado: Metrics;
  itens: BridgeItem[];
  /** "exato" (todas as combinações) ou "amostrado" (permutações aleatórias). */
  metodo: "exato" | "amostrado";
};

const METRIC_KEYS: MetricKey[] = [
  "ebitda",
  "lucroLiquido",
  "caixaFinal",
  "caixaMinimo",
  "receitaLiquida",
];

/**
 * Ponte base → simulado por alavanca (valor de Shapley). As contribuições
 * somam exatamente a diferença total e não dependem da ordem das alavancas
 * (interações — ex.: preço × volume — são repartidas de forma justa).
 */
export function bridge(
  base: AppState,
  p: SimulatorParams,
  opts: { maxExact?: number; samples?: number } = {},
): BridgeResult {
  const active = PLAYERS.filter((pl) => isActive(pl, p));
  const n = active.length;
  const cache = new Map<number, Metrics>();
  const value = (mask: number): Metrics => {
    let m = cache.get(mask);
    if (!m) {
      m = simMetrics(
        base,
        paramsFor(
          active.filter((_, i) => mask & (1 << i)),
          p,
        ),
      );
      cache.set(mask, m);
    }
    return m;
  };
  const baseM = value(0);
  const full = (1 << n) - 1;
  const simM = n ? value(full) : baseM;
  const contrib = active.map(
    () => Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Record<MetricKey, number>,
  );
  const exact = n <= (opts.maxExact ?? 7);

  const addMarginal = (i: number, without: number, w: number) => {
    const a = value(without);
    const b = value(without | (1 << i));
    for (const k of METRIC_KEYS) contrib[i][k] += w * (b[k] - a[k]);
  };

  if (exact) {
    const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
    for (let i = 0; i < n; i++) {
      for (let mask = 0; mask <= full; mask++) {
        if (mask & (1 << i)) continue;
        const s = popcount(mask);
        addMarginal(i, mask, (fact(s) * fact(n - s - 1)) / fact(n));
      }
    }
  } else {
    const samples = opts.samples ?? 40;
    const rnd = mulberry32(42);
    for (let t = 0; t < samples; t++) {
      const order = shuffle([...Array(n).keys()], rnd);
      let mask = 0;
      for (const i of order) {
        addMarginal(i, mask, 1 / samples);
        mask |= 1 << i;
      }
    }
  }
  return {
    base: baseM,
    simulado: simM,
    itens: active.map((pl, i) => ({ id: pl.id, label: pl.label, ...contrib[i] })),
    metodo: exact ? "exato" : "amostrado",
  };
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** PRNG determinístico (resultados reprodutíveis). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Tornado
// ---------------------------------------------------------------------------

export type LeverSpec = {
  key: keyof SimulatorParams;
  label: string;
  unidade: string;
  passo: number;
  min: number;
  max: number;
};

/** Alavancas contínuas: passo do tornado e limites da busca de metas. */
export const LEVERS: LeverSpec[] = [
  { key: "priceDeltaPct", label: "Preço", unidade: "%", passo: 5, min: -50, max: 50 },
  { key: "volumeDeltaPct", label: "Volume", unidade: "%", passo: 10, min: -80, max: 200 },
  {
    key: "cpvDeltaPct",
    label: "Custo dos produtos/serviços",
    unidade: "%",
    passo: 5,
    min: -50,
    max: 50,
  },
  { key: "payrollDeltaPct", label: "Folha", unidade: "%", passo: 10, min: -60, max: 60 },
  {
    key: "fixedCutPct",
    label: "Corte de despesas fixas (top N)",
    unidade: "%",
    passo: 10,
    min: -50,
    max: 60,
  },
  {
    key: "pmrDeltaDays",
    label: "Prazo de recebimento",
    unidade: " dias",
    passo: 15,
    min: -120,
    max: 120,
  },
  {
    key: "pmpDeltaDays",
    label: "Prazo de pagamento",
    unidade: " dias",
    passo: 15,
    min: -120,
    max: 120,
  },
  {
    key: "inadimplenciaDeltaPp",
    label: "Inadimplência",
    unidade: " p.p.",
    passo: 2,
    min: -10,
    max: 20,
  },
  { key: "kdDeltaPp", label: "Custo da dívida", unidade: " p.p.", passo: 3, min: -10, max: 15 },
];

export type TornadoBar = {
  key: keyof SimulatorParams;
  label: string;
  passo: string;
  baixo: number;
  alto: number;
  amplitude: number;
};

/** ±1 passo de cada alavanca a partir do cenário atual; ordenado pela amplitude. */
export function tornado(
  base: AppState,
  p: SimulatorParams,
  metric: MetricKey,
): { atual: number; barras: TornadoBar[] } {
  const atual = simMetrics(base, p)[metric];
  const barras = LEVERS.map((l) => {
    const v = Number(p[l.key]) || 0;
    const lo = simMetrics(base, { ...p, [l.key]: Math.max(l.min, v - l.passo) })[metric] - atual;
    const hi = simMetrics(base, { ...p, [l.key]: Math.min(l.max, v + l.passo) })[metric] - atual;
    return {
      key: l.key,
      label: l.label,
      passo: `±${l.passo}${l.unidade}`,
      baixo: lo,
      alto: hi,
      amplitude: Math.abs(hi - lo),
    };
  }).sort((a, b) => b.amplitude - a.amplitude);
  return { atual, barras };
}

// ---------------------------------------------------------------------------
// Preço × volume
// ---------------------------------------------------------------------------

export type PriceVolumePoint = {
  precoPct: number;
  /** Variação de volume que mantém a margem de contribuição total (fração). */
  volumeEquilibrio: number;
  /** Elasticidade a partir da qual a mudança de preço destrói margem. */
  elasticidadeLimite: number | null;
};

/**
 * Com margem de contribuição m (fração da receita líquida), uma variação de
 * preço dP mantém a contribuição total se o volume variar ΔV* = −dP/(m+dP).
 * Ex.: m = 30% e corte de 10% → volume precisa subir 50%.
 */
export function priceVolume(state: AppState): { margem: number; pontos: PriceVolumePoint[] } {
  const regime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, regime);
  const rl = sum(dre.receitaLiquida);
  const cv = sum(dre.custosVariaveis);
  const m = rl > 0 ? (rl - cv) / rl : 0;
  const pontos = [-20, -15, -10, -5, 5, 10, 15, 20].map((pct) => {
    const dp = pct / 100;
    const dv = m + dp > 0 ? -dp / (m + dp) : Number.POSITIVE_INFINITY;
    const e = Number.isFinite(dv) && 1 + dv > 0 ? Math.log(1 + dv) / -Math.log(1 + dp) : null;
    return { precoPct: pct, volumeEquilibrio: dv, elasticidadeLimite: e };
  });
  return { margem: m, pontos };
}

// ---------------------------------------------------------------------------
// Metas (goal seek)
// ---------------------------------------------------------------------------

export type GoalSeekResult =
  | { ok: true; valor: number; atingido: number }
  | { ok: false; motivo: string; melhorValor: number; melhorResultado: number };

/** Bisseção na alavanca (com varredura prévia para achar um intervalo válido). */
export function goalSeek(
  base: AppState,
  p: SimulatorParams,
  lever: keyof SimulatorParams,
  metric: MetricKey,
  alvo: number,
): GoalSeekResult {
  const spec = LEVERS.find((l) => l.key === lever);
  if (!spec)
    return { ok: false, motivo: "Alavanca não suportada.", melhorValor: 0, melhorResultado: 0 };
  const f = (x: number) => simMetrics(base, { ...p, [lever]: x })[metric] - alvo;
  const N = 24;
  const xs = Array.from({ length: N + 1 }, (_, i) => spec.min + ((spec.max - spec.min) * i) / N);
  const ys = xs.map(f);
  let best = 0;
  for (let i = 1; i <= N; i++) if (Math.abs(ys[i]) < Math.abs(ys[best])) best = i;
  // Intervalo com troca de sinal mais próximo do valor atual da alavanca.
  const atual = Number(p[lever]) || 0;
  let pick = -1;
  for (let i = 0; i < N; i++) {
    if (ys[i] === 0) return { ok: true, valor: xs[i], atingido: alvo };
    if (Math.sign(ys[i]) !== Math.sign(ys[i + 1])) {
      if (pick < 0 || Math.abs(xs[i] - atual) < Math.abs(xs[pick] - atual)) pick = i;
    }
  }
  if (pick < 0) {
    return {
      ok: false,
      motivo: `Meta fora do alcance desta alavanca entre ${spec.min}${spec.unidade} e ${spec.max}${spec.unidade}.`,
      melhorValor: xs[best],
      melhorResultado: ys[best] + alvo,
    };
  }
  let lo = xs[pick];
  let hi = xs[pick + 1];
  let flo = ys[pick];
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 0.5) return { ok: true, valor: mid, atingido: fm + alvo };
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  const v = (lo + hi) / 2;
  return { ok: true, valor: v, atingido: f(v) + alvo };
}

// ---------------------------------------------------------------------------
// Testes de estresse
// ---------------------------------------------------------------------------

export type StressResult = {
  id: string;
  nome: string;
  descricao: string;
  caixaMinimo: number;
  mesCaixaMinimo: number;
  primeiroMesNegativo: number | null;
  /** Crédito necessário para não ficar abaixo do caixa mínimo de segurança. */
  creditoNecessario: number;
  deltaLucro: number;
};

function quedaReceita(state: AppState, meses: number[], fator: number): AppState {
  return {
    ...state,
    revenue: {
      ...state.revenue,
      bruta: state.revenue.bruta.map((v, i) => (meses.includes(i) ? v * fator : v)),
    },
    // Custos variáveis caem junto (só o que acompanha volume).
    costs: state.costs.map((c) => {
      const isVar =
        (c.comportamento ??
          (["custo_vendas", "direto_venda", "variavel", "despesa_comercial"].includes(c.category)
            ? "variavel"
            : "fixo")) === "variavel";
      return isVar
        ? { ...c, values: c.values.map((v, i) => (meses.includes(i) ? v * fator : v)) }
        : c;
    }),
  };
}

export function stressTests(base: AppState, p: SimulatorParams): StressResult[] {
  const ref = applySimulator(base, p);
  const refM = metricsOf(ref);
  const minimo = base.cashflow?.caixaMinimo ?? 0;
  const cenarios: Array<{ id: string; nome: string; descricao: string; state: AppState }> = [
    {
      id: "receita",
      nome: "Queda de receita",
      descricao: "Receita 20% menor nos 3 primeiros meses (custos variáveis acompanham).",
      state: quedaReceita(ref, [0, 1, 2], 0.8),
    },
    {
      id: "prazo",
      nome: "Clientes pagam mais tarde",
      descricao: "Prazo médio de recebimento +30 dias.",
      state: applySimulator(base, { ...p, pmrDeltaDays: (p.pmrDeltaDays || 0) + 30 }),
    },
    {
      id: "inadimplencia",
      nome: "Inadimplência",
      descricao: "+5 p.p. de inadimplência.",
      state: applySimulator(base, {
        ...p,
        inadimplenciaDeltaPp: (p.inadimplenciaDeltaPp || 0) + 5,
      }),
    },
    {
      id: "custo",
      nome: "Choque de custos",
      descricao: "Custo dos produtos/serviços +15%.",
      state: applySimulator(base, { ...p, cpvDeltaPct: (p.cpvDeltaPct || 0) + 15 }),
    },
    {
      id: "juros",
      nome: "Juros sobem",
      descricao: "Custo da dívida +3 p.p. ao ano.",
      state: applySimulator(base, { ...p, kdDeltaPp: (p.kdDeltaPp || 0) + 3 }),
    },
  ];
  cenarios.push({
    id: "tempestade",
    nome: "Tempestade perfeita",
    descricao: "Todos os choques acima ao mesmo tempo.",
    state: quedaReceita(
      applySimulator(base, {
        ...p,
        pmrDeltaDays: (p.pmrDeltaDays || 0) + 30,
        inadimplenciaDeltaPp: (p.inadimplenciaDeltaPp || 0) + 5,
        cpvDeltaPct: (p.cpvDeltaPct || 0) + 15,
        kdDeltaPp: (p.kdDeltaPp || 0) + 3,
      }),
      [0, 1, 2],
      0.8,
    ),
  });
  return cenarios.map((c) => {
    const regime = resolveEffectiveRegime(c.state);
    const cf = buildCashFlow(c.state, regime);
    const m = metricsOf(c.state);
    const neg = cf.saldoFinal.findIndex((v) => v < 0);
    return {
      id: c.id,
      nome: c.nome,
      descricao: c.descricao,
      caixaMinimo: m.caixaMinimo,
      mesCaixaMinimo: m.caixaMinimoMes,
      primeiroMesNegativo: neg >= 0 ? neg : null,
      creditoNecessario: Math.max(0, minimo - m.caixaMinimo),
      deltaLucro: m.lucroLiquido - refM.lucroLiquido,
    };
  });
}

// ---------------------------------------------------------------------------
// Criação de valor e regime
// ---------------------------------------------------------------------------

export type ValueSide = {
  nopat: number;
  capitalInvestido: number;
  roic: number;
  wacc: number;
  spread: number;
  eva: number;
  gao: number;
  gaf: number;
  gat: number;
  margemSeguranca: number;
  dscr: number | null;
};

function valueSide(state: AppState): ValueSide {
  const { ind } = buildFinancialModel(state);
  return {
    nopat: ind.nopat,
    capitalInvestido: ind.capitalInvestido,
    roic: ind.roic,
    wacc: ind.wacc,
    spread: ind.roic - ind.wacc,
    eva: ind.eva,
    gao: ind.gao,
    gaf: ind.gaf,
    gat: ind.gao * ind.gaf,
    margemSeguranca: ind.margemSeguranca,
    dscr: ind.dscr,
  };
}

export function valueCreation(
  base: AppState,
  p: SimulatorParams,
): { base: ValueSide; simulado: ValueSide } {
  return { base: valueSide(base), simulado: valueSide(applySimulator(base, p)) };
}

export function regimeAdvice(base: AppState, p: SimulatorParams) {
  const sim = applySimulator(base, p);
  const r = compareRegimes(sim);
  return {
    atual: resolveEffectiveRegime(sim),
    melhor: r.best,
    lucroPorRegime: r.llBy,
    desenquadradoSimples: r.desenquadradoSimples || simplesExcedeLimite(sim),
  };
}

// ---------------------------------------------------------------------------
// Leitura executiva
// ---------------------------------------------------------------------------

export type Insight = { nivel: "positivo" | "atencao" | "risco"; texto: string };

export function narrative(
  br: BridgeResult,
  stress: StressResult[],
  value: { base: ValueSide; simulado: ValueSide },
  regime: ReturnType<typeof regimeAdvice>,
  fmt: (n: number) => string,
): Insight[] {
  const out: Insight[] = [];
  const top = [...br.itens]
    .sort((a, b) => Math.abs(b.lucroLiquido) - Math.abs(a.lucroLiquido))
    .slice(0, 3);
  for (const it of top) {
    out.push({
      nivel: it.lucroLiquido >= 0 ? "positivo" : "atencao",
      texto: `${it.label}: ${it.lucroLiquido >= 0 ? "+" : ""}${fmt(it.lucroLiquido)} no lucro e ${it.caixaFinal >= 0 ? "+" : ""}${fmt(it.caixaFinal)} no caixa.`,
    });
  }
  const s = value.simulado;
  if (s.spread < 0) {
    out.push({
      nivel: "risco",
      texto: `O retorno sobre o capital (${s.roic.toFixed(1)}%) fica abaixo do custo de capital (${s.wacc.toFixed(1)}%): o cenário destrói valor (EVA ${fmt(s.eva)}).`,
    });
  } else if (s.eva > value.base.eva) {
    out.push({
      nivel: "positivo",
      texto: `O cenário cria ${fmt(s.eva - value.base.eva)} de valor econômico (EVA) a mais que a base.`,
    });
  }
  if (s.dscr !== null && s.dscr < 1.25) {
    out.push({
      nivel: "risco",
      texto: `Cobertura do serviço da dívida (DSCR) de ${s.dscr.toFixed(2)}× — abaixo de 1,25×, nível que bancos costumam exigir.`,
    });
  }
  const pior = [...stress].sort((a, b) => a.caixaMinimo - b.caixaMinimo)[0];
  if (pior && pior.creditoNecessario > 0) {
    out.push({
      nivel: pior.id === "tempestade" ? "atencao" : "risco",
      texto: `No choque "${pior.nome}" o caixa chega a ${fmt(pior.caixaMinimo)}: seria preciso ${fmt(pior.creditoNecessario)} de crédito para manter o caixa mínimo.`,
    });
  }
  if (regime.melhor !== regime.atual) {
    const ganho = regime.lucroPorRegime[regime.melhor] - regime.lucroPorRegime[regime.atual];
    out.push({
      nivel: "atencao",
      texto: `Neste cenário o ${regime.melhor === "simples" ? "Simples Nacional" : regime.melhor === "presumido" ? "Lucro Presumido" : "Lucro Real"} renderia ${fmt(ganho)} a mais de lucro líquido que o regime atual.`,
    });
  }
  if (regime.desenquadradoSimples && regime.atual === "simples") {
    out.push({
      nivel: "risco",
      texto: "A receita simulada ultrapassa o teto do Simples Nacional (R$ 4,8 mi).",
    });
  }
  return out;
}
