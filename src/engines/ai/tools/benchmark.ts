// Benchmark setorial: lista de setores e comparação com indicadores da empresa.
// Output enriquecido: tabela + finance-chart (barras seu × P25/P50/P75) para os
// piores gaps + diagnóstico comparativo com gap em pp e recomendação acionável.

import type { AppState } from "@/engines/finance/types";
import { findSector, listSectors, rank, resolveBenchmark, type SectorBenchmark } from "@/engines/benchmark/sectors";
import { calcIndicators } from "@/engines/finance";
import { getFinancialModelCached } from "@/engines/finance/financialModel";
import { type ToolArgs, type ToolDef, type ToolHandler, type ToolModule } from "./shared";

// Recomendação acionável por indicador quando abaixo do P50.
function recommend(label: string, gap: number, unit: string): string {
  const g = Math.abs(gap).toFixed(1);
  switch (label) {
    case "Margem EBITDA":
      return `Gap **−${g}pp** vs. mediana. Alavancas: (1) preço +5–10% se demanda inelástica, (2) cortar top-3 custos fixos em 20–30%, (3) renegociar CPV (terceirização parcial).`;
    case "Margem Bruta":
      return `Gap **−${g}pp**. Foque no CPV: renegocie fornecedores, revise mix de produtos/serviços (priorize alta margem), elimine SKUs deficitários.`;
    case "Margem Líquida":
      return `Gap **−${g}pp**. Acima da margem bruta, ataque despesas administrativas/comerciais e revise estrutura tributária (simular_regime_tributario).`;
    case "Giro do Ativo":
      return `Gap **−${g}x**. Ativo subutilizado — venda ativos ociosos ou aumente receita sem expandir capital (terceirização, asset-light).`;
    case "Endividamento":
      return `Excesso de **+${g}pp** acima da mediana. Renegocie dívidas caras (get_contratos_divida), antecipe quitação parcial, evite novos empréstimos curtos.`;
    case "PMR (dias)":
      return `Receb. está **+${g}d** acima da mediana. Antecipe recebíveis, ofereça desconto para pagamento à vista, revise política de crédito.`;
    case "PMP (dias)":
      return `Pagamento ao fornecedor **−${g}d** abaixo da mediana (paga rápido demais). Renegocie prazos para liberar capital de giro.`;
    default:
      return `Gap **${g}${unit}**.`;
  }
}

interface CompareItem {
  label: string;
  v: number;
  b: { p25: number; p50: number; p75: number };
  hi: boolean;
  unit: string;
}

function compareSectorMd(state: AppState, sector: SectorBenchmark): string {
  const { ind } = getFinancialModelCached(state);
  const items: CompareItem[] = [
    { label: "Margem Bruta", v: ind.margemBruta, b: sector.margemBruta, hi: true, unit: "pp" },
    { label: "Margem EBITDA", v: ind.margemEbitda, b: sector.margemEbitda, hi: true, unit: "pp" },
    { label: "Margem Líquida", v: ind.margemLiquida, b: sector.margemLiquida, hi: true, unit: "pp" },
    { label: "Giro do Ativo", v: ind.giroAtivo, b: sector.giroAtivo, hi: true, unit: "x" },
    { label: "Endividamento", v: ind.endividamentoGeral, b: sector.endividamento, hi: false, unit: "pp" },
    { label: "PMR (dias)", v: state.revenue.pmr, b: sector.pmr, hi: false, unit: "d" },
    { label: "PMP (dias)", v: state.revenue.pmp, b: sector.pmp, hi: false, unit: "d" },
  ];

  const fmt = (n: number, unit: string) =>
    unit === "x" ? n.toFixed(2) + "x" : unit === "d" ? `${n.toFixed(0)}d` : `${n.toFixed(1)}%`;

  // Tabela
  const rows: string[] = [];
  rows.push(`## Comparativo com Setor: ${sector.label}`);
  rows.push("");
  rows.push("| Indicador | Seu valor | P25 | Mediana | P75 | Posição |");
  rows.push("| --- | --- | --- | --- | --- | --- |");
  items.forEach((it) => {
    const r = rank(it.v, it.b, it.hi);
    rows.push(
      `| ${it.label} | ${fmt(it.v, it.unit)} | ${fmt(it.b.p25, it.unit)} | ${fmt(it.b.p50, it.unit)} | ${fmt(it.b.p75, it.unit)} | ${r.label} |`,
    );
  });

  // Detecta os 3 piores gaps (posições "bottom" ou "below-median")
  const ranked = items
    .map((it) => ({ it, r: rank(it.v, it.b, it.hi) }))
    .filter((x) => x.r.position === "bottom" || x.r.position === "below-median")
    .sort((a, b) => Math.abs(b.r.delta) - Math.abs(a.r.delta))
    .slice(0, 3);

  // Gráfico (finance-chart) para o pior gap — renderiza barras seu × P25/P50/P75.
  if (ranked.length > 0) {
    const worst = ranked[0].it;
    const chartFormat = worst.unit === "x" ? "number" : worst.unit === "d" ? "number" : "percent";
    const spec = {
      type: "bar",
      title: `${worst.label} — sua empresa vs. ${sector.label}`,
      labelKey: "label",
      format: chartFormat,
      keys: ["valor"],
      data: [
        { label: "Sua empresa", valor: Number(worst.v.toFixed(2)) },
        { label: "P25", valor: Number(worst.b.p25.toFixed(2)) },
        { label: "Mediana", valor: Number(worst.b.p50.toFixed(2)) },
        { label: "P75", valor: Number(worst.b.p75.toFixed(2)) },
      ],
    };
    rows.push("");
    rows.push("```finance-chart");
    rows.push(JSON.stringify(spec));
    rows.push("```");
  }

  // Diagnóstico comparativo + recomendações para os piores gaps.
  if (ranked.length > 0) {
    rows.push("");
    rows.push("### Diagnóstico comparativo (piores gaps)");
    ranked.forEach(({ it, r }) => {
      const gapStr =
        it.unit === "pp"
          ? `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)}pp`
          : it.unit === "x"
            ? `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}x`
            : `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(0)}d`;
      rows.push(
        `- **${it.label}** — seu: ${fmt(it.v, it.unit)} · mediana: ${fmt(it.b.p50, it.unit)} · gap: **${gapStr}**`,
      );
      rows.push(`  - ${recommend(it.label, r.delta, it.unit)}`);
    });
  } else {
    rows.push("");
    rows.push("✅ Todos os indicadores estão na mediana do setor ou acima.");
  }

  return rows.join("\n");
}

