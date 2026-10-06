// =====================================================================
// usePersistedSimParams — autosave dos parâmetros do Simulador no browser.
//
// Persiste o último cenário do simulador por usuário no IndexedDB (com
// fallback localStorage via `loadKey`/`saveKey`). A chave é versionada
// pelo `FINNANCE_FILE_VERSION` para que upgrades do formato invalidem
// snapshots incompatíveis automaticamente, sem corromper o app.
//
// API: idêntica a `useState`, mas hidrata do disco no mount e salva com
// debounce de 300ms a cada mudança.
// =====================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { loadKey, saveKey } from "./persistence";
import { FINNANCE_FILE_VERSION } from "./fileFormat";
import { DEFAULT_SIM, type SimulatorParams } from "./simulator";

// Chave por usuário + versão. Bump em FINNANCE_FILE_VERSION descarta o
// snapshot antigo (volta a DEFAULT_SIM) — preferimos perder a sim a
// renderizar com shape inválido.
// No modo Odoo, cada empresa tem as suas alavancas (namespace da entidade).
const simKey = (userId: string, namespace?: string) =>
  `finnance:simParams:v${FINNANCE_FILE_VERSION}:${userId}${namespace ? `:${namespace}` : ""}`;

export function usePersistedSimParams(
  userId: string,
  namespace?: string,
): [SimulatorParams, React.Dispatch<React.SetStateAction<SimulatorParams>>, { hydrated: boolean }] {
  const [params, setParams] = useState<SimulatorParams>(DEFAULT_SIM);
  const [hydrated, setHydrated] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Evita salvar o DEFAULT_SIM por cima de um snapshot válido durante a hidratação.
  const hydratedFor = useRef<string | null>(null);

  // Hidratação ao montar / trocar de usuário.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    hydratedFor.current = null;
    void (async () => {
      try {
        const stored = await loadKey<SimulatorParams>(simKey(userId, namespace));
        if (cancelled) return;
        // Shape básico: precisa ser objeto. Schema completo dispensável
        // porque o Simulator faz seu próprio fallback campo a campo.
        if (stored && typeof stored === "object") {
          setParams({ ...DEFAULT_SIM, ...stored });
        } else {
          setParams(DEFAULT_SIM);
        }
      } catch {
        if (!cancelled) setParams(DEFAULT_SIM);
      } finally {
        if (!cancelled) {
          hydratedFor.current = simKey(userId, namespace);
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, namespace]);

  // Autosave com debounce 300ms. Não salva enquanto não hidratou para o
  // mesmo usuário (evita race ao trocar de conta).
  useEffect(() => {
    if (!hydrated || hydratedFor.current !== simKey(userId, namespace)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void saveKey(simKey(userId, namespace), params).catch(() => {
        /* falha silenciosa — sim não é dado crítico */
      });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [params, userId, namespace, hydrated]);

  const setStable = useCallback<React.Dispatch<React.SetStateAction<SimulatorParams>>>(
    (v) => setParams(v),
    [],
  );

  return [params, setStable, { hydrated }];
}
