// Tipos e helpers compartilhados entre os módulos de tools.
// Cada módulo de domínio (finance/benchmark/macro/...) exporta `defs` e
// `handlers`; o index.ts agrega tudo e mantém a API pública estável.

import type { AppState } from "@/engines/finance/types";
import type { SimulatorParams } from "@/engines/finance/simulator";
import type { getSectionsCached } from "../snapshot";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Tipo leve para `args`, sem perder a flexibilidade do JSON do LLM. */
export type ToolArgs = Record<string, unknown>;

/** Contexto injetado em todos os handlers — calculado uma vez por chamada. */
export interface ToolContext {
  state: AppState;
  simulatedState?: AppState;
  simParams?: SimulatorParams;
  sec: ReturnType<typeof getSectionsCached>;
  company: string;
}

export type ToolHandler = (args: ToolArgs, ctx: ToolContext) => string | Promise<string>;

/**
 * Categorias do registry — agrupam tools por domínio para facilitar
 * manutenção, filtragem por contexto (ex.: somente "finance" no chat
 * de análise) e evitar regressão de "arquivo único".
 */
export type ToolCategory =
  | "finance"
  | "simulator"
  | "benchmark"
  | "macro"
  | "scenarios"
  | "actions"
  | "compliance"
  | "reports"
  | "memory";

export interface ToolModule {
  /** Identificador da categoria — também usado em filtros. */
  category: ToolCategory;
  /** Descrição curta para docs/devtools. */
  description?: string;
  defs: ToolDef[];
  handlers: Record<string, ToolHandler>;
}

// Helpers de formatação alinhados com snapshot.ts (recebem valor JÁ em %).
export const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
export const pct = (n: number, d = 1) =>
  `${(Number.isFinite(n) ? n : 0).toFixed(d).replace(".", ",")}%`;
export const sum = (a: number[]) => a.reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);