// ============================================================
// benchmarking_detalhado — métricas com P25/P50/P75 + percentil
// ============================================================

interface MetricDef {
  key: string;
  label: string;
  unit: "pp" | "x" | "d";
  higherIsBetter: boolean;
  /** P25/P50/P75 — usa SectorBenchmark quando disponível ou baseline PME. */
  band: (s: SectorBenchmark) => { p25: number; p50: number; p75: number };
  read: (ind: ReturnType<typeof calcIndicators>, state: AppState) => number;
}

// Baselines PME-BR para métricas sem benchmark setorial específico.
const PME_BASELINES: Record<string, { p25: number; p50: number; p75: number }> = {
  folha_pct: { p25: 45, p50: 55, p75: 65 },
  roe: { p25: 12, p50: 18, p75: 25 },
  roic: { p25: 10, p50: 15, p75: 22 },
  dscr: { p25: 1.5, p50: 2.2, p75: 3.5 },
  d_ebitda: { p25: 1.0, p50: 2.0, p75: 3.0 },
  liq_corr: { p25: 1.2, p50: 1.5, p75: 2.0 },
};

const METRICS: MetricDef[] = [
  { key: "ebitda_pct", label: "Margem EBITDA", unit: "pp", higherIsBetter: true,
    band: (s) => s.margemEbitda, read: (i) => i.margemEbitda },
  { key: "bruta_pct", label: "Margem Bruta", unit: "pp", higherIsBetter: true,
    band: (s) => s.margemBruta, read: (i) => i.margemBruta },
  { key: "liquida_pct", label: "Margem Líquida", unit: "pp", higherIsBetter: true,
    band: (s) => s.margemLiquida, read: (i) => i.margemLiquida },
  { key: "folha_pct", label: "Folha / Receita", unit: "pp", higherIsBetter: false,
    band: () => PME_BASELINES.folha_pct, read: (i) => i.custoPessoalSobreReceita },
  { key: "roe", label: "ROE", unit: "pp", higherIsBetter: true,
    band: () => PME_BASELINES.roe, read: (i) => i.roe ?? 0 },
  { key: "roic", label: "ROIC", unit: "pp", higherIsBetter: true,
    band: () => PME_BASELINES.roic, read: (i) => i.roic },
  { key: "dscr", label: "DSCR", unit: "x", higherIsBetter: true,
    band: () => PME_BASELINES.dscr, read: (i) => i.dscr ?? 0 },
  { key: "d_ebitda", label: "Dívida Líq. / EBITDA", unit: "x", higherIsBetter: false,
    band: () => PME_BASELINES.d_ebitda, read: (i) => i.dividaLiqEbitda },
  { key: "liq_corr", label: "Liquidez Corrente", unit: "x", higherIsBetter: true,
    band: () => PME_BASELINES.liq_corr, read: (i) => i.liquidezCorrente },
  { key: "endividamento", label: "Endividamento Geral", unit: "pp", higherIsBetter: false,
    band: (s) => s.endividamento, read: (i) => i.endividamentoGeral },
  { key: "giro_ativo", label: "Giro do Ativo", unit: "x", higherIsBetter: true,
    band: (s) => s.giroAtivo, read: (i) => i.giroAtivo },
  { key: "pmr", label: "PMR (dias)", unit: "d", higherIsBetter: false,
    band: (s) => s.pmr, read: (_i, s) => s.revenue.pmr },
  { key: "pmp", label: "PMP (dias)", unit: "d", higherIsBetter: false,
    band: (s) => s.pmp, read: (_i, s) => s.revenue.pmp },
];

