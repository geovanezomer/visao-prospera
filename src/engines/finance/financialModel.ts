/**
 * SSOT — FinancialModel (pure-function)
 *
 * Camada única que agrega TODA a derivação financeira a partir do `AppState`:
 *   regime efetivo · DRE · indicadores · fluxo de caixa · valuation · saúde · CAGR
 *
 * Substitui o padrão repetido `buildDRE(state, state.tax.regime) + calcIndicators + ...`
 * espalhado por engine modules e tabs (forecast, projector, montecarlo, simulator, IA, etc.).
 *
 * Implementa também memoização cross-módulo por hash do estado para evitar
 * reconstruir o modelo quando módulos diferentes pedem partes em sequência
 * (snapshot da IA → tools → cards prescritivos, por exemplo).
 *
 * Uso recomendado:
 *   const model = buildFinancialModel(state);              // não-memoizado
 *   const model = getFinancialModelCached(state);          // memoizado por hash
 *
 * O hook `useFinanceModel` delega para esta camada — mantém uma única fonte
 * de verdade entre código de UI (React) e código de engine (pure functions).
 */

import type { AppState } from "./types";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { cagr12m } from "./shared";
import { resolveEffectiveRegime } from "./regime";
import { buildCashFlow } from "./cashflow";
import { buildValuation, defaultValuationParams } from "./valuation";
import { computeHealth } from "./health";

// Tipos derivados das funções existentes (evita re-declarar shapes).
type BuildDREReturn = ReturnType<typeof buildDRE>;
export type FinancialModelDRE = BuildDREReturn["dre"];
export type FinancialModelTax = BuildDREReturn["tax"];
export type FinancialModelIndicators = ReturnType<typeof calcIndicators>;
export type FinancialModelCashflow = ReturnType<typeof buildCashFlow>;
export type FinancialModelValuation = ReturnType<typeof buildValuation>;
export type FinancialModelHealth = ReturnType<typeof computeHealth>;

export interface FinancialModel {
  /** Regime efetivo (downgrade automático Simples→Presumido se exceder limite). */
  regime: BuildDREReturn["tax"] extends infer _ ? ReturnType<typeof resolveEffectiveRegime> : never;
  dre: FinancialModelDRE;
  tax: FinancialModelTax;
  ind: FinancialModelIndicators;
  cf: FinancialModelCashflow;
  /** Valuation usa parâmetros default do businessType. */
  val: FinancialModelValuation;
  health: FinancialModelHealth;
  cagrReceitas12m: number;
}

/** Constrói o modelo financeiro completo a partir do AppState. */
export function buildFinancialModel(state: AppState): FinancialModel {
  const regime = resolveEffectiveRegime(state);
  const { dre, tax } = buildDRE(state, regime);
  const ind = calcIndicators(state, dre);
  const cf = buildCashFlow(state);
  const val = buildValuation(state, defaultValuationParams(state.businessType));
  const health = computeHealth(state);
  const cagrReceitas12m = cagr12m(dre.receitaLiquida);
  return { regime, dre, tax, ind, cf, val, health, cagrReceitas12m };
}

// ============================================================
// Memoização cross-módulo (hash do estado)
// ============================================================
//
// Mantém UMA única entrada (o caso mais comum: 1 estado base ativo na UI).
// Se chamadores diferentes pedirem o mesmo `state`, devolve a mesma instância.
//
// NÃO armazena LRU porque o estado da aplicação só muda quando o usuário
// edita um campo, e nesse momento o hash inteiro muda — invalida tudo.

let cacheKey = "";
let cacheVal: FinancialModel | null = null;

function fastHash(o: unknown): string {
  try {
    const s = JSON.stringify(o);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return `${s.length}:${h}`;
  } catch {
    return Math.random().toString();
  }
}

/** Versão memoizada — devolve a mesma instância enquanto o estado não mudar. */
export function getFinancialModelCached(state: AppState): FinancialModel {
  const k = fastHash(state);
  if (k === cacheKey && cacheVal) return cacheVal;
  const v = buildFinancialModel(state);
  cacheKey = k;
  cacheVal = v;
  return v;
}

/** Invalidação manual (use em testes ou após mudanças globais não-rastreadas). */
export function invalidateFinancialModelCache(): void {
  cacheKey = "";
  cacheVal = null;
}
