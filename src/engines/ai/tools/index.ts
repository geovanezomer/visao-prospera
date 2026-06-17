// Tool registry — agrega módulos por domínio e mantém a API pública estável.
// Importadores externos continuam usando `@/engines/ai/tools` (que resolve
// para este index) — `TOOLS`, `runTool`, `asOpenAITools`, `asAnthropicTools`.

import type { AppState } from "@/engines/finance/types";
import type { SimulatorParams } from "@/engines/finance/simulator";
import { getSectionsCached } from "../snapshot";
import type { ToolArgs, ToolCategory, ToolContext, ToolDef, ToolHandler, ToolModule } from "./shared";

import { financeTools } from "./finance";
import { simulatorTools } from "./simulator";
import { benchmarkTools } from "./benchmark";
import { macroTools } from "./macro";
import { scenariosTools } from "./scenarios";
import { actionsTools } from "./actions";
import { complianceTools } from "./compliance";

export type { ToolDef, ToolArgs, ToolHandler, ToolContext, ToolModule, ToolCategory } from "./shared";

// Ordem dos módulos define a ordem em que o LLM vê as tools.
const MODULES: ToolModule[] = [
  financeTools,
  simulatorTools,
  benchmarkTools,
  macroTools,
  scenariosTools,
  actionsTools,
  complianceTools,
];

export const TOOLS: ToolDef[] = MODULES.flatMap(m => m.defs);

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
export const TOOL_CATEGORIES: ToolCategory[] = MODULES.map(m => m.category);

/** Metadados por categoria — útil para UI/devtools e documentação. */
export const TOOL_CATEGORY_META: Record<ToolCategory, { description?: string; count: number }> =
  MODULES.reduce((acc, m) => {
    acc[m.category] = { description: m.description, count: m.defs.length };
    return acc;
  }, {} as Record<ToolCategory, { description?: string; count: number }>);

/** Lista as tools de uma categoria — útil para filtrar o que o LLM enxerga. */
export function getToolsByCategory(category: ToolCategory): ToolDef[] {
  const mod = MODULES.find(m => m.category === category);
  return mod ? mod.defs : [];
}

/** Resolve a categoria de uma tool pelo nome. */
export function getToolCategory(name: string): ToolCategory | undefined {
  return CATEGORY_BY_NAME[name];
}

export function asOpenAITools() {
  return TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// Anthropic usa formato ligeiramente diferente: input_schema no topo.
export function asAnthropicTools() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
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
  const handler = HANDLERS[name];
  if (!handler) return `Ferramenta desconhecida: ${name}`;
  const ctx: ToolContext = {
    state,
    simulatedState,
    simParams,
    sec: getSectionsCached(state, simulatedState),
    company: state.companyName || "default",
  };
  return handler(args, ctx);
}
