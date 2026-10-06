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
  useLayoutEffect,
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
  readOnly: boolean;
}

const FinanceStoreContext = createContext<FinanceStore | null>(null);

export function FinanceProvider({
  state,
  update,
  readOnly = false,
  children,
}: {
  state: AppState;
  update: FinanceUpdater;
  /** Quando true, todas as chamadas a `update` viram no-op (modo somente leitura). */
  readOnly?: boolean;
  children: ReactNode;
}) {
  const stateRef = useRef(state);
  const updateRef = useRef(update);
  const readOnlyRef = useRef(readOnly);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Atualiza o snapshot já no render (as abas leem o estado novo nesta mesma
  // passada) e só avisa os assinantes depois do commit — antes, cada edição
  // renderizava a árvore duas vezes, a primeira com o estado velho.
  stateRef.current = state;
  useLayoutEffect(() => {
    listenersRef.current.forEach((l) => l());
  }, [state]);

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  const store = useMemo<FinanceStore>(
    () => ({
      getSnapshot: () => stateRef.current,
      subscribe: (l) => {
        listenersRef.current.add(l);
        return () => listenersRef.current.delete(l);
      },
      // Em modo read-only, `update` vira no-op — bloqueia mutações vindas
      // de qualquer componente sem precisar refatorá-los individualmente.
      update: (p) => {
        if (readOnlyRef.current) return;
        updateRef.current(p);
      },
      readOnly,
    }),
    [readOnly],
  );

  return <FinanceStoreContext.Provider value={store}>{children}</FinanceStoreContext.Provider>;
}

/** Hook utilitário: true se a árvore está em modo somente leitura. */
export function useFinanceReadOnly(): boolean {
  return useContext(FinanceStoreContext)?.readOnly ?? false;
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
// padrão que se repetia ~30× nas tabs (Revenue/Costs/Tax/Capital/Cashflow).
//
// Cada helper faz merge raso (1 nível). O `patch` pode ser:
//   - Partial<AppState[K]>                          → merge direto
//   - (cur, full) => Partial<AppState[K]>           → merge dependente do
//                                                     state anterior (ex.:
//                                                     editar 1 mês de array)
// Para edições profundamente aninhadas (ex.: item de uma lista) prefira a
// forma funcional `(cur) => ({ campo: ... })` em vez de chamar `update`.
// ---------------------------------------------------------------------
type StateSlice = "revenue" | "tax" | "capital" | "cashflow";
export type PatchInput<K extends StateSlice> =
  | Partial<AppState[K]>
  | ((cur: AppState[K], full: AppState) => Partial<AppState[K]>);

/**
 * Reducer puro — usado internamente pelos hooks e exportado para testes
 * unitários. NÃO depende do React; retorna sempre uma nova referência (mantém
 * imutabilidade do state e a igualdade referencial das fatias não tocadas).
 */
export function applyPatch<K extends StateSlice>(
  state: AppState,
  slice: K,
  patch: PatchInput<K>,
): AppState {
  const cur = state[slice] as AppState[K];
  const p =
    typeof patch === "function"
      ? (patch as (c: AppState[K], s: AppState) => Partial<AppState[K]>)(cur, state)
      : patch;
  return { ...state, [slice]: { ...(cur as object), ...p } } as AppState;
}

function makePatch<K extends StateSlice>(slice: K) {
  return function usePatchSlice() {
    const update = useFinanceUpdate();
    return useCallback(
      (patch: PatchInput<K>) => update((s) => applyPatch(s, slice, patch)),
      [update],
    );
  };
}

/** `patch(p | (cur)=>p)` → merge raso em `state.revenue`. */
export const usePatchRevenue = makePatch("revenue");
/** `patch(p | (cur)=>p)` → merge raso em `state.tax`. */
export const usePatchTax = makePatch("tax");
/** `patch(p | (cur)=>p)` → merge raso em `state.capital`. */
export const usePatchCapital = makePatch("capital");
/** `patch(p | (cur)=>p)` → merge raso em `state.cashflow`. */
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

const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Loading chunk|Unable to preload CSS/i;

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
    // Depois de uma atualização do sistema, a aba aberta pede arquivos que não
    // existem mais: a saída é recarregar, não uma mensagem técnica.
    if (CHUNK_ERROR_RE.test(`${error.name} ${error.message}`))
      return (
        <div className="m-4 rounded-lg border border-primary/30 bg-primary/5 p-6 text-sm">
          <h2 className="mb-2 text-base font-semibold">Há uma versão nova do sistema</h2>
          <p className="mb-3 text-muted-foreground">
            Recarregue a página para continuar. Seus dados estão salvos.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Recarregar
          </button>
        </div>
      );
    return (
      <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <h2 className="mb-2 text-base font-semibold text-destructive">
          Erro ao renderizar este painel
        </h2>
        <p className="mb-1 text-muted-foreground">
          Ocorreu um erro inesperado neste painel. Seus dados estão salvos — tente de novo ou abra
          outra aba.
        </p>
        {error.message && (
          <p className="mb-3 text-[11px] text-muted-foreground/80">Detalhe: {error.message}</p>
        )}
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
