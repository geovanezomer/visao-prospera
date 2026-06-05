// Projeção plurianual (12/24/60 meses) baseada no DRE anual e em premissas de crescimento.
import type { AppState } from "@/lib/finance/types";
import { buildDRE } from "@/lib/finance/calculations";
import { sum } from "@/lib/finance/format";

export interface ProjectionAssumptions {
  /** Crescimento % de receita por mês (composto). Ex: 1.5 = +1,5% ao mês. */
  revenueGrowthMonthlyPct: number;
  /** Inflação % de custos variáveis por mês. */
  variableInflMonthlyPct: number;
  /** Inflação % de custos fixos por mês. */
  fixedInflMonthlyPct: number;
  /** Margem EBITDA alvo (% — opcional; se setado, ajusta custos para convergir). */
  targetEbitdaMarginPct?: number;
}

export const DEFAULT_PROJ: ProjectionAssumptions = {
  revenueGrowthMonthlyPct: 1.0,
  variableInflMonthlyPct: 0.5,
  fixedInflMonthlyPct: 0.4,
};

export interface ProjectionMonth {
  monthIndex: number;          // 0..n-1
  receita: number;
  custosVariaveis: number;
  custosFixos: number;
  ebitda: number;
  margemEbitda: number;
}

export interface ProjectionResult {
  months: number;
  assumptions: ProjectionAssumptions;
  series: ProjectionMonth[];
  totals: { receita: number; ebitda: number; margemEbitda: number };
}

export function project(state: AppState, months: number, a: Partial<ProjectionAssumptions> = {}): ProjectionResult {
  const ass: ProjectionAssumptions = { ...DEFAULT_PROJ, ...a };
  const { dre } = buildDRE(state, state.tax.regime);
  // base = média mensal do ano-base
  const baseReceita = sum(dre.receitaBruta) / 12;
  const baseVar = sum(dre.custosVariaveis) / 12;
  const baseFix = sum(dre.custosFixos) / 12;

  const gR = 1 + ass.revenueGrowthMonthlyPct / 100;
  const gV = 1 + ass.variableInflMonthlyPct / 100;
  const gF = 1 + ass.fixedInflMonthlyPct / 100;

  const series: ProjectionMonth[] = [];
  for (let i = 0; i < months; i++) {
    const receita = baseReceita * Math.pow(gR, i);
    let cv = baseVar * Math.pow(gV, i);
    let cf = baseFix * Math.pow(gF, i);
    if (ass.targetEbitdaMarginPct !== undefined) {
      const target = receita * (ass.targetEbitdaMarginPct / 100);
      const current = receita - cv - cf;
      const adjust = current - target;
      // ajusta cortando proporcional aos fixos (premissa: fixos são alvo de corte)
      if (adjust < 0) cf = Math.max(0, cf + adjust);
    }
    const ebitda = receita - cv - cf;
    series.push({
      monthIndex: i, receita, custosVariaveis: cv, custosFixos: cf, ebitda,
      margemEbitda: receita > 0 ? (ebitda / receita) * 100 : 0,
    });
  }
  const totR = series.reduce((s, m) => s + m.receita, 0);
  const totE = series.reduce((s, m) => s + m.ebitda, 0);
  return {
    months, assumptions: ass, series,
    totals: { receita: totR, ebitda: totE, margemEbitda: totR > 0 ? (totE / totR) * 100 : 0 },
  };
}

const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

export function projectionToMarkdown(p: ProjectionResult): string {
  const a = p.assumptions;
  const lines: string[] = [];
  lines.push(`## Projeção ${p.months} meses`);
  lines.push(`- Crescimento receita: ${pct(a.revenueGrowthMonthlyPct)} a.m.`);
  lines.push(`- Inflação variáveis: ${pct(a.variableInflMonthlyPct)} a.m. · fixos: ${pct(a.fixedInflMonthlyPct)} a.m.`);
  if (a.targetEbitdaMarginPct !== undefined) lines.push(`- Margem EBITDA alvo: ${pct(a.targetEbitdaMarginPct)}`);
  lines.push("");
  lines.push(`**Totais acumulados:** Receita ${brl(p.totals.receita)} · EBITDA ${brl(p.totals.ebitda)} (${pct(p.totals.margemEbitda)})`);
  // Resumo por ano para legibilidade
  const yearly: { ano: number; receita: number; ebitda: number }[] = [];
  for (let y = 0; y * 12 < p.series.length; y++) {
    const chunk = p.series.slice(y * 12, (y + 1) * 12);
    yearly.push({
      ano: y + 1,
      receita: chunk.reduce((s, m) => s + m.receita, 0),
      ebitda: chunk.reduce((s, m) => s + m.ebitda, 0),
    });
  }
  lines.push("\n| Ano | Receita | EBITDA | Margem |\n| --- | --- | --- | --- |");
  yearly.forEach(y => lines.push(`| ${y.ano} | ${brl(y.receita)} | ${brl(y.ebitda)} | ${pct(y.receita > 0 ? (y.ebitda / y.receita) * 100 : 0)} |`));
  return lines.join("\n");
}
