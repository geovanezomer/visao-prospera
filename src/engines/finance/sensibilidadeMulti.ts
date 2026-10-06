// Sensibilidade multivariada: tornado, Monte Carlo e cenário combinado.
//
// Complementa `sensitivity.ts` (univariado) com:
//  • Tornado — ordena drivers por IMPACTO ABSOLUTO em R$ (não só elasticidade),
//    permitindo múltiplos outputs lado a lado.
//  • Joint — aplica vários drivers simultaneamente (composição), respondendo
//    perguntas como "se receita cair 10% E folha subir 5%, o que acontece?".
//  • Monte Carlo wrapper que devolve resumo em markdown.

import type { AppState } from "./types";
import { applyDriver, readOutput, type DriverKey, type OutputKey } from "./sensitivity";
import { runMonteCarlo, DEFAULT_MC, type MCConfig, type MCResult } from "./montecarlo";

const DRIVER_LABEL: Record<DriverKey, string> = {
  preco: "Preço",
  volume: "Volume",
  cpv: "CPV",
  folha: "Folha",
  fixos: "Fixos",
  juros: "Juros",
};

const OUTPUT_LABEL: Record<OutputKey, string> = {
  ebitda: "EBITDA",
  lucroLiquido: "Lucro Líquido",
  saldoCaixa: "Saldo Caixa (Dez)",
  roic: "ROIC (%)",
};

export interface TornadoCell {
  output: OutputKey;
  baseline: number;
  low: number; // valor no delta negativo
  high: number; // valor no delta positivo
  swing: number; // |high − low| em R$ (ou pp se ROIC)
  swingPct: number; // swing / |baseline| em %
}

export interface TornadoRow {
  driver: DriverKey;
  label: string;
  deltaPct: number;
  cells: TornadoCell[];
  /** Soma absoluta dos swings — usado para ranquear o tornado. */
  totalSwing: number;
}

export interface TornadoResult {
  deltaPct: number;
  outputs: OutputKey[];
  rows: TornadoRow[];
}

/** Tornado: aplica ±deltaPct a cada driver e mede impacto em cada output. */
export function runTornado(
  state: AppState,
  drivers: DriverKey[],
  deltaPct: number,
  outputs: OutputKey[],
): TornadoResult {
  const baselines: Record<string, number> = {};
  for (const o of outputs) baselines[o] = readOutput(state, o);

  const rows: TornadoRow[] = drivers.map((d) => {
    const cells: TornadoCell[] = outputs.map((o) => {
      const low = readOutput(applyDriver(state, d, -deltaPct), o);
      const high = readOutput(applyDriver(state, d, +deltaPct), o);
      const baseline = baselines[o];
      const swing = Math.abs(high - low);
      const swingPct = baseline !== 0 ? (swing / Math.abs(baseline)) * 100 : 0;
      return { output: o, baseline, low, high, swing, swingPct };
    });
    const totalSwing = cells.reduce((s, c) => s + c.swing, 0);
    return { driver: d, label: DRIVER_LABEL[d], deltaPct, cells, totalSwing };
  });

  rows.sort((a, b) => b.totalSwing - a.totalSwing);
  return { deltaPct, outputs, rows };
}

export interface JointMove {
  driver: DriverKey;
  deltaPct: number;
}

export interface JointResult {
  moves: JointMove[];
  outputs: {
    output: OutputKey;
    baseline: number;
    cenario: number;
    delta: number;
    deltaPct: number;
  }[];
}

/** Cenário combinado: aplica todos os drivers ao mesmo tempo (composição). */
export function runJointScenario(
  state: AppState,
  moves: JointMove[],
  outputs: OutputKey[],
): JointResult {
  let s = state;
  for (const m of moves) s = applyDriver(s, m.driver, m.deltaPct);
  const rows = outputs.map((o) => {
    const baseline = readOutput(state, o);
    const cenario = readOutput(s, o);
    const delta = cenario - baseline;
    const deltaPct = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : 0;
    return { output: o, baseline, cenario, delta, deltaPct };
  });
  return { moves, outputs: rows };
}

// ---------- Formatação markdown ----------

const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
const fmtOutput = (o: OutputKey, v: number) => (o === "roic" ? `${v.toFixed(2)}%` : brl(v));

export function tornadoToMarkdown(r: TornadoResult): string {
  const lines: string[] = [];
  lines.push(`## Tornado — sensibilidade ±${r.deltaPct}% por driver`);
  lines.push(`_Drivers ordenados pelo IMPACTO ABSOLUTO total (soma dos swings nos outputs)._`);
  lines.push("");
  const header = ["Driver", ...r.outputs.map((o) => `Δ ${OUTPUT_LABEL[o]}`)].join(" | ");
  const sep = ["---", ...r.outputs.map(() => "---:")].join(" | ");
  lines.push(`| ${header} |`);
  lines.push(`| ${sep} |`);
  for (const row of r.rows) {
    const cells = row.cells.map((c) => {
      const sign = c.high >= c.low ? "↑" : "↓";
      return `${fmtOutput(c.output, c.swing)} ${sign} (${c.swingPct.toFixed(1)}%)`;
    });
    lines.push(`| **${row.label}** | ${cells.join(" | ")} |`);
  }
  const top = r.rows[0];
  if (top) {
    lines.push("");
    lines.push(
      `**Maior alavanca:** ${top.label} — concentre recomendações aqui (impacto total ${brl(top.totalSwing)}).`,
    );
  }
  return lines.join("\n");
}

export function jointToMarkdown(r: JointResult): string {
  const lines: string[] = [];
  const movesLabel = r.moves
    .map((m) => `${DRIVER_LABEL[m.driver]} ${m.deltaPct >= 0 ? "+" : ""}${m.deltaPct}%`)
    .join(" · ");
  lines.push(`## Cenário combinado — ${movesLabel}`);
  lines.push("");
  lines.push("| Indicador | Base | Cenário | Δ Absoluto | Δ % |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const o of r.outputs) {
    const sign = o.delta >= 0 ? "+" : "";
    lines.push(
      `| ${OUTPUT_LABEL[o.output]} | ${fmtOutput(o.output, o.baseline)} | ${fmtOutput(o.output, o.cenario)} | ${sign}${fmtOutput(o.output, o.delta)} | ${sign}${o.deltaPct.toFixed(1)}% |`,
    );
  }
  return lines.join("\n");
}

export function monteCarloToMarkdown(r: MCResult): string {
  const lines: string[] = [];
  lines.push(`## Monte Carlo — ${r.iterations.toLocaleString("pt-BR")} iterações`);
  if (r.correlationFellBackToIdentity) {
    lines.push(`_⚠️ Matriz de correlação não-PSD — usando choques independentes._`);
  }
  lines.push("");
  lines.push("| Métrica | P5 | P25 | Mediana | P75 | P95 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const d of [r.ebitda, r.lucroLiquido, r.saldoCaixaFinal]) {
    lines.push(
      `| ${d.label} | ${brl(d.p5)} | ${brl(d.p25)} | ${brl(d.median)} | ${brl(d.p75)} | ${brl(d.p95)} |`,
    );
  }
  lines.push("");
  lines.push(
    `**Probabilidade de prejuízo:** ${(r.probPrejuizo * 100).toFixed(1)}% · **Probabilidade de caixa abaixo do mínimo:** ${(r.probCaixaNegativo * 100).toFixed(1)}%`,
  );
  return lines.join("\n");
}

export { DEFAULT_MC, runMonteCarlo, type MCConfig };
