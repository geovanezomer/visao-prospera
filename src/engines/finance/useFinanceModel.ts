/**
 * Hook central de derivação do modelo financeiro.
 *
 * Delega para `buildFinancialModel` (camada pure-function SSOT) e memoiza
 * o resultado por `state`. Mantém compatibilidade com consumidores antigos
 * (regime, dre, ind, cf, cagrReceitas12m) e expõe o modelo completo via
 * `model` para novos consumidores que queiram valuation e health também.
 */
import { useDeferredValue, useMemo } from "react";
import { AppState } from "./types";
import { buildFinancialModel } from "./financialModel";

export function useFinanceModel(state: AppState) {
  // useDeferredValue: durante digitação rápida o React reusa o último modelo
  // enquanto recalcula em background — reduz lag em PCs lentos com muitos
  // meses/cenários sem mudar a API do hook.
  const deferred = useDeferredValue(state);
  const model = useMemo(() => buildFinancialModel(deferred), [deferred]);
  return {
    regime: model.regime,
    dre: model.dre,
    ind: model.ind,
    cf: model.cf,
    cagrReceitas12m: model.cagrReceitas12m,
    model,
  };
}
