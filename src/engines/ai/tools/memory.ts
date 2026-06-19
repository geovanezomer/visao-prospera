// Tools de memória persistente — a IA salva/lista/remove conclusões
// importantes por empresa. Conteúdo é reinjetado no system prompt das
// próximas conversas (via buildSystemPrompt -> memoriesToPromptBlock).

import {
  listMemories,
  createMemory,
  deleteMemory,
  type MemoryCategory,
} from "@/engines/memory/store";
import { type ToolDef, type ToolHandler, type ToolModule } from "./shared";

const CATEGORIAS: MemoryCategory[] = [
  "diagnostico",
  "decisao",
  "hipotese",
  "premissa",
  "preferencia",
  "outro",
];

const defs: ToolDef[] = [
  {
    name: "salvar_conclusao_importante",
    description:
      "Salva uma conclusão importante na memória persistente da empresa para reuso em conversas futuras (diagnóstico relevante, decisão validada, hipótese confirmada, preferência do consultor). Use com PARCIMÔNIA — só fatos/decisões que mudariam a próxima análise. Não use para resumir cada resposta.",
    parameters: {
      type: "object",
      properties: {
        conteudo: {
          type: "string",
          description: "Texto curto (1-2 frases, até 500 chars) da conclusão.",
        },
        categoria: {
          type: "string",
          enum: CATEGORIAS,
          description: "Tipo de memória (default: outro).",
        },
        fonte: {
          type: "string",
          description: "Origem do dado (ex.: 'WACC 18,2% via get_wacc em 18/06/2026').",
        },
      },
      required: ["conteudo"],
    },
  },
  {
    name: "listar_memorias",
    description: "Lista todas as memórias persistentes salvas para a empresa ativa.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "excluir_memoria",
    description: "Remove uma memória persistente pelo id.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  salvar_conclusao_importante: (args, { company }) => {
    const conteudo = typeof args?.conteudo === "string" ? args.conteudo.trim() : "";
    if (!conteudo) return "Parâmetro 'conteudo' obrigatório.";
    const categoria = (
      typeof args?.categoria === "string" && CATEGORIAS.includes(args.categoria as MemoryCategory)
        ? args.categoria
        : "outro"
    ) as MemoryCategory;
    const fonte = typeof args?.fonte === "string" ? args.fonte : undefined;
    const m = createMemory(company, { conteudo, categoria, fonte });
    return `🧠 Memória salva (${m.categoria}, id ${m.id}): "${m.conteudo.slice(0, 120)}${m.conteudo.length > 120 ? "…" : ""}"`;
  },
  listar_memorias: (_a, { company }) => {
    const items = listMemories(company);
    if (!items.length) return "_Nenhuma memória persistente salva para esta empresa._";
    const rows = items
      .map(
        (m) =>
          `| ${m.id} | ${m.categoria} | ${m.conteudo.replace(/\n/g, " ")} | ${m.fonte ?? "—"} |`,
      )
      .join("\n");
    return `## Memórias persistentes (${items.length})\n\n| ID | Categoria | Conteúdo | Fonte |\n| --- | --- | --- | --- |\n${rows}`;
  },
  excluir_memoria: (args, { company }) => {
    const id = typeof args?.id === "string" ? args.id : "";
    if (!id) return "Parâmetro 'id' obrigatório.";
    deleteMemory(company, id);
    return `🗑️ Memória ${id} removida.`;
  },
};

export const memoryTools: ToolModule = {
  category: "memory",
  description: "Memória persistente por empresa — conclusões reaproveitadas em conversas futuras",
  defs,
  handlers,
};
