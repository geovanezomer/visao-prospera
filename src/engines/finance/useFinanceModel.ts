/**
 * Hook central de derivação do modelo financeiro.
 *
 * Delega para `buildFinancialModel` (camada pure-function SSOT) e memoiza
 * o resultado por `state`. Mantém compatibilidade com consumidores antigos
 * (regime, dre, ind, cf, cagrReceitas12m) e expõe o modelo completo via
 * `model` para novos consumidores que queiram valuation e health também.
 */
import { useMemo } from "react";
import { AppState } from "./types";
import { buildFinancialModel } from "./financialModel";

export function useFinanceModel(state: AppState) {
  // Memoiza por referência de `state`. Removemos `useDeferredValue` porque,
  // no Simulador, cada mexida em slider cria um novo `simState` (nova ref),
  // e o deferral causava sensação de "indicadores não refletem o slider".
  // O custo de recomputar é baixo (engine pure-function memoizada por hash
  // em outros call sites) e a UX em tempo real é prioritária.
  const model = useMemo(() => buildFinancialModel(state), [state]);
  return {
    regime: model.regime,
    dre: model.dre,
    ind: model.ind,
    cf: model.cf,
    cagrReceitas12m: model.cagrReceitas12m,
    model,
  };
}
