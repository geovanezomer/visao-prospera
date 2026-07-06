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
import { normalizeStateFromBalanco } from "./balanco";
import { deriveBalancoFechamento, type BalancoFechamentoResult } from "./balancoFechamento";

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
  /** Balanço de fechamento derivado por construção (abertura + DRE + DFC). */
  balancoFechamento: BalancoFechamentoResult;
}

/** Constrói o modelo financeiro completo a partir do AppState. */
export function buildFinancialModel(rawState: AppState): FinancialModel {
  // SSOT: quando `capital.balanco` está preenchido, propaga os totais
  // detalhados para os agregados (ativoTotal, dividaOnerosa, PC, PL, etc.)
  // antes de calcular DRE/Indicadores/Cashflow.
  const state = normalizeStateFromBalanco(rawState);
  const regime = resolveEffectiveRegime(state);
  const { dre, tax } = buildDRE(state, regime);
  // Otimização: `cf` computado UMA vez e passado a `calcIndicators` para evitar
  // a 2ª chamada interna de `buildCashFlow(state)` que existia em indicators.ts.
  const cf = buildCashFlow(state);
  // Balanço de fechamento antes dos indicadores: NCG/CDG passam a ser DERIVADOS
  // do balanço reconciliado (SSOT único — elimina divergência com a fórmula
  // estática PMR/360 que existia antes).
  const balancoFechamento = deriveBalancoFechamento({ state, dre, cf, tax });
  const ind = calcIndicators(state, dre, cf, balancoFechamento);
  const val = buildValuation(state, defaultValuationParams(state.businessType));
  const health = computeHealth(state);
  const cagrReceitas12m = cagr12m(dre.receitaLiquida);
  return { regime, dre, tax, ind, cf, val, health, cagrReceitas12m, balancoFechamento };
}

// ============================================================
// Memoização cross-módulo por IDENTIDADE de referência (WeakMap)
// ============================================================
//
// Como o `AppState` é tratado imutavelmente (reducers retornam nova ref a
// cada mudança), comparar por referência é suficiente — e elimina o custo
// de `JSON.stringify(state)` que o `fastHash` anterior fazia a cada chamada
// (relevante em IA tools e PDF, que chamam várias vezes em sequência).
//
// WeakMap permite GC automático: estados antigos não mantidos por nenhum
// consumidor são descartados sem necessidade de invalidação explícita.

const modelCache = new WeakMap<AppState, FinancialModel>();

/** Versão memoizada — devolve a mesma instância enquanto o `state` for a mesma ref. */
export function getFinancialModelCached(state: AppState): FinancialModel {
  const cached = modelCache.get(state);
  if (cached) return cached;
  const v = buildFinancialModel(state);
  modelCache.set(state, v);
  return v;
}

/** Invalidação manual (mantida para compatibilidade — WeakMap libera sozinho). */
export function invalidateFinancialModelCache(): void {
  // No-op: WeakMap libera referências automaticamente quando o state sai de escopo.
}
