// ============================================================================
// comparisonStore.ts — Estado global do modo de comparação de anos.
//
// Mesmo padrão de event-bus usado em scenarios/store.ts. Estado em memória
// (não persiste): comparação é uma view efêmera, não preferência do usuário.
//
// Chaves selecionadas:
//  - "atual"      → AppState corrente (ano em andamento)
//  - number       → fiscalYear de um snapshot histórico
// ============================================================================

import { useSyncExternalStore } from "react";

export type ComparisonKey = "atual" | number;

interface ComparisonState {
  active: boolean;
  selected: ComparisonKey[];
}

let state: ComparisonState = { active: false, selected: [] };
const listeners = new Set<() => void>();

function emit() {
  // Snapshot por referência muda para invalidar useSyncExternalStore.
  state = { ...state };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): ComparisonState {
  return state;
}

export function useComparisonMode(): ComparisonState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setComparisonActive(active: boolean) {
  state = { ...state, active };
  // Ao desativar, limpa seleção para não confundir próxima ativação.
  if (!active) state.selected = [];
  emit();
}

export function toggleComparisonKey(key: ComparisonKey) {
  const exists = state.selected.some((k) => k === key);
  state = {
    ...state,
    selected: exists
      ? state.selected.filter((k) => k !== key)
      : [...state.selected, key],
  };
  emit();
}

export function clearComparison() {
  state = { active: false, selected: [] };
  emit();
}
