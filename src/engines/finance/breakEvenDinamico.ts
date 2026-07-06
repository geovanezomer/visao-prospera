// Break-Even Dinâmico — encontra o crescimento de receita (volume) mínimo
// para satisfazer uma restrição financeira (DSCR, caixa mínimo ou EBITDA).
//
// Diferente do ponto de equilíbrio estático (CF / MC%), este solver:
//  • respeita a SAZONALIDADE real do baseline (escala cada mês pelo mesmo fator),
//  • considera CPV variável crescendo junto com o volume,
//  • avalia covenants (DSCR) e fluxo de caixa mês a mês,
//  • usa o mesmo motor de simulação do app (`applySimulator`), garantindo SSOT.
//
// Algoritmo: bisecção em `volumeDeltaPct` no intervalo [-50%, +500%]
// até encontrar o menor valor que satisfaz a restrição (tolerância 0,5pp).

import type { AppState } from "./types";
import { applySimulator, DEFAULT_SIM } from "./simulator";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { buildCashFlow } from "./cashflow";
import { resolveEffectiveRegime } from "./regime";
import { MESES as MESES_PT } from "./format";

export type RestricaoBreakEven = "dscr" | "caixa_min" | "ebitda_positivo";

export interface BreakEvenDinamicoInput {
  restricao: RestricaoBreakEven;
  /** Valor-alvo da métrica. Default: dscr=1.25, caixa_min=0, ebitda_positivo=0. */
  metaValor?: number;
  /** Se false, redistribui a receita total uniformemente nos 12 meses. */
  sazonalidade?: boolean;
}

export interface BreakEvenDinamicoResult {
  restricao: RestricaoBreakEven;
  metaValor: number;
  /** Métrica alcançada na solução (ou no melhor candidato testado). */
  metricaAtingida: number;
  /** Métrica no baseline (sem alavanca). */
  metricaBase: number;
  /** Δ% de volume necessário em relação ao baseline. */
  volumeDeltaPct: number;
  /** Receita BRUTA total anual no cenário-solução (R$). */
  receitaTotalAnual: number;
  /** Receita BRUTA anual do baseline (R$). */
  receitaBaseAnual: number;
  /** Distribuição mensal da receita bruta (12 posições). */
  distribuicaoMensal: number[];
  /** True quando a meta foi atingida dentro do intervalo de busca. */
  atingiuMeta: boolean;
  /** Mensagem explicativa quando não atinge (ex.: meta inalcançável). */
  observacao?: string;
}


/** Default da meta conforme restrição. */
function defaultMeta(restricao: RestricaoBreakEven): number {
  if (restricao === "dscr") return 1.25;
  return 0;
}

/** Calcula a métrica de interesse para um cenário simulado. */
function metricaDo(state: AppState, restricao: RestricaoBreakEven): number {
  const regime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, regime);

  if (restricao === "ebitda_positivo") {
    return dre.ebitda.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  }
  // Compute cf uma única vez e reaproveita em calcIndicators (DSCR) para
  // evitar 2ª chamada interna a buildCashFlow no loop de bisecção.
  const cf = buildCashFlow(state);
  if (restricao === "dscr") {
    const ind = calcIndicators(state, dre, cf);
    return ind.dscr ?? 999;
  }
  // caixa_min: pior saldo final do ano
  let pior = Infinity;
  for (const v of cf.saldoFinal) if (Number.isFinite(v) && v < pior) pior = v;
  return pior === Infinity ? 0 : pior;
}

/** Aplica volumeDelta e retorna o estado simulado. */
function simulado(base: AppState, volumeDeltaPct: number): AppState {
  return applySimulator(base, { ...DEFAULT_SIM, volumeDeltaPct });
}

