// Tools de cenários: listar, salvar, excluir, carregar, clonar e comparar.
// `gerenciar_cenarios` é o ponto único multi-ação (criar/clonar/comparar/listar/deletar),
// enquanto as tools individuais permanecem para compat com prompts antigos.

import {
  listScenarios,
  saveScenario,
  deleteScenario,
  getScenario,
  cloneScenario,
  resolveScenarios,
  type ScenarioRecord,
} from "@/engines/scenarios/store";
import { buildDRE, calcIndicators, resolveEffectiveRegime, buildCashFlow } from "@/engines/finance";
import { buildValuation, defaultValuationParams } from "@/engines/finance/valuation";
import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/engines/finance/simulator";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

/** Calcula métricas-resumo a partir do params (aplica no estado base). */
function summarizeFromParams(
  baseState: Parameters<typeof buildDRE>[0],
  params?: SimulatorParams,
): NonNullable<ScenarioRecord["summary"]> {
  const target = params ? applySimulator(baseState, { ...DEFAULT_SIM, ...params }) : baseState;
  const { dre } = buildDRE(target, resolveEffectiveRegime(target));
  const ind = calcIndicators(target, dre);
  const cf = buildCashFlow(target);
  const val = buildValuation(target, defaultValuationParams(target.businessType));
  const receita = target.revenue.bruta.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  return {
    ebitda: dre.ebitda.reduce((a, b) => a + b, 0),
    margemEbitda: ind.margemEbitda,
    lucroLiquido: dre.lucroLiquido.reduce((a, b) => a + b, 0),
    ev: val.enterpriseValue.base,
    saldoFinalCaixa: cf.totais.saldoFinal,
    receita,
    dscr: ind.dscr,
  };
}

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
  {
    name: "gerenciar_cenarios",
    description:
      "Gestão avançada de cenários versionados em UMA tool. Ações:\n• 'criar' — salva o estado simulado atual com nome, premissas e autor.\n• 'clonar' — ramifica um cenário existente (parentId) aplicando overrides nas alavancas. Permite árvores como 'Otimista_v2' derivado de 'Otimista_v1'.\n• 'comparar' — gera tabela lado-a-lado (Receita/EBITDA/Caixa Dez/DSCR/EV) entre 2+ cenários, ideal para apresentar Base × Otimista × Pessimista × Reforma.\n• 'listar' — devolve histórico com autor, data, descrição e premissas.\n• 'deletar' — remoção soft pelo id ou nome.",
    parameters: {
      type: "object",
      properties: {
        acao: {
          type: "string",
          enum: ["criar", "clonar", "comparar", "listar", "deletar"],
          description: "Ação a executar.",
        },
        nome: { type: "string", description: "Nome do cenário (criar/clonar/deletar)." },
        pai: {
          type: "string",
          description: "ID ou nome do cenário-pai (apenas 'clonar').",
        },
        cenarios: {
          type: "array",
          items: { type: "string" },
          description:
            "Lista de ids/nomes para 'comparar' (mínimo 2). Pode incluir o cenário-base atual com o nome 'base'.",
        },
        overrides: {
          type: "object",
          description:
            "Overrides nas alavancas do simulador (apenas 'clonar'). Mesmas chaves do SimulatorParams.",
          additionalProperties: true,
        },
        premissas: {
          type: "object",
          description: "Premissas estruturadas livres (ex: {receita_delta:0.29, reforma:'pleno'}).",
          additionalProperties: true,
        },
        criado_por: { type: "string", description: "Autor/consultor (metadata)." },
        descricao: { type: "string", description: "Descrição livre para histórico." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags para organização (ex: ['reforma','agressivo']).",
        },
      },
      required: ["acao"],
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
    const hasLevers =
      simParams != null && Object.values(simParams).some((v) => typeof v === "number" && v !== 0);
    const target = hasLevers ? (simulatedState ?? state) : state;
    const paramsToSave = hasLevers ? simParams : undefined;

    const summary = summarizeFromParams(state, paramsToSave);
    const rec = saveScenario(company, {
      name: String(args.nome),
      notes: args?.notas ? String(args.notas) : undefined,
      params: paramsToSave,
      summary,
    });
    void target;
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
    try {
      window.dispatchEvent(
        new CustomEvent("gz-apply-simulator-params", { detail: rec.params ?? null }),
      );
    } catch {
      return `⚠️ Não foi possível aplicar o cenário **${rec.name}** (ambiente sem window).`;
    }
    const tag = rec.params ? "alavancas restauradas" : "estado base restaurado (sem alavancas)";
    return `✅ Cenário **${rec.name}** carregado — ${tag}. A UI do simulador foi atualizada.`;
  },

  gerenciar_cenarios: (args, ctx) => {
    const acao = String(args?.acao || "").toLowerCase();
    const { state, simulatedState, simParams, company } = ctx;

    if (acao === "listar") {
      const all = listScenarios(company);
      if (!all.length) return "_Nenhum cenário salvo._";
      const lines: string[] = [];
      lines.push("## Cenários versionados");
      lines.push("| Nome | Pai | Autor | Data | Descrição |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const s of all) {
        const parent = s.parentId ? (getScenario(company, s.parentId)?.name ?? s.parentId) : "—";
        const autor = s.metadata?.createdBy ?? "—";
        const data = new Date(s.createdAt).toLocaleDateString("pt-BR");
        const desc = s.metadata?.description ?? s.notes ?? "—";
        lines.push(`| **${s.name}** (\`${s.id}\`) | ${parent} | ${autor} | ${data} | ${desc} |`);
      }
      return lines.join("\n");
    }

    if (acao === "deletar") {
      const idOrName = String(args?.nome || "");
      const rec = getScenario(company, idOrName);
      if (!rec) return "Cenário não encontrado.";
      deleteScenario(company, rec.id);
      return `🗑️ Cenário **${rec.name}** removido.`;
    }

    if (acao === "criar") {
      const nome = String(args?.nome || "").trim();
      if (!nome) return "Parâmetro 'nome' obrigatório para 'criar'.";
      const hasLevers =
        simParams != null && Object.values(simParams).some((v) => typeof v === "number" && v !== 0);
      const paramsToSave = hasLevers ? simParams : undefined;
      const summary = summarizeFromParams(state, paramsToSave);
      void simulatedState;
      const rec = saveScenario(company, {
        name: nome,
        params: paramsToSave,
        summary,
        metadata: {
          createdBy: args?.criado_por ? String(args.criado_por) : undefined,
          description: args?.descricao ? String(args.descricao) : undefined,
          premissas: (args?.premissas as Record<string, unknown>) ?? undefined,
          tags: Array.isArray(args?.tags) ? (args.tags as string[]) : undefined,
        },
      });
      return `✅ Cenário **${rec.name}** criado (id: \`${rec.id}\`).`;
    }

    if (acao === "clonar") {
      const pai = String(args?.pai || "").trim();
      if (!pai) return "Parâmetro 'pai' obrigatório para 'clonar'.";
      const nome = args?.nome ? String(args.nome) : undefined;
      const overrides = (args?.overrides as Partial<SimulatorParams>) ?? undefined;
      const rec = cloneScenario(company, pai, {
        name: nome,
        paramsOverride: overrides,
        metadata: {
          createdBy: args?.criado_por ? String(args.criado_por) : undefined,
          description: args?.descricao ? String(args.descricao) : undefined,
          premissas: (args?.premissas as Record<string, unknown>) ?? undefined,
          tags: Array.isArray(args?.tags) ? (args.tags as string[]) : undefined,
        },
      });
      if (!rec) return `Cenário-pai "${pai}" não encontrado.`;
      // Recalcula summary com overrides aplicados ao estado base.
      const newSummary = summarizeFromParams(state, rec.params);
      saveScenario(company, { id: rec.id, name: rec.name, summary: newSummary });
      return `🌿 Cenário **${rec.name}** clonado de \`${pai}\` (id: \`${rec.id}\`).`;
    }

    if (acao === "comparar") {
      const ids = Array.isArray(args?.cenarios) ? (args.cenarios as string[]) : [];
      if (ids.length < 2) {
        return "Parâmetro 'cenarios' precisa de pelo menos 2 ids/nomes para comparar.";
      }
      // Suporte ao alias 'base' (cenário atual sem alavancas).
      const rows: {
        nome: string;
        autor: string;
        data: string;
        sum: NonNullable<ScenarioRecord["summary"]>;
      }[] = [];
      for (const id of ids) {
        if (id.toLowerCase() === "base") {
          rows.push({
            nome: "Base (atual)",
            autor: "—",
            data: new Date().toLocaleDateString("pt-BR"),
            sum: summarizeFromParams(state, undefined),
          });
          continue;
        }
        const rec = getScenario(company, id);
        if (!rec) continue;
        const sum = rec.summary ?? summarizeFromParams(state, rec.params);
        rows.push({
          nome: rec.name,
          autor: rec.metadata?.createdBy ?? "—",
          data: new Date(rec.createdAt).toLocaleDateString("pt-BR"),
          sum,
        });
      }
      if (rows.length < 2) return "Não foi possível resolver 2+ cenários para comparar.";
      void resolveScenarios;

      const lines: string[] = [];
      lines.push(`## Comparativo de cenários (${rows.length})`);
      lines.push("| Cenário | Receita | EBITDA | Margem | Caixa Dez | DSCR | EV | Autor | Data |");
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |");
      for (const r of rows) {
        const s = r.sum;
        lines.push(
          `| **${r.nome}** | ${brl(s.receita ?? 0)} | ${brl(s.ebitda)} | ${s.margemEbitda.toFixed(1)}% | ${brl(s.saldoFinalCaixa ?? 0)} | ${(s.dscr ?? 0).toFixed(2)}x | ${brl(s.ev ?? 0)} | ${r.autor} | ${r.data} |`,
        );
      }
      // Destaque: melhor EBITDA e melhor caixa.
      const bestEbitda = rows.reduce((a, b) => (b.sum.ebitda > a.sum.ebitda ? b : a));
      const bestCaixa = rows.reduce((a, b) =>
        (b.sum.saldoFinalCaixa ?? -Infinity) > (a.sum.saldoFinalCaixa ?? -Infinity) ? b : a,
      );
      lines.push("");
      lines.push(`**Melhor EBITDA:** ${bestEbitda.nome} · **Melhor caixa:** ${bestCaixa.nome}`);
      return lines.join("\n");
    }

    return `Ação '${acao}' não reconhecida. Use: criar | clonar | comparar | listar | deletar.`;
  },
};

export const scenariosTools: ToolModule = {
  category: "scenarios",
  description: "Gestão de cenários (listar/salvar/carregar/clonar/comparar)",
  defs,
  handlers,
};
