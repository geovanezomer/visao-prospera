import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Scenario } from "./types";
import { DEFAULT_STATE, migrateState, validateAndMigrate } from "./defaults";
import { useAuth } from "@/lib/auth";
import { loadKey, saveKey, broadcastChange, onRemoteChange } from "./persistence";
import { archiveYearAsHistorical } from "@/engines/scenarios/store";

const stateKey = (u: string) => `finnance:state:${u}`;
const scenKey = (u: string) => `finnance:scenarios:${u}`;

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

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * @param namespace espaço de trabalho separado (ex.: "odoo:e:12" guarda as
 *   premissas de cada entidade do Odoo sem misturar com a simulação manual).
 */
export function useAppState(namespace?: string, initialState?: AppState) {
  const { user } = useAuth();
  const username = `${user?.id ?? "guest"}${namespace ? `:${namespace}` : ""}`;
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  // Evita race ao trocar de sessão (estado do user A escrito na key do user B).
  const hydratedFor = useRef<string | null>(null);
  // Estado inicial de um espaço novo (ex.: premissas sugeridas pelo Odoo).
  const initialRef = useRef(initialState);
  initialRef.current = initialState;
  // Suprime salvamento quando o estado foi recebido via broadcast de outra aba
  // ou acabou de ser lido do armazenamento (regravar e avisar as outras abas
  // descartaria o que elas estão digitando).
  const suppressSave = useRef(false);
  // Edição agendada e ainda não gravada (debounce): gravada na hora ao trocar
  // de espaço ou sair; uma mudança vinda de outra aba não a sobrescreve.
  const pending = useRef<{ key: string; state: AppState } | null>(null);
  // Espaço novo nomeado (entidade do Odoo) só hidrata quando as premissas
  // iniciais estiverem prontas — senão gravaria o estado padrão nele.
  const initialReady = !namespace || initialState !== undefined;

  // Geração da hidratação: uma leitura lenta de um espaço anterior (troca
  // rápida de entidade/modo) não pode sobrescrever o espaço atual.
  const hydrateGen = useRef(0);

  const hydrate = useCallback(async () => {
    const gen = ++hydrateGen.current;
    setHydrated(false);
    hydratedFor.current = null;
    try {
      const stored = await loadKey<unknown>(stateKey(username));
      const fromLegacy = stored ?? (namespace ? null : await readFirstAsync<unknown>(LEGACY_STATE));
      if (gen !== hydrateGen.current) return;
      if (!fromLegacy && !initialReady) return; // espera as premissas iniciais
      // validateAndMigrate: Zod no shape de topo + migrateState (sanitiza
      // Months[12], normaliza NaN/Infinity, garante invariantes). Se o
      // JSON estiver corrompido ou manipulado, cai em DEFAULT_STATE.
      suppressSave.current = !!fromLegacy;
      setState(fromLegacy ? validateAndMigrate(fromLegacy) : (initialRef.current ?? DEFAULT_STATE));
    } catch {
      if (gen !== hydrateGen.current) return;
      setState(DEFAULT_STATE);
    }
    if (gen !== hydrateGen.current) return;
    hydratedFor.current = username;
    setHydrated(true);
  }, [username, namespace, initialReady]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Autosave com debounce de 300ms. Marca "saving" imediatamente para
  // feedback visual, salva após o usuário parar de digitar, e converge
  // para "saved" (ou "error" em caso de falha de IDB+localStorage).
  // Após 2s sem novas mutações, volta a "idle" para evitar ruído visual.
  useEffect(() => {
    if (!hydrated || hydratedFor.current !== username) return;
    if (suppressSave.current) {
      suppressSave.current = false;
      return;
    }
    setAutosaveStatus("saving");
    pending.current = { key: stateKey(username), state };
    const t = setTimeout(async () => {
      try {
        pending.current = null;
        await saveKey(stateKey(username), state);
        broadcastChange(stateKey(username));
        // Auto-arquiva o AppState do ano corrente no store de cenários
        // (localStorage por empresa). Garante que cada fiscalYear tenha
        // sempre seu snapshot mais recente — pills de período carregam
        // exatamente o que o usuário deixou ao trocar de ano ou reabrir.
        try {
          // No modo Odoo o histórico vem do ERP — não arquiva premissas como "ano".
          if (!namespace && state.fiscalYear && state.companyName) {
            archiveYearAsHistorical(state.companyName, state.fiscalYear, state);
          }
        } catch {
          // Falha em arquivar não invalida o autosave principal.
        }
        setAutosaveStatus("saved");
      } catch {
        setAutosaveStatus("error");
      }
    }, 300);

    return () => clearTimeout(t);
  }, [state, hydrated, username, namespace]);

  // Troca de espaço (empresa/entidade/usuário) ou saída: grava na hora a edição
  // ainda no debounce, na chave do espaço que está sendo deixado.
  useEffect(() => {
    const flush = () => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      void saveKey(p.key, p.state).then(() => broadcastChange(p.key));
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [username]);

  // Após "saved", volta a "idle" depois de 2s — evita poluir o header.
  useEffect(() => {
    if (autosaveStatus !== "saved") return;
    const t = setTimeout(() => setAutosaveStatus("idle"), 2000);
    return () => clearTimeout(t);
  }, [autosaveStatus]);

  // Sincroniza com outras abas
  useEffect(() => {
    return onRemoteChange(async (key) => {
      if (key !== stateKey(username)) return;
      // Edição local ainda não gravada: ela vence (será gravada em instantes).
      if (pending.current?.key === key) return;
      const fresh = await loadKey<unknown>(key);
      if (fresh && !pending.current) {
        suppressSave.current = true;
        setState(validateAndMigrate(fresh));
      }
    });
  }, [username]);

  // SSOT: TODO patch passa por migrateState — sanitiza Months[12],
  // normaliza valores inválidos (NaN/Infinity/strings) e garante a
  // invariante de tipos antes de salvar.
  const update = useCallback((patch: Partial<AppState> | ((s: AppState) => AppState)) => {
    setState((s) => {
      const next = typeof patch === "function" ? patch(s) : { ...s, ...patch };
      if (next === s) return s;
      return migrateState(next);
    });
  }, []);

  const reset = useCallback(() => setState(DEFAULT_STATE), []);

  return { state, setState, update, reset, hydrated, autosaveStatus };
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
    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!hydrated) return;
    if (suppressSave.current) {
      suppressSave.current = false;
      return;
    }
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

  // Limite generoso de cenários por usuário; consultores CVM costumam
  // manter dezenas de simulações por cliente. Mantemos um teto apenas
  // para proteger o IndexedDB de crescer indefinidamente.
  const MAX_SCENARIOS = 100;

  const save = (name: string, state: AppState) => {
    setScenarios((arr) => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      return [...arr, { id, name, createdAt: Date.now(), state }].slice(-MAX_SCENARIOS);
    });
  };
  const remove = (id: string) => setScenarios((arr) => arr.filter((s) => s.id !== id));
  const replaceAll = (next: Scenario[]) => setScenarios(next.slice(-MAX_SCENARIOS));
  return { scenarios, save, remove, replaceAll };
}
