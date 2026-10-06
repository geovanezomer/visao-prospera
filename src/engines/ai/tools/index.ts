// Tool registry — agrega módulos por domínio e mantém a API pública estável.
// Importadores externos continuam usando `@/engines/ai/tools` (que resolve
// para este index) — `TOOLS`, `runTool`, `asOpenAITools`, `asAnthropicTools`.

import type { AppState } from "@/engines/finance/types";
import type { SimulatorParams } from "@/engines/finance/simulator";
import { getSectionsCached } from "../snapshot";
import type {
  ToolArgs,
  ToolCategory,
  ToolContext,
  ToolDef,
  ToolHandler,
  ToolModule,
} from "./shared";

import { financeTools } from "./finance";
import { simulatorTools } from "./simulator";
import { benchmarkTools } from "./benchmark";
import { macroTools } from "./macro";
import { scenariosTools } from "./scenarios";
import { actionsTools } from "./actions";
import { complianceTools } from "./compliance";
import { memoryTools } from "./memory";
import { calculadorasTools } from "./calculadoras";
import { auditoriaTools } from "./auditoria";
import { arquivoTools } from "./arquivo";

export type {
  ToolDef,
  ToolArgs,
  ToolHandler,
  ToolContext,
  ToolModule,
  ToolCategory,
} from "./shared";

// Ordem dos módulos define a ordem em que o LLM vê as tools.
const MODULES: ToolModule[] = [
  financeTools,
  simulatorTools,
  benchmarkTools,
  macroTools,
  scenariosTools,
  actionsTools,
  complianceTools,
  memoryTools,
  calculadorasTools,
  auditoriaTools,
  arquivoTools,
];

export const TOOLS: ToolDef[] = MODULES.flatMap((m) => m.defs);

// Mapa nome → handler + nome → categoria. Em dev, alerta se houver colisão.
const HANDLERS: Record<string, ToolHandler> = {};
const CATEGORY_BY_NAME: Record<string, ToolCategory> = {};
for (const m of MODULES) {
  for (const def of m.defs) CATEGORY_BY_NAME[def.name] = m.category;
  for (const [name, fn] of Object.entries(m.handlers)) {
    if (HANDLERS[name] && typeof console !== "undefined") {
      console.warn(`[ai/tools] handler duplicado para "${name}" — o último vence`);
    }
    HANDLERS[name] = fn;
  }
}

/** Categorias disponíveis, na ordem em que aparecem no registry. */
export const TOOL_CATEGORIES: ToolCategory[] = MODULES.map((m) => m.category);

/** Metadados por categoria — útil para UI/devtools e documentação. */
export const TOOL_CATEGORY_META: Record<ToolCategory, { description?: string; count: number }> =
  MODULES.reduce(
    (acc, m) => {
      acc[m.category] = { description: m.description, count: m.defs.length };
      return acc;
    },
    {} as Record<ToolCategory, { description?: string; count: number }>,
  );

/** Lista as tools de uma categoria — útil para filtrar o que o LLM enxerga. */
export function getToolsByCategory(category: ToolCategory): ToolDef[] {
  const mod = MODULES.find((m) => m.category === category);
  return mod ? mod.defs : [];
}

/** Resolve a categoria de uma tool pelo nome. */
export function getToolCategory(name: string): ToolCategory | undefined {
  return CATEGORY_BY_NAME[name];
}

export function asOpenAITools() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// Anthropic usa formato ligeiramente diferente: input_schema no topo.
export function asAnthropicTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ============================================================
// META-TOOLS (Opção A — tool deferral)
// ----------------------------------------------------------------
// Em vez de expor 27+ tools no system prompt (inflando 3-5k tokens
// por turno), expomos apenas 2 meta-tools. O LLM descobre as tools
// reais via `tool_search` e as executa via `tool_invoke`, recebendo
// envelope JSON estruturado `{ name, category, content }` em vez de
// texto livre. Mantém TOOLS/asOpenAITools intactos para rollback.
// ============================================================

const META_TOOLS: ToolDef[] = [
  {
    name: "tool_search",
    description:
      "Lista tools disponíveis no FinnancePRO. Filtre por palavra-chave (`query`) e/ou `category` (finance, simulator, benchmark, macro, scenarios, actions, compliance, reports, memory, calculadoras, auditoria). Chame SEMPRE antes de `tool_invoke` se não tiver certeza do nome exato. Retorna JSON com name, category, description e parameters.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Palavra-chave em PT-BR (ex.: 'wacc', 'caixa')." },
        category: {
          type: "string",
          enum: TOOL_CATEGORIES,
          description: "Filtra por categoria do registry.",
        },
        limit: { type: "number", description: "Máx. de resultados (default 12)." },
      },
      required: [],
    },
  },
  {
    name: "tool_invoke",
    description:
      "Executa uma tool específica pelo nome exato (descoberto via `tool_search`). Retorna JSON `{ name, category, content }` onde `content` é markdown pronto para citar números e fontes. Faça múltiplas chamadas em paralelo quando precisar de várias tools.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome exato da tool (ex.: 'get_indicadores')." },
        arguments: {
          type: "object",
          description: "Argumentos da tool — siga o schema retornado por tool_search.",
          additionalProperties: true,
        },
      },
      required: ["name"],
    },
  },
];

export function asOpenAIMetaTools() {
  return META_TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function asAnthropicMetaTools() {
  return META_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// Busca leve usada por tool_search.
function searchTools(query?: string, category?: ToolCategory, limit = 12): ToolDef[] {
  const q = (query || "").toLowerCase().trim();
  let pool = TOOLS;
  if (category) {
    const mod = MODULES.find((m) => m.category === category);
    pool = mod ? mod.defs : [];
  }
  if (q) {
    pool = pool.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }
  return pool.slice(0, Math.max(1, Math.min(50, limit)));
}

export function runTool(
  name: string,
  args: ToolArgs,
  state: AppState,
  simulatedState?: AppState,
  simParams?: SimulatorParams,
): string | Promise<string> {
  if (typeof console !== "undefined" && console.debug) {
    console.debug(`[ai/tool] ${name}`, args);
  }
  const ctx: ToolContext = {
    state,
    simulatedState,
    simParams,
    sec: getSectionsCached(state, simulatedState),
    company: state.companyName || "default",
  };

  // Meta dispatch — atende `tool_search` / `tool_invoke` sem mexer nos handlers.
  if (name === "tool_search") {
    const matches = searchTools(
      typeof args.query === "string" ? args.query : undefined,
      typeof args.category === "string" ? (args.category as ToolCategory) : undefined,
      typeof args.limit === "number" ? args.limit : 12,
    ).map((t) => ({
      name: t.name,
      category: CATEGORY_BY_NAME[t.name],
      description: t.description,
      parameters: t.parameters,
    }));
    return JSON.stringify({ matches, total: matches.length });
  }

  if (name === "tool_invoke") {
    const target = typeof args.name === "string" ? args.name : "";
    const inner =
      args.arguments && typeof args.arguments === "object" ? (args.arguments as ToolArgs) : {};
    const handler = HANDLERS[target];
    if (!handler) {
      return JSON.stringify({ error: `Ferramenta desconhecida: ${target}` });
    }
    const result = handler(inner, ctx);
    const wrap = (content: string) =>
      JSON.stringify({ name: target, category: CATEGORY_BY_NAME[target], content });
    return result instanceof Promise ? result.then(wrap) : wrap(result);
  }

  const handler = HANDLERS[name];
  if (!handler) return `Ferramenta desconhecida: ${name}`;
  return handler(args, ctx);
}
