import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Scenario } from "./types";
import { DEFAULT_STATE, migrateState } from "./defaults";
import { useAuth } from "@/lib/auth";

const stateKey = (u: string) => `gzfp:state:${u}`;
const scenKey = (u: string) => `gzfp:scenarios:${u}`;

// Legacy keys (pre-auth) — migrated on first hydrate per user.
const LEGACY_STATE = ["simulapro:state:v2", "simulapro:state:v1"];
const LEGACY_SCEN = ["simulapro:scenarios:v2", "simulapro:scenarios:v1"];

function readFirst(keys: string[]): string | null {
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k);
      if (v) return v;
    } catch {}
  }
  return null;
}

export function useAppState() {
  const { user } = useAuth();
  const username = user?.id ?? "guest";
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  // Garante que só salvamos no localStorage do usuário que foi efetivamente
  // hidratado — evita race ao trocar de sessão (estado do user A escrito
  // na key do user B antes da hidratação do B rodar).
  const hydratedFor = useRef<string | null>(null);

  // Re-hydrate whenever the logged-in user changes.
  useEffect(() => {
    setHydrated(false);
    hydratedFor.current = null;
    try {
      const raw = localStorage.getItem(stateKey(username)) ?? readFirst(LEGACY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState(migrateState({ ...DEFAULT_STATE, ...parsed }));
      } else {
        setState(DEFAULT_STATE);
      }
    } catch {
      setState(DEFAULT_STATE);
    }
    hydratedFor.current = username;
    setHydrated(true);
  }, [username]);

  useEffect(() => {
    if (!hydrated) return;
    if (hydratedFor.current !== username) return;
    try { localStorage.setItem(stateKey(username), JSON.stringify(state)); } catch {}
  }, [state, hydrated, username]);

  const update = useCallback((patch: Partial<AppState> | ((s: AppState) => AppState)) => {
    setState((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch }));
  }, []);

  const reset = useCallback(() => setState(DEFAULT_STATE), []);

  return { state, setState, update, reset, hydrated };
}

export function useScenarios() {
  const { user } = useAuth();
  const username = user?.id ?? "guest";
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(false);
    try {
      const raw = localStorage.getItem(scenKey(username)) ?? readFirst(LEGACY_SCEN);
      setScenarios(raw ? JSON.parse(raw) : []);
    } catch {
      setScenarios([]);
    }
    setHydrated(true);
  }, [username]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(scenKey(username), JSON.stringify(scenarios)); } catch {}
  }, [scenarios, hydrated, username]);

  const save = (name: string, state: AppState) => {
    setScenarios((arr) => {
      const id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return [...arr, { id, name, createdAt: Date.now(), state }].slice(-5);
    });
  };
  const remove = (id: string) => setScenarios((arr) => arr.filter((s) => s.id !== id));
  const replaceAll = (next: Scenario[]) => setScenarios(next.slice(-5));
  return { scenarios, save, remove, replaceAll };
}
