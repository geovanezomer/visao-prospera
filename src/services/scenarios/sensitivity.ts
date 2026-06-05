// Análise de sensibilidade — varia cada alavanca individualmente e mede impacto.
import type { AppState } from "@/lib/finance/types";
import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/lib/finance/simulator";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { buildValuation, defaultValuationParams } from "@/lib/finance/valuation";
import { sum } from "@/lib/finance/format";

export type SensMetric = "ebitda" | "lucroLiquido" | "valuation" | "margemEbitda";

interface Lever {
  label: string;
  apply: (delta: number) => Partial<SimulatorParams>;
}

const LEVERS: Lever[] = [
  { label: "Receita (preço/volume)", apply: (d) => ({ priceDeltaPct: d }) },
  { label: "CPV / CMV / CSP",        apply: (d) => ({ cpvDeltaPct: d }) },
  { label: "Custos Fixos",            apply: (d) => ({ fixedCutPct: -d }) }, // d positivo = cortar; vamos passar -corte
];

function metricOf(state: AppState, metric: SensMetric): number {
  const { dre } = buildDRE(state, state.tax.regime);
  if (metric === "ebitda") return sum(dre.ebitda);
  if (metric === "lucroLiquido") return sum(dre.lucroLiquido);
  if (metric === "margemEbitda") {
    const ind = calcIndicators(state, dre);
    return ind.margemEbitda;
  }
  if (metric === "valuation") {
    const v = buildValuation(state, defaultValuationParams(state.businessType));
    return v.enterpriseValue.base;
  }
  return 0;
}

export interface SensitivityRow {
  lever: string;
  deltaPct: number;
  baseValue: number;
  newValue: number;
  changeAbs: number;
  changePct: number;
}

export function sensitivity(state: AppState, metric: SensMetric, deltas = [-20, -10, 10, 20]): SensitivityRow[] {
  const baseValue = metricOf(state, metric);
  const rows: SensitivityRow[] = [];
  for (const L of LEVERS) {
    for (const d of deltas) {
      // para fixedCutPct, "delta = -20" significa cortar -20% (aumento), e "+20" significa cortar 20% (redução)
      // simplificação: aplicar variação direta na receita/cpv; nos fixos, +d = cortar d%
      const params: SimulatorParams = { ...DEFAULT_SIM, ...L.apply(d) };
      const simulated = applySimulator(state, params);
      const v = metricOf(simulated, metric);
      rows.push({
        lever: L.label,
        deltaPct: d,
        baseValue,
        newValue: v,
        changeAbs: v - baseValue,
        changePct: baseValue !== 0 ? ((v - baseValue) / Math.abs(baseValue)) * 100 : 0,
      });
    }
  }
  return rows;
}

const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function sensitivityToMarkdown(metric: SensMetric, rows: SensitivityRow[]): string {
  const out: string[] = [];
  out.push(`## Análise de Sensibilidade — Impacto em ${metric}`);
  out.push("");
  out.push("| Alavanca | Variação | Base | Novo | Δ |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const newDisplay = metric === "margemEbitda" ? `${r.newValue.toFixed(1)}%` : brl(r.newValue);
    const baseDisplay = metric === "margemEbitda" ? `${r.baseValue.toFixed(1)}%` : brl(r.baseValue);
    out.push(`| ${r.lever} | ${pct(r.deltaPct)} | ${baseDisplay} | ${newDisplay} | ${pct(r.changePct)} |`);
  }
  out.push("");
  // ordena por |impacto|
  const sorted = [...rows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  out.push(`**Alavanca de maior impacto:** ${sorted[0].lever} (${pct(sorted[0].deltaPct)} → ${pct(sorted[0].changePct)}).`);
  return out.join("\n");
}
