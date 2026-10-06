// ============================================================================
// Cockpit no modo Odoo.
//
// - `useOdooCockpit()` lê a configuração da instância e o retrato mais
//   recente, lista as entidades (matriz + filiais, filial, consolidado) e
//   guarda a escolha do usuário (entidade, mês final, visão Odoo/Simulação).
// - `OdooCockpitContext` expõe isso para as abas (barra do topo, travas de
//   edição do realizado, consolidado e conciliação tributária).
// ============================================================================
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getCockpitConfig, getOdooSnapshot } from "@/lib/odoo/odoo.functions";
import {
  buildEntityData,
  listEntities,
  prepareOdooOverlay,
  type OdooEntity,
  type OdooEntityData,
  type OdooOverlay,
} from "@/engines/odoo/toAppState";
import type { OdooSnapshot } from "@/engines/odoo/types";

export type CockpitView = "odoo" | "manual";

export type OdooCockpit = {
  /** A instância está no modo Odoo (chave seletora do admin). */
  available: boolean;
  /** O usuário está vendo os dados do Odoo (e não a simulação livre). */
  active: boolean;
  loading: boolean;
  view: CockpitView;
  setView: (v: CockpitView) => void;
  snapshot: OdooSnapshot | null;
  syncedAt: string | null;
  entities: OdooEntity[];
  entity: OdooEntity | null;
  setEntityKey: (key: string) => void;
  /** Mês final da janela de 12 meses ("yyyy-mm"); null = último mês fechado. */
  endMonth: string | null;
  setEndMonth: (m: string | null) => void;
  data: OdooEntityData | null;
  overlay: OdooOverlay | null;
};

const LS_VIEW = "finnance:cockpit:view";
const LS_ENTITY = "finnance:odoo:entity";
const LS_END = "finnance:odoo:endMonth";

function readLS(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string | null) {
  try {
    if (v === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, v);
  } catch {
    /* modo privado */
  }
}

export function useOdooCockpit(): OdooCockpit {
  const config = useQuery({
    queryKey: ["odoo", "cockpit-config"],
    queryFn: () => getCockpitConfig(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const available = config.data?.dataSource === "odoo";
  const snap = useQuery({
    queryKey: ["odoo", "snapshot", config.data?.syncedAt ?? null],
    queryFn: () => getOdooSnapshot(),
    enabled: available,
    staleTime: Infinity,
  });

  const [view, setViewState] = useState<CockpitView>("odoo");
  const [entityKey, setEntityKeyState] = useState<string | null>(null);
  const [endMonth, setEndMonthState] = useState<string | null>(null);
  useEffect(() => {
    setViewState(readLS(LS_VIEW) === "manual" ? "manual" : "odoo");
    setEntityKeyState(readLS(LS_ENTITY));
    setEndMonthState(readLS(LS_END));
  }, []);

  const setView = useCallback((v: CockpitView) => {
    setViewState(v);
    writeLS(LS_VIEW, v);
  }, []);
  const setEntityKey = useCallback((k: string) => {
    setEntityKeyState(k);
    writeLS(LS_ENTITY, k);
  }, []);
  const setEndMonth = useCallback((m: string | null) => {
    setEndMonthState(m);
    writeLS(LS_END, m);
  }, []);

  const snapshot = snap.data?.snapshot ?? null;
  const entities = useMemo(() => (snapshot ? listEntities(snapshot) : []), [snapshot]);
  const entity = entities.find((e) => e.key === entityKey) ?? entities[0] ?? null;
  const validEnd = endMonth && snapshot?.months.includes(endMonth) ? endMonth : null;
  const data = useMemo(
    () => (snapshot && entity ? buildEntityData(snapshot, entity, validEnd) : null),
    [snapshot, entity, validEnd],
  );
  const overlay = useMemo(() => (data ? prepareOdooOverlay(data) : null), [data]);

  const active = available && view === "odoo" && overlay !== null;
  return {
    available,
    active,
    loading: config.isLoading || (available && snap.isLoading),
    view,
    setView,
    snapshot,
    syncedAt: snap.data?.syncedAt ?? null,
    entities,
    entity,
    setEntityKey,
    endMonth: validEnd,
    setEndMonth,
    data,
    overlay,
  };
}

const Ctx = createContext<OdooCockpit | null>(null);

export function OdooCockpitProvider({
  value,
  children,
}: {
  value: OdooCockpit;
  children: ReactNode;
}) {
  return createElement(Ctx.Provider, { value }, children);
}

/** null fora do provider (ex.: página compartilhada) — trate como modo manual. */
export function useOdooCockpitContext(): OdooCockpit | null {
  return useContext(Ctx);
}