const DEFAULT_METRIC_KEYS = ["ebitda_pct", "folha_pct", "roe", "roic", "dscr", "d_ebitda", "liq_corr"];

/** Estima percentil via interpolação linear sobre P25/P50/P75 (extrapola P0/P100). */
function estimatePercentile(
  value: number,
  b: { p25: number; p50: number; p75: number },
  higherIsBetter: boolean,
): number {
  const spread25 = Math.max(1e-9, b.p50 - b.p25);
  const spread75 = Math.max(1e-9, b.p75 - b.p50);
  const p0 = b.p25 - spread25;
  const p100 = b.p75 + spread75;
  let pct: number;
  if (value <= p0) pct = 1;
  else if (value <= b.p25) pct = 1 + ((value - p0) / spread25) * 24;
  else if (value <= b.p50) pct = 25 + ((value - b.p25) / spread25) * 25;
  else if (value <= b.p75) pct = 50 + ((value - b.p50) / spread75) * 25;
  else if (value <= p100) pct = 75 + ((value - b.p75) / spread75) * 24;
  else pct = 99;
  pct = Math.max(1, Math.min(99, pct));
  return higherIsBetter ? pct : 100 - pct;
}

function bucketPercentile(pct: number): string {
  if (pct <= 5) return "P1";
  if (pct <= 15) return "P10";
  if (pct <= 35) return "P25";
  if (pct <= 60) return "P50";
  if (pct <= 80) return "P75";
  if (pct <= 95) return "P90";
  return "P99";
}

function statusEmoji(pct: number): string {
  if (pct < 25) return "🔴";
  if (pct < 60) return "🟡";
  return "🟢";
}

function fmtVal(n: number, unit: "pp" | "x" | "d"): string {
  if (unit === "x") return n.toFixed(2) + "x";
  if (unit === "d") return n.toFixed(0) + "d";
  return n.toFixed(1) + "%";
}

function fmtDelta(delta: number, unit: "pp" | "x" | "d"): string {
  const sign = delta >= 0 ? "+" : "";
  if (unit === "x") return `${sign}${delta.toFixed(2)}x`;
  if (unit === "d") return `${sign}${delta.toFixed(0)}d`;
  return `${sign}${delta.toFixed(1)}pp`;
}

function detailedBenchmarkMd(state: AppState, sector: SectorBenchmark, keys: string[]): string {
  const { ind } = getFinancialModelCached(state);
  const selected = keys
    .map((k) => METRICS.find((m) => m.key === k))
    .filter((m): m is MetricDef => !!m);

  if (selected.length === 0) {
    return `Nenhuma métrica reconhecida. Disponíveis: ${METRICS.map((m) => m.key).join(", ")}.`;
  }

  const rows: string[] = [];
  rows.push(`## Benchmarking Detalhado — ${sector.label}`);
  rows.push("");
  rows.push("| Métrica | Empresa | P25 | P50 | P75 | Percentil | Status |");
  rows.push("| --- | --- | --- | --- | --- | --- | --- |");

  const decomp: { m: MetricDef; v: number; b: { p25: number; p50: number; p75: number }; pct: number; delta: number }[] = [];

  for (const m of selected) {
    const v = m.read(ind, state);
    const b = m.band(sector);
    const pct = estimatePercentile(v, b, m.higherIsBetter);
    const delta = v - b.p50;
    decomp.push({ m, v, b, pct, delta });
    rows.push(
      `| ${m.label} | ${fmtVal(v, m.unit)} | ${fmtVal(b.p25, m.unit)} | ${fmtVal(b.p50, m.unit)} | ${fmtVal(b.p75, m.unit)} | ${bucketPercentile(pct)} | ${statusEmoji(pct)} |`,
    );
  }

  const fora = decomp.filter((d) => d.pct < 25).sort((a, b) => a.pct - b.pct).slice(0, 3);
  if (fora.length > 0) {
    rows.push("");
    rows.push("### Decomposição (onde está fora do padrão)");
    for (const d of fora) {
      const direction = d.m.higherIsBetter
        ? (d.delta < 0 ? "abaixo" : "acima")
        : (d.delta > 0 ? "acima" : "abaixo");
      rows.push(
        `- **${d.m.label}**: ${fmtVal(d.v, d.m.unit)} vs. P50 ${fmtVal(d.b.p50, d.m.unit)} = **${fmtDelta(d.delta, d.m.unit)} ${direction}** (≈${bucketPercentile(d.pct)} do setor).`,
      );
    }
  } else {
    rows.push("");
    rows.push("✅ Nenhuma métrica em zona crítica (todas ≥ P25).");
  }

  return rows.join("\n");
}

