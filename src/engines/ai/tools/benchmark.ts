// Benchmark setorial: lista de setores e comparação com indicadores da empresa.
// Output enriquecido: tabela + finance-chart (barras seu × P25/P50/P75) para os
// piores gaps + diagnóstico comparativo com gap em pp e recomendação acionável.

import type { AppState } from "@/engines/finance/types";
import { findSector, listSectors, rank, resolveBenchmark, type SectorBenchmark } from "@/engines/benchmark/sectors";
import { buildDRE, calcIndicators, resolveEffectiveRegime } from "@/engines/finance";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

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
  const { dre } = buildDRE(state, resolveEffectiveRegime(state));
  const ind = calcIndicators(state, dre);
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
    // Resolução do setor:
    // 1) parâmetro explícito (busca textual)
    // 2) resolveBenchmark — usa benchmarkCustom, ramoAtuacao ou businessType
    // 3) fallback: primeiro setor disponível
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
    if (!sector) return "Nenhum setor disponível para comparação.";
    const header = auto
      ? `_(setor inferido automaticamente do cadastro: **${sector.label}**. Para outro setor, peça explicitamente.)_\n\n`
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
