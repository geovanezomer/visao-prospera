// Tools de cenários: listar, salvar, excluir e carregar (aplica na UI via evento).

import {
  listScenarios,
  saveScenario,
  deleteScenario,
  getScenario,
} from "@/engines/scenarios/store";
import { buildDRE, calcIndicators, resolveEffectiveRegime } from "@/engines/finance/calculations";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const defs: ToolDef[] = [
  {
    name: "listar_cenarios",
    description: "Lista cenários salvos para esta empresa.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "salvar_cenario",
    description: "Salva o cenário simulado atual com um nome.",
    parameters: {
      type: "object",
      properties: { nome: { type: "string" }, notas: { type: "string" } },
      required: ["nome"],
    },
  },
  {
    name: "excluir_cenario",
    description: "Remove um cenário salvo pelo id ou nome.",
    parameters: {
      type: "object",
      properties: { idOuNome: { type: "string" } },
      required: ["idOuNome"],
    },
  },
  {
    name: "carregar_cenario",
    description:
      "Carrega um cenário salvo e aplica suas alavancas no simulador (atualiza a UI). Use quando o consultor disser 'aplique o cenário X' ou 'volte para o cenário Otimista'. Para listar os cenários disponíveis, use listar_cenarios.",
    parameters: {
      type: "object",
      properties: { idOuNome: { type: "string", description: "ID ou nome exato do cenário." } },
      required: ["idOuNome"],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  listar_cenarios: (_a, { company }) => {
    const all = listScenarios(company);
    if (!all.length) return "_Nenhum cenário salvo._";
    return (
      "## Cenários salvos\n\n" +
      all
        .map((s) => {
          const sumLine = s.summary
            ? ` — EBITDA ${Math.round(s.summary.ebitda).toLocaleString("pt-BR")} (${s.summary.margemEbitda.toFixed(1)}%)`
            : "";
          return `- **${s.name}** (${s.id})${sumLine}`;
        })
        .join("\n")
    );
  },

  salvar_cenario: (args, { state, simulatedState, simParams, company }) => {
    if (!args?.nome) return "Parâmetro 'nome' obrigatório.";
    // Captura simulado quando há alavanca ativa; senão salva o cenário base.
    const hasLevers =
      simParams != null && Object.values(simParams).some((v) => typeof v === "number" && v !== 0);
    const target = hasLevers ? (simulatedState ?? state) : state;
    const paramsToSave = hasLevers ? simParams : undefined;

    const { dre } = buildDRE(target, resolveEffectiveRegime(target));
    const ind = calcIndicators(target, dre);
    const rec = saveScenario(company, {
      name: String(args.nome),
      notes: args?.notas ? String(args.notas) : undefined,
      params: paramsToSave,
      summary: {
        ebitda: dre.ebitda.reduce((a, b) => a + b, 0),
        margemEbitda: ind.margemEbitda,
        lucroLiquido: dre.lucroLiquido.reduce((a, b) => a + b, 0),
      },
    });
    const note = hasLevers
      ? "_(parâmetros do simulador ativo capturados)_"
      : "_(cenário base salvo — nenhuma alavanca ativa)_";
    return `✅ Cenário **${rec.name}** salvo (id: ${rec.id}). ${note}`;
  },

  excluir_cenario: (args, { company }) => {
    const rec = getScenario(company, String(args?.idOuNome || ""));
    if (!rec) return "Cenário não encontrado.";
    deleteScenario(company, rec.id);
    return `🗑️ Cenário **${rec.name}** removido.`;
  },

  carregar_cenario: (args, { company }) => {
    const idOrName = String(args?.idOuNome || "").trim();
    if (!idOrName) return "Parâmetro 'idOuNome' obrigatório.";
    const rec = getScenario(company, idOrName);
    if (!rec) return `Cenário "${idOrName}" não encontrado. Use listar_cenarios.`;
    // Dispara evento que routes/index.tsx escuta para aplicar os params no simulador.
    try {
      window.dispatchEvent(
        new CustomEvent("gz-apply-simulator-params", {
          detail: rec.params ?? null,
        }),
      );
    } catch {
      return `⚠️ Não foi possível aplicar o cenário **${rec.name}** (ambiente sem window).`;
    }
    const tag = rec.params ? "alavancas restauradas" : "estado base restaurado (sem alavancas)";
    return `✅ Cenário **${rec.name}** carregado — ${tag}. A UI do simulador foi atualizada.`;
  },
};

export const scenariosTools: ToolModule = {
  category: "scenarios",
  description: "Gestão de cenários (listar/salvar/carregar)",
  defs,
  handlers,
};
