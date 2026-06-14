import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Scenario } from "./types";
import { DEFAULT_STATE, migrateState } from "./defaults";
import { useAuth } from "@/lib/auth";
import { loadKey, saveKey, broadcastChange, onRemoteChange } from "./persistence";

const stateKey = (u: string) => `gzfp:state:${u}`;
const scenKey = (u: string) => `gzfp:scenarios:${u}`;

// Legacy keys (pre-auth) — migrated on first hydrate per user.
const LEGACY_STATE = ["simulapro:state:v2", "simulapro:state:v1"];
const LEGACY_SCEN = ["simulapro:scenarios:v2", "simulapro:scenarios:v1"];

async function readFirstAsync<T>(keys: string[]): Promise<T | null> {
  for (const k of keys) {
    const v = await loadKey<T>(k);
    if (v != null) return v;
  }
  return null;
}

export function useAppState() {
  const { user } = useAuth();
  const username = user?.id ?? "guest";
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  // Evita race ao trocar de sessão (estado do user A escrito na key do user B).
  const hydratedFor = useRef<string | null>(null);
  // Suprime salvamento quando o estado foi recebido via broadcast de outra aba.
  const suppressSave = useRef(false);

  const hydrate = useCallback(async () => {
    setHydrated(false);
    hydratedFor.current = null;
    try {
      const stored = await loadKey<Partial<AppState>>(stateKey(username));
      const fromLegacy = stored ?? (await readFirstAsync<Partial<AppState>>(LEGACY_STATE));
      if (fromLegacy) {
        setState(migrateState({ ...DEFAULT_STATE, ...fromLegacy }));
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
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated || hydratedFor.current !== username) return;
    if (suppressSave.current) {
      suppressSave.current = false;
      return;
    }
    void saveKey(stateKey(username), state).then(() => broadcastChange(stateKey(username)));
  }, [state, hydrated, username]);

  // Sincroniza com outras abas
  useEffect(() => {
    return onRemoteChange(async (key) => {
      if (key !== stateKey(username)) return;
      const fresh = await loadKey<Partial<AppState>>(key);
      if (fresh) {
        suppressSave.current = true;
        setState(migrateState({ ...DEFAULT_STATE, ...fresh }));
      }
    });
  }, [username]);

  // SSOT: TODO patch passa por migrateState — sanitiza Months[12],
  // normaliza valores inválidos (NaN/Infinity/strings) e garante a
  // invariante de tipos antes de salvar.
  const update = useCallback((patch: Partial<AppState> | ((s: AppState) => AppState)) => {
    setState((s) => {
      const next = typeof patch === "function" ? patch(s) : { ...s, ...patch };
      return migrateState(next);
    });
  }, []);

  const reset = useCallback(() => setState(DEFAULT_STATE), []);

  return { state, setState, update, reset, hydrated };
}

export function useScenarios() {
  const { user } = useAuth();
  const username = user?.id ?? "guest";
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const suppressSave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHydrated(false);
      try {
        const stored = await loadKey<Scenario[]>(scenKey(username));
        const fromLegacy = stored ?? (await readFirstAsync<Scenario[]>(LEGACY_SCEN));
        if (!cancelled) setScenarios(fromLegacy ?? []);
      } catch {
        if (!cancelled) setScenarios([]);
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [username]);

  useEffect(() => {
    if (!hydrated) return;
    if (suppressSave.current) { suppressSave.current = false; return; }
    void saveKey(scenKey(username), scenarios).then(() => broadcastChange(scenKey(username)));
  }, [scenarios, hydrated, username]);

  useEffect(() => {
    return onRemoteChange(async (key) => {
      if (key !== scenKey(username)) return;
      const fresh = await loadKey<Scenario[]>(key);
      if (fresh) {
        suppressSave.current = true;
        setScenarios(fresh);
      }
    });
  }, [username]);

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
