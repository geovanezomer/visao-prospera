// =====================================================================
// REGIME TRIBUTÁRIO — resolução do regime efetivo, Fator R, folha anual
// =====================================================================
// Extraído de calculations.ts (Fase 1) — comportamento idêntico.
// `folhaAnual` mora aqui (e não em costs.ts) para evitar ciclo de
// imports com `resolveEffectiveRegime`.

import { AppState, SimplesAnexo, TaxRegime } from "./types";
import { sum } from "./format";
import { getSimplesLimite, getFatorRMinimoPct } from "./taxDefaults";
import { effectiveMonthValues } from "./costs";

// =====================================================================
// Fator R automático: Anexo V vira III se folha/RBT12 ≥ 28%
// =====================================================================
const LABOR_KEYWORDS = /sal[áa]rio|folha|prolabore|pró-labore|mod|mão de obra|m\.o\.|clt/i;

export function folhaAnual(state: AppState): number {
  // SSOT: regime EFETIVO. Encargos do Simples são reduzidos automaticamente
  // dentro de effectiveMonthValues quando aplicável.
  const regime = resolveEffectiveRegime(state);
  const laborCosts = state.costs
    .filter((c) => c.category !== "financeiro" && (c.encargosAuto || LABOR_KEYWORDS.test(c.label)));
  return laborCosts.reduce((acc, c) => acc + sum(effectiveMonthValues(c, regime)), 0);
}

// SSOT-10: LIMITE_SIMPLES removido — use SIMPLES_LIMITE / getSimplesLimite(tax) de taxDefaults.ts.

export function resolveSimplesAnexo(state: AppState): SimplesAnexo {
  const anexo = state.tax.simplesAnexo;
  if (!state.tax.fatorRAuto || anexo !== "V") return anexo;
  const rbt12 = sum(state.revenue.bruta);
  if (rbt12 <= 0 || rbt12 > getSimplesLimite(state.tax)) return anexo;
  const fatorR = folhaAnual(state) / rbt12;
  const minPct = getFatorRMinimoPct(state.tax);
  return fatorR >= (minPct / 100) ? "III" : "V";
}

/** Retorna true se RBT12 ultrapassa o limite do Simples Nacional (desenquadramento obrigatório). */
export function simplesExcedeLimite(state: AppState): boolean {
  return sum(state.revenue.bruta) > getSimplesLimite(state.tax);
}

/**
 * Resolve o regime tributário EFETIVO considerando desenquadramento do Simples.
 * Se o usuário escolheu Simples mas a RBT12 estourou o limite, força Presumido.
 * Esta é a VERDADE ABSOLUTA usada por todas as abas (Indicadores, Saúde, Forecast, etc.).
 */
export function resolveEffectiveRegime(state: AppState): TaxRegime {
  if (state.tax.regime === "simples" && simplesExcedeLimite(state)) {
    return "presumido";
  }
  return state.tax.regime;
}
