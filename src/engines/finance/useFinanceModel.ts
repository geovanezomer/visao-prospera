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
import { getFinancialModelCached } from "./financialModel";

export function useFinanceModel(state: AppState) {
  // Usa `getFinancialModelCached` (WeakMap por ref do state) para que múltiplos
  // componentes que recebam o mesmo `state` compartilhem a MESMA instância do
  // modelo — sem recomputar a engine N vezes (ex.: DashboardExtras com 4 cards
  // chamando este hook independentemente).
  // A reatividade entre abas é preservada: quando o store emite novo state,
  // useSyncExternalStore propaga a nova ref → WeakMap miss → recompute.
  const model = useMemo(() => getFinancialModelCached(state), [state]);
  return {
    regime: model.regime,
    dre: model.dre,
    ind: model.ind,
    cf: model.cf,
    cagrReceitas12m: model.cagrReceitas12m,
    model,
  };
}