export function solveBreakEvenDinamico(
  base: AppState,
  input: BreakEvenDinamicoInput,
): BreakEvenDinamicoResult {
  const restricao = input.restricao;
  const metaValor = input.metaValor ?? defaultMeta(restricao);
  const sazonalidade = input.sazonalidade !== false;

  const metricaBase = metricaDo(base, restricao);
  const receitaBaseAnual = base.revenue.bruta.reduce(
    (s, v) => s + (Number.isFinite(v) ? v : 0),
    0,
  );

  // Atende sem alavanca?
  if (metricaBase >= metaValor) {
    const distrib = sazonalidade
      ? base.revenue.bruta.slice()
      : Array(12).fill(receitaBaseAnual / 12);
    return {
      restricao,
      metaValor,
      metricaAtingida: metricaBase,
      metricaBase,
      volumeDeltaPct: 0,
      receitaTotalAnual: receitaBaseAnual,
      receitaBaseAnual,
      distribuicaoMensal: distrib,
      atingiuMeta: true,
      observacao: "Baseline já atende à meta — sem necessidade de receita adicional.",
    };
  }

  // Bisecção monotônica em [lo, hi]. Assumimos métrica não-decrescente em volume
  // (válido enquanto MC > 0 — caso contrário, sinalizamos inalcançável).
  let lo = 0;
  let hi = 500; // até 6× a receita atual
  const metricaHi = metricaDo(simulado(base, hi), restricao);
  if (metricaHi < metaValor) {
    // Inalcançável dentro do intervalo (provável MC ≤ 0).
    const stHi = simulado(base, hi);
    const receitaHi = stHi.revenue.bruta.reduce(
      (s, v) => s + (Number.isFinite(v) ? v : 0),
      0,
    );
    return {
      restricao,
      metaValor,
      metricaAtingida: metricaHi,
      metricaBase,
      volumeDeltaPct: hi,
      receitaTotalAnual: receitaHi,
      receitaBaseAnual,
      distribuicaoMensal: sazonalidade
        ? stHi.revenue.bruta.slice()
        : Array(12).fill(receitaHi / 12),
      atingiuMeta: false,
      observacao:
        "Meta inalcançável apenas com aumento de receita — verifique margem de contribuição, custos fixos ou serviço da dívida.",
    };
  }

  // Bisecção: 22 iterações ≈ tolerância 0,001% no volume.
  for (let i = 0; i < 22 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    const m = metricaDo(simulado(base, mid), restricao);
    if (m >= metaValor) hi = mid;
    else lo = mid;
  }

  const volume = hi;
  const stFinal = simulado(base, volume);
  const receitaTotalAnual = stFinal.revenue.bruta.reduce(
    (s, v) => s + (Number.isFinite(v) ? v : 0),
    0,
  );
  const metricaAtingida = metricaDo(stFinal, restricao);
  const distribuicaoMensal = sazonalidade
    ? stFinal.revenue.bruta.slice()
    : Array(12).fill(receitaTotalAnual / 12);

  return {
    restricao,
    metaValor,
    metricaAtingida,
    metricaBase,
    volumeDeltaPct: volume,
    receitaTotalAnual,
    receitaBaseAnual,
    distribuicaoMensal,
    atingiuMeta: true,
  };
}

/** Formata o resultado como markdown para a IA citar valores. */
export function breakEvenDinamicoToMarkdown(r: BreakEvenDinamicoResult): string {
  const brl = (n: number) =>
    n.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
  const labelRestr =
    r.restricao === "dscr"
      ? `DSCR ≥ ${r.metaValor.toFixed(2)}x`
      : r.restricao === "caixa_min"
        ? `Saldo de caixa mensal ≥ ${brl(r.metaValor)}`
        : `EBITDA anual ≥ ${brl(r.metaValor)}`;

  const valFmt = (v: number) =>
    r.restricao === "dscr" ? `${v.toFixed(2)}x` : brl(v);

  const lines: string[] = [];
  lines.push(`## Break-Even Dinâmico — restrição: ${labelRestr}`);
  lines.push(
    `- **Baseline:** ${valFmt(r.metricaBase)} · Receita anual ${brl(r.receitaBaseAnual)}`,
  );
  if (!r.atingiuMeta) {
    lines.push(
      `- ⚠️ **Meta não atingida** mesmo com +${r.volumeDeltaPct.toFixed(0)}% de volume.`,
    );
    if (r.observacao) lines.push(`- ${r.observacao}`);
    return lines.join("\n");
  }
  if (r.volumeDeltaPct === 0) {
    lines.push(`- ✅ ${r.observacao ?? "Baseline já atende."}`);
    return lines.join("\n");
  }
  const incremento = r.receitaTotalAnual - r.receitaBaseAnual;
  lines.push(
    `- **Solução:** receita anual ${brl(r.receitaTotalAnual)} (+${r.volumeDeltaPct.toFixed(1)}% volume = +${brl(incremento)})`,
  );
  lines.push(`- **Métrica resultante:** ${valFmt(r.metricaAtingida)}`);
  lines.push("");
  lines.push("**Distribuição mensal (R$):**");
  lines.push("| Mês | Receita |");
  lines.push("| --- | ---: |");
  r.distribuicaoMensal.forEach((v, i) => {
    lines.push(`| ${MESES_PT[i]} | ${brl(v)} |`);
  });
  return lines.join("\n");
}
