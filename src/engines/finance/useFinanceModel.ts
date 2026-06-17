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
  const model = useMemo(() => buildFinancialModel(state), [state]);
  return {
    // Campos legados — não quebra chamadores existentes.
    regime: model.regime,
    dre: model.dre,
    ind: model.ind,
    cf: model.cf,
    cagrReceitas12m: model.cagrReceitas12m,
    // Modelo completo (valuation, health, tax) para novos consumidores.
    model,
  };
}
