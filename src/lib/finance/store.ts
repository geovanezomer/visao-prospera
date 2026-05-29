import { useCallback, useEffect, useState } from "react";
import { AppState, Scenario } from "./types";
import { DEFAULT_STATE, migrateState } from "./defaults";

const KEY = "simulapro:state:v2";
const SCEN_KEY = "simulapro:scenarios:v2";

export function useAppState() {
  // SSR-safe: sempre inicia com o default. Hidrata do localStorage no useEffect.
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hidratação client-only
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY) ?? localStorage.getItem("simulapro:state:v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        setState(migrateState({ ...DEFAULT_STATE, ...parsed }));
      }
    } catch {}
    setHydrated(true);
  }, []);

  // Persiste só após hidratar (evita sobrescrever com o default no primeiro render)
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const update = useCallback((patch: Partial<AppState> | ((s: AppState) => AppState)) => {
    setState((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch }));
  }, []);

  const reset = useCallback(() => setState(DEFAULT_STATE), []);

  return { state, setState, update, reset, hydrated };
}

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCEN_KEY) ?? localStorage.getItem("simulapro:scenarios:v1");
      if (raw) setScenarios(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(SCEN_KEY, JSON.stringify(scenarios)); } catch {}
  }, [scenarios, hydrated]);

  const save = (name: string, state: AppState) => {
    setScenarios((arr) => {
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return [...arr, { id, name, createdAt: Date.now(), state }].slice(-5);
    });
  };
  const remove = (id: string) => setScenarios((arr) => arr.filter((s) => s.id !== id));
  return { scenarios, save, remove };
}
