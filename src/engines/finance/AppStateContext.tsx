// =====================================================================
// FinanceContext — disponibiliza `state` + `update` da engine para a árvore
// de UI sem prop drilling. O index.tsx instala o Provider uma vez; tabs,
// sidebar e dialogs consomem via `useFinance()` (ou os seletores granulares
// `useFinanceState()` / `useFinanceUpdate()`).
//
// IMPORTANTE: o contexto reflete o ESTADO REAL (não o simulado). Componentes
// que precisam de um state alternativo (ex.: ValuationTab com simulatedState,
// AIView, SimulatorTab) continuam recebendo via props — esses são casos
// legítimos de injeção, não prop drilling.
// =====================================================================

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppState } from "./types";

export type FinanceUpdater = (
  p: Partial<AppState> | ((s: AppState) => AppState),
) => void;

export interface FinanceContextValue {
  state: AppState;
  update: FinanceUpdater;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({
  state,
  update,
  children,
}: {
  state: AppState;
  update: FinanceUpdater;
  children: ReactNode;
}) {
  // Memoiza para evitar re-render desnecessário dos consumidores quando
  // o pai re-renderiza sem mudança real em state/update.
  const value = useMemo<FinanceContextValue>(() => ({ state, update }), [state, update]);
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

/** Acesso completo ao contexto (state + update). */
export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) {
    throw new Error(
      "useFinance() chamado fora de <FinanceProvider>. Envolva a árvore no index.tsx.",
    );
  }
  return ctx;
}

/** Seletor: apenas o state (leitura). */
export function useFinanceState(): AppState {
  return useFinance().state;
}

/** Seletor: apenas o update (escrita). */
export function useFinanceUpdate(): FinanceUpdater {
  return useFinance().update;
}
