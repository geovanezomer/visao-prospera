import { useCallback, useEffect, useState } from "react";
import { AppState, Scenario } from "./types";
import { DEFAULT_STATE } from "./defaults";

const KEY = "simulapro:state:v1";
const SCEN_KEY = "simulapro:scenarios:v1";

export function useAppState() {
  const [state, setState] = useState<AppState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_STATE;
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  const update = useCallback((patch: Partial<AppState> | ((s: AppState) => AppState)) => {
    setState((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch }));
  }, []);

  const reset = useCallback(() => setState(DEFAULT_STATE), []);

  return { state, setState, update, reset };
}

export function useScenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(SCEN_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  useEffect(() => {
    try { localStorage.setItem(SCEN_KEY, JSON.stringify(scenarios)); } catch {}
  }, [scenarios]);

  const save = (name: string, state: AppState) => {
    setScenarios((arr) => {
      const next = [...arr, { id: crypto.randomUUID(), name, createdAt: Date.now(), state }];
      return next.slice(-5);
    });
  };
  const remove = (id: string) => setScenarios((arr) => arr.filter((s) => s.id !== id));
  return { scenarios, save, remove };
}