const defs: ToolDef[] = [
  {
    name: "listar_setores",
    description:
      "Lista os setores disponíveis para comparação. Filtra opcionalmente por tipo (servicos/comercio/industria).",
    parameters: {
      type: "object",
      properties: { tipo: { type: "string", enum: ["servicos", "comercio", "industria"] } },
      required: [],
    },
  },
  {
    name: "comparar_com_setor",
    description:
      "Compara os indicadores da empresa com benchmarks de mercado. O parâmetro setor é opcional — se omitido, usa automaticamente o tipo de negócio da empresa cadastrada.",
    parameters: {
      type: "object",
      properties: {
        setor: {
          type: "string",
          description:
            "Opcional. ID ou trecho do nome do setor (ex: 'varejo', 'saas'). Omita para usar automaticamente o businessType da empresa.",
        },
      },
      required: [],
    },
  },
  {
    name: "benchmarking_detalhado",
    description:
      "Benchmarking detalhado por métrica: tabela P25/P50/P75 + percentil aproximado (P1/P10/P25/P50/P75/P90/P99) com semáforo 🔴🟡🟢 e decomposição dos maiores desvios em pp/x. Métricas: ebitda_pct, bruta_pct, liquida_pct, folha_pct, roe, roic, dscr, d_ebitda, liq_corr, endividamento, giro_ativo, pmr, pmp. Use quando o cliente pedir granularidade (\"onde estou fora do padrão?\").",
    parameters: {
      type: "object",
      properties: {
        metricas: {
          type: "array",
          items: { type: "string" },
          description: "Lista de métricas. Omita para usar o conjunto padrão.",
        },
        setor: { type: "string", description: "Opcional. ID/nome do setor; default = setor da empresa." },
      },
      required: [],
    },
  },
];

function resolveSector(args: ToolArgs | undefined, state: AppState): { sector?: SectorBenchmark; auto: boolean } {
  let sector: SectorBenchmark | undefined;
  let auto = false;
  if (args?.setor) sector = findSector(String(args.setor));
  if (!sector) {
    sector = resolveBenchmark(state);
    if (sector) auto = true;
  }
  if (!sector) {
    sector = listSectors(state.businessType)[0] ?? listSectors()[0];
    auto = true;
  }
  return { sector, auto };
}

const handlers: Record<string, ToolHandler> = {
  listar_setores: (args) => {
    const list = listSectors(args?.tipo as Parameters<typeof listSectors>[0]);
    return `## Setores disponíveis\n\n${list.map((s) => `- **${s.id}** — ${s.label} (${s.businessType})`).join("\n")}`;
  },

  comparar_com_setor: (args, { state }) => {
    const { sector, auto } = resolveSector(args, state);
    if (!sector) return "Nenhum setor disponível para comparação.";
    const header = auto
      ? `_(setor inferido automaticamente do cadastro: **${sector.label}**. Para outro setor, peça explicitamente.)_\n\n`
      : "";
    return header + compareSectorMd(state, sector);
  },

  benchmarking_detalhado: (args, { state }) => {
    const { sector, auto } = resolveSector(args, state);
    if (!sector) return "Nenhum setor disponível para comparação.";
    const keys = Array.isArray(args?.metricas) && args.metricas.length > 0
      ? (args.metricas as unknown[]).map((k) => String(k))
      : DEFAULT_METRIC_KEYS;
    const header = auto
      ? `_(setor inferido automaticamente: **${sector.label}**.)_\n\n`
      : "";
    return header + detailedBenchmarkMd(state, sector, keys);
  },
};

export const benchmarkTools: ToolModule = {
  category: "benchmark",
  description: "Benchmarks setoriais e comparativos",
  defs,
  handlers,
};
