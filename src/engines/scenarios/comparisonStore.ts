// ============================================================================
// comparisonStore — Modo "Comparar" do header (pills) — multi-seleção de
// snapshots para visualizar lado a lado no DRE e no Fluxo de Caixa.
//
// Chaves selecionadas:
//   - "atual"          → o AppState corrente em edição
//   - "<scenarioId>"   → snapshot histórico (kind=historical) ou previsão
//
// Estado leve, em memória (não persiste entre reloads). UI:
//   - HistoricalYearPills exibe botão "Comparar" / "Sair".
//   - Quando active === true, pills viram checkboxes (inclui "Atual").
//   - DRETab e DFCTable trocam a tabela normal pelo ComparisonView
//     quando há ≥ 2 chaves selecionadas.
// ============================================================================
import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

let active = false;
let selected: ReadonlySet<string> = new Set();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useComparisonMode() {
  const a = useSyncExternalStore(
    subscribe,
    () => active,
    () => false,
  );
  const s = useSyncExternalStore(
    subscribe,
    () => selected,
    () => selected,
  );
  return { active: a, selected: s };
}

export function toggleComparisonMode() {
  active = !active;
  if (!active) selected = new Set();
  emit();
}

export function setComparisonActive(v: boolean) {
  if (active === v) return;
  active = v;
  if (!active) selected = new Set();
  emit();
}

export function toggleSelected(key: string) {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selected = next;
  emit();
}

export function clearSelected() {
  selected = new Set();
  emit();
}
