// ============================================================================
// comparisonStore — Modo "Comparar" do header (pills) — multi-seleção de
// snapshots para visualizar lado a lado no DRE e no Fluxo de Caixa.
//
// Chaves selecionadas:
//   - "atual"          → o AppState corrente em edição
//   - "<scenarioId>"   → snapshot histórico (kind=historical) ou previsão
//
// Persistência: localStorage (`finnance:comparison:v1`). Restaura ao montar
// para que o usuário volte e encontre o comparativo igual ao que deixou.
// Tolerante a SSR (guard typeof window) e falhas de quota/parsing.
// ============================================================================
import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

const STORAGE_KEY = "finnance:comparison:v1";

let active = false;
let selected: ReadonlySet<string> = new Set();
let hydrated = false;

type Persisted = { active: boolean; selected: string[] };

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Persisted> | null;
    if (parsed && typeof parsed === "object") {
      active = Boolean(parsed.active);
      if (Array.isArray(parsed.selected)) {
        selected = new Set(parsed.selected.filter((k): k is string => typeof k === "string"));
      }
    }
  } catch {
    /* ignora — mantém defaults */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const payload: Persisted = { active, selected: Array.from(selected) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / modo privado — silencioso */
  }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

function subscribe(l: Listener) {
  hydrateOnce();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Hidratação eager no client para que o primeiro render já reflita o estado salvo.
if (typeof window !== "undefined") hydrateOnce();

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
