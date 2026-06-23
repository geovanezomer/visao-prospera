// =====================================================================
// CUSTOS — helpers puros de classificação e normalização mensal
// =====================================================================
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// `folhaAnual` permanece em ./regime.ts para evitar ciclo de imports
// (regime ↔ folha ↔ effectiveMonthValues).

import { CostLine, TaxRegime, DEFAULT_ENCARGOS_PCT } from "./types";
import { fill12 } from "./format";
import { DEFAULT_ENCARGOS_PCT_SIMPLES } from "./taxDefaults";

/** Classificação canônica: linhas que compõem o CPV/CMV/CSP (geram crédito tributário
 *  e escalam com receita no forecast). Usado em buildDRE, calcReal e forecast. */
export function isCpvCost(c: CostLine): boolean {
  return c.category === "custo_vendas" || c.category === "direto_venda";
}

/** Despesa Administrativa (função CPC 26). Aceita o alias legado `fixo`. */
export function isAdminCost(c: CostLine): boolean {
  return c.category === "despesa_administrativa" || c.category === "fixo";
}

/** Despesa Comercial / Vendas (função CPC 26). Aceita o alias legado `variavel`. */
export function isComercialCost(c: CostLine): boolean {
  return c.category === "despesa_comercial" || c.category === "variavel";
}

/** Despesa Financeira (Resultado Financeiro pós-EBIT). */
export function isFinanceiroCost(c: CostLine): boolean {
  return c.category === "financeiro";
}

export function fixedCostBase(values: number[]): number {
  const normalized = values.length === 12 ? values : fill12(values[0] || 0);

  const first = normalized[0] || 0;
  // Se todos os meses são iguais, retorna o valor.
  if (normalized.every((v) => v === first)) return first;
  // Caso contrário (estado inconsistente para um custo marcado fixo),
  // adota a edição mais recente — varre do mês 12 para trás procurando
  // o último valor distinto do anterior. Generaliza o antigo heurístico
  // que só detectava alteração no mês 12.
  for (let i = normalized.length - 1; i > 0; i--) {
    if (normalized[i] !== normalized[i - 1]) return normalized[i] || 0;
  }
  return normalized[normalized.length - 1] || first;
}

export function effectiveMonthValues(c: CostLine, regime?: TaxRegime): number[] {
  const raw = c.fixed ? fill12(fixedCostBase(c.values)) : c.values.slice();
  if (c.encargosAuto) {
    // SSOT-12: encargos reduzidos no Simples (CPP já no DAS).
    const isSimples = regime === "simples";
    const defaultRate = isSimples ? DEFAULT_ENCARGOS_PCT_SIMPLES : DEFAULT_ENCARGOS_PCT;
    const factor = 1 + (c.encargosPct ?? defaultRate) / 100;
    return raw.map((v) => v * factor);
  }
  return raw;
}

/** Mantido para retro-compatibilidade — agora aplica encargos. */
export function monthValues(c: CostLine, regime?: TaxRegime): number[] {
  return effectiveMonthValues(c, regime);
}
