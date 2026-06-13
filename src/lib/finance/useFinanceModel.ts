/**
 * Hook central de derivação do modelo financeiro.
 * Garante UMA fonte de verdade: regime efetivo + DRE + indicadores + CF + CAGR,
 * memoizados por `state`. Usar em todas as tabs que precisam desses dados
 * (IndicatorsTab, IndicatorsCard, DRETab, DiagnosisTab, ValuationTab) para
 * evitar recálculos duplicados e divergências entre telas.
 */
import { useMemo } from "react";
import { AppState } from "./types";
import { buildDRE, calcIndicators, cagr12m, resolveEffectiveRegime } from "./calculations";
import { buildCashFlow } from "./cashflow";

export function useFinanceModel(state: AppState) {
  const regime = useMemo(() => resolveEffectiveRegime(state), [state]);
  const dre = useMemo(() => buildDRE(state, regime).dre, [state, regime]);
  const ind = useMemo(() => calcIndicators(state, dre), [state, dre]);
  const cf = useMemo(() => buildCashFlow(state), [state]);
  const cagrReceitas12m = useMemo(() => cagr12m(dre.receitaLiquida), [dre.receitaLiquida]);
  return { regime, dre, ind, cf, cagrReceitas12m };
}
