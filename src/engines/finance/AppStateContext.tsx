// =====================================================================
// FinanceContext — disponibiliza `state` + `update` da engine para a árvore
// de UI sem prop drilling. Implementação baseada em store de subscription
// + useSyncExternalStore para permitir SELETORES granulares (cada tab
// re-renderiza apenas quando a fatia do state que ela consome muda).
//
// API:
//   <FinanceProvider state={...} update={...}> envolve a árvore (1× no index)
//   useFinance()              → { state, update } completo (compat retro)
//   useFinanceState()         → state inteiro (re-renderiza a cada mudança)
//   useFinanceUpdate()        → updater estável (nunca re-renderiza)
//   useFinanceSelector(sel)   → fatia memoizada (PREFIRA isto em tabs grandes)
//   <FinanceErrorBoundary>    → fallback amigável caso algum componente
//                               consuma o contexto fora do Provider
// =====================================================================

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { AppState } from "./types";

export type FinanceUpdater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

// Store interno: ref-stable, emite para listeners a cada mudança de state.
// Mantém `update` estável para que `useFinanceUpdate()` nunca cause re-render.
interface FinanceStore {
  getSnapshot: () => AppState;
  subscribe: (listener: () => void) => () => void;
  update: FinanceUpdater;
}

const FinanceStoreContext = createContext<FinanceStore | null>(null);

export function FinanceProvider({
  state,
  update,
  children,
}: {
  state: AppState;
  update: FinanceUpdater;
  children: ReactNode;
}) {
  const stateRef = useRef(state);
  const updateRef = useRef(update);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Mantém o snapshot atualizado e notifica subscribers quando state muda.
  // Usamos useEffect (não useMemo) para garantir que listeners executem
  // SOMENTE após o React commitar a mudança — evita tearing.
  useEffect(() => {
    stateRef.current = state;
    listenersRef.current.forEach((l) => l());
  }, [state]);

  // updater pode trocar de identidade entre renders do pai; refletimos
  // a versão mais recente sem invalidar a identidade do store.
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  const store = useMemo<FinanceStore>(
    () => ({
      getSnapshot: () => stateRef.current,
      subscribe: (l) => {
        listenersRef.current.add(l);
        return () => listenersRef.current.delete(l);
      },
      // Wrapper estável que sempre delega ao update mais recente.
      update: (p) => updateRef.current(p),
    }),
    [],
  );

  return <FinanceStoreContext.Provider value={store}>{children}</FinanceStoreContext.Provider>;
}

function useStore(): FinanceStore {
  const store = useContext(FinanceStoreContext);
  if (!store) {
    throw new Error(
      "useFinance/useFinanceState/useFinanceSelector chamado fora de <FinanceProvider>. " +
        "Envolva a árvore no index.tsx ou use <FinanceErrorBoundary> como fallback.",
    );
  }
  return store;
}

/**
 * Seletor com memoização — re-renderiza APENAS quando o valor selecionado muda
 * (comparação por `isEqual`, default `Object.is`). Use em tabs grandes:
 *
 *   const capital = useFinanceSelector((s) => s.capital);
 *   const labels  = useFinanceSelector((s) => s.costs.map(c => c.label), shallowArr);
 */
export function useFinanceSelector<T>(
  selector: (s: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useStore();
  // Cache do último valor retornado por este consumidor. Mantemos a mesma
  // referência enquanto `isEqual(prev, next)` for true — requisito do
  // contrato de useSyncExternalStore (snapshot deve ser estável).
  const cacheRef = useRef<{ state: AppState | null; value: T | null }>({
    state: null,
    value: null,
  });

  const getSnapshot = useCallback((): T => {
    const cur = store.getSnapshot();
    const cache = cacheRef.current;
    if (cache.state === cur && cache.value !== null) return cache.value as T;
    const next = selector(cur);
    if (cache.value !== null && isEqual(cache.value as T, next)) {
      cache.state = cur;
      return cache.value as T;
    }
    cache.state = cur;
    cache.value = next;
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Compat: retorna { state, update } completo. Causa re-render a cada mudança de state. */
export function useFinance(): { state: AppState; update: FinanceUpdater } {
  const store = useStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(() => ({ state, update: store.update }), [state, store]);
}

/** Atalho: apenas o state (re-renderiza a cada mudança). */
export function useFinanceState(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Atalho: apenas o updater. Referência ESTÁVEL — nunca causa re-render. */
export function useFinanceUpdate(): FinanceUpdater {
  return useStore().update;
}

// ---------------------------------------------------------------------
// Patch helpers — açúcar para `update((s) => ({ ...s, X: { ...s.X, ...p } }))`,
// padrão que se repetia ~30× nas tabs (Revenue/Costs/Tax/Capital).
// Cada helper faz merge raso (1 nível) — para edições aninhadas (ex.: dedução
// específica numa lista) continue usando `update` diretamente.
// ---------------------------------------------------------------------
type StateSlice = "revenue" | "tax" | "capital" | "cashflow";

function makePatch<K extends StateSlice>(slice: K) {
  return function usePatchSlice() {
    const update = useFinanceUpdate();
    return useCallback(
      (patch: Partial<AppState[K]>) =>
        update((s) => ({ ...s, [slice]: { ...(s[slice] as object), ...patch } }) as AppState),
      [update],
    );
  };
}

/** `patch(p)` → merge raso em `state.revenue`. */
export const usePatchRevenue = makePatch("revenue");
/** `patch(p)` → merge raso em `state.tax`. */
export const usePatchTax = makePatch("tax");
/** `patch(p)` → merge raso em `state.capital`. */
export const usePatchCapital = makePatch("capital");
/** `patch(p)` → merge raso em `state.cashflow`. */
export const usePatchCashflow = makePatch("cashflow");

// ---------------------------------------------------------------------
// ErrorBoundary — captura crashes de consumidores (incluindo "fora do
// Provider") e mostra fallback amigável em vez de quebrar a tela toda.
// ---------------------------------------------------------------------
interface BoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}
interface BoundaryState {
  error: Error | null;
}

export class FinanceErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log em dev para facilitar diagnóstico — em prod o usuário vê o fallback.
    if (import.meta.env.DEV) {
      console.error("[FinanceErrorBoundary]", error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <h2 className="mb-2 text-base font-semibold text-destructive">
          Erro ao renderizar este painel
        </h2>
        <p className="mb-3 text-muted-foreground">
          {error.message ||
            "Ocorreu um erro inesperado. Seus dados estão salvos — você pode tentar novamente ou recarregar a página."}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Tentar novamente
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Recarregar página
          </button>
        </div>
      </div>
    );
  }
}
