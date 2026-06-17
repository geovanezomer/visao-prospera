// Benchmark setorial: lista de setores e comparação com indicadores da empresa.

import type { AppState } from "@/engines/finance/types";
import { findSector, listSectors, rank, type SectorBenchmark } from "@/engines/benchmark/sectors";
import { buildDRE, calcIndicators, resolveEffectiveRegime } from "@/engines/finance";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

function compareSectorMd(state: AppState, sector: SectorBenchmark): string {
  const { dre } = buildDRE(state, resolveEffectiveRegime(state));
  const ind = calcIndicators(state, dre);
  const rows: string[] = [];
  rows.push(`## Comparativo com Setor: ${sector.label}`);
  rows.push("");
  rows.push("| Indicador | Seu valor | P25 | Mediana | P75 | Posição |");
  rows.push("| --- | --- | --- | --- | --- | --- |");
  const items = [
    { label: "Margem Bruta", v: ind.margemBruta, b: sector.margemBruta, hi: true, unit: "%" },
    { label: "Margem EBITDA", v: ind.margemEbitda, b: sector.margemEbitda, hi: true, unit: "%" },
    { label: "Margem Líquida", v: ind.margemLiquida, b: sector.margemLiquida, hi: true, unit: "%" },
    { label: "Giro do Ativo", v: ind.giroAtivo, b: sector.giroAtivo, hi: true, unit: "x" },
    {
      label: "Endividamento",
      v: ind.endividamentoGeral,
      b: sector.endividamento,
      hi: false,
      unit: "%",
    },
    { label: "PMR (dias)", v: state.revenue.pmr, b: sector.pmr, hi: false, unit: "d" },
    { label: "PMP (dias)", v: state.revenue.pmp, b: sector.pmp, hi: false, unit: "d" },
  ];
  items.forEach((it) => {
    const r = rank(it.v, it.b, it.hi);
    const fmt = (n: number) => (it.unit === "x" ? n.toFixed(2) + "x" : `${n.toFixed(1)}${it.unit}`);
    rows.push(
      `| ${it.label} | ${fmt(it.v)} | ${fmt(it.b.p25)} | ${fmt(it.b.p50)} | ${fmt(it.b.p75)} | ${r.label} |`,
    );
  });
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
];

const handlers: Record<string, ToolHandler> = {
  listar_setores: (args) => {
    const list = listSectors(args?.tipo as Parameters<typeof listSectors>[0]);
    return `## Setores disponíveis\n\n${list.map((s) => `- **${s.id}** — ${s.label} (${s.businessType})`).join("\n")}`;
  },

  comparar_com_setor: (args, { state }) => {
    // Resolução automática do setor:
    // 1) parâmetro explícito · 2) businessType · 3) primeiro setor disponível.
    let sector: SectorBenchmark | undefined;
    let auto = false;
    if (args?.setor) sector = findSector(String(args.setor));
    if (!sector && state.businessType) {
      sector = findSector(String(state.businessType));
      if (sector) auto = true;
    }
    if (!sector) {
      sector = listSectors(state.businessType)[0] ?? listSectors()[0];
      auto = true;
    }
    if (!sector) return "Nenhum setor disponível para comparação.";
    const header = auto
      ? `_(setor inferido automaticamente do cadastro: **${sector.label}** — businessType "${state.businessType ?? "n/d"}". Para outro setor, peça explicitamente.)_\n\n`
      : "";
    return header + compareSectorMd(state, sector);
  },
};

export const benchmarkTools: ToolModule = {
  category: "benchmark",
  description: "Benchmarks setoriais e comparativos",
  defs,
  handlers,
};
