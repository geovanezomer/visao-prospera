// Tools de plano de ação: CRUD do plano via chat (origem = "chat").

import { listActions, createAction, updateAction, deleteAction, actionsToMarkdown, type ActionStatus } from "@/engines/actions/store";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const defs: ToolDef[] = [
  {
    name: "listar_acoes", description: "Lista o plano de ação. Filtra por status opcional.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["aberta", "em_andamento", "concluida", "cancelada"] } }, required: [] },
  },
  {
    name: "criar_acao", description: "Adiciona uma ação ao plano (origem = chat).",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        descricao: { type: "string" },
        responsavel: { type: "string" },
        prazo: { type: "string", description: "Data ISO (YYYY-MM-DD) ou texto." },
        impactoEsperado: { type: "string" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "atualizar_acao", description: "Atualiza status/dados de uma ação.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["aberta", "em_andamento", "concluida", "cancelada"] },
        responsavel: { type: "string" }, prazo: { type: "string" }, impactoEsperado: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "excluir_acao", description: "Remove ação do plano.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

const handlers: Record<string, ToolHandler> = {
  listar_acoes: (args, { company }) => {
    const items = listActions(company, args?.status ? { status: args.status as ActionStatus } : undefined);
    return `## Plano de Ação${args?.status ? ` (${args.status})` : ""}\n\n` + actionsToMarkdown(items);
  },
  criar_acao: (args, { company }) => {
    if (!args?.titulo) return "Parâmetro 'titulo' obrigatório.";
    const a = createAction(company, {
      titulo: String(args.titulo),
      descricao: args?.descricao ? String(args.descricao) : undefined,
      responsavel: args?.responsavel ? String(args.responsavel) : undefined,
      prazo: args?.prazo ? String(args.prazo) : undefined,
      impactoEsperado: args?.impactoEsperado ? String(args.impactoEsperado) : undefined,
      origem: "chat",
    });
    return `✅ Ação criada: **${a.titulo}** (id: ${a.id}).`;
  },
  atualizar_acao: (args, { company }) => {
    if (!args?.id) return "Parâmetro 'id' obrigatório.";
    const a = updateAction(company, String(args.id), {
      status: args?.status as ActionStatus | undefined,
      responsavel: args?.responsavel as string | undefined,
      prazo: args?.prazo as string | undefined,
      impactoEsperado: args?.impactoEsperado as string | undefined,
    });
    return a ? `✅ Ação atualizada: **${a.titulo}** → ${a.status}.` : "Ação não encontrada.";
  },
  excluir_acao: (args, { company }) => {
    if (!args?.id) return "Parâmetro 'id' obrigatório.";
    deleteAction(company, String(args.id));
    return "🗑️ Ação removida.";
  },
};

export const actionsTools: ToolModule = { category: "actions", description: "Ações registradas e diretrizes de uso", defs, handlers };
