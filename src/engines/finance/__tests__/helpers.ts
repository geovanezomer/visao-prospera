/**
 * Helper de testes — clona o DEFAULT_STATE e aplica overrides parciais
 * profundos, sem quebrar a tipagem nem exigir preencher todos os campos
 * obrigatórios de AppState (que tem dezenas de campos).
 *
 * Exemplo:
 *   const s = createState({
 *     tax: { regime: "real" },
 *     revenue: { pmr: 60 },
 *   });
 */
import { DEFAULT_STATE } from "../defaults";
import type { AppState } from "../types";

type DeepPartial<T> = T extends (infer U)[]
  ? U[] // arrays substituídos por inteiro
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined || override === null) return base;
  if (Array.isArray(override)) return override as unknown as T;
  if (typeof base !== "object" || base === null) return override as T;
  if (typeof override !== "object") return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(override)) {
    const b = (base as Record<string, unknown>)[k];
    const o = (override as Record<string, unknown>)[k];
    out[k] = deepMerge(b, o as never);
  }
  return out as T;
}

export function createState(overrides: DeepPartial<AppState> = {}): AppState {
  return deepMerge(DEFAULT_STATE, overrides);
}

/** Constrói um array de 12 posições com o mesmo valor. */
export const m12 = (v: number): number[] => Array.from({ length: 12 }, () => v);
