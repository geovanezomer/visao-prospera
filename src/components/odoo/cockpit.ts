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
  useRef,
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
  /** Cabeçalho + empresas carregadas da entidade aberta. */
  snapshot: OdooSnapshot | null;
  /** As empresas da entidade selecionada já chegaram (senão, mostra a anterior). */
  entityReady: boolean;
  syncedAt: string | null;
  /** Último erro de sincronização (o retrato exibido pode estar desatualizado). */
  lastError: string | null;
  /** Servidor + banco do Odoo (separa premissas entre instâncias). */
  instanceKey: string | null;
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
  // 1) Cabeçalho do retrato (meses, empresas): pequeno, define as entidades.
  const snapshotKey = config.data?.snapshotKey ?? null;
  const head = useQuery({
    // Chave = retrato em uso: falhas de sincronização não forçam novo download.
    queryKey: ["odoo", "snapshot-head", snapshotKey],
    queryFn: () => getOdooSnapshot({ data: { companyIds: [] } }),
    enabled: available && !!snapshotKey,
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

  const header = head.data?.snapshot ?? null;
  const entities = useMemo(() => (header ? listEntities(header) : []), [header]);
  const entity = entities.find((e) => e.key === entityKey) ?? entities[0] ?? null;

  // 2) Só as empresas da entidade aberta (filial: a matriz e as filiais, que
  //    servem de referência para as premissas).
  const neededIds = useMemo(() => {
    if (!entity) return [];
    const root =
      entity.kind === "branch"
        ? entities.find((e) => e.kind === "entity" && e.rootId === entity.rootId)
        : null;
    return [...(root?.companyIds ?? entity.companyIds)].sort((a, b) => a - b);
  }, [entity, entities]);
  const comps = useQuery({
    queryKey: ["odoo", "snapshot-companies", snapshotKey, neededIds.join(",")],
    queryFn: () => getOdooSnapshot({ data: { companyIds: neededIds } }),
    enabled: available && !!snapshotKey && neededIds.length > 0,
    staleTime: Infinity,
  });

  const loaded = comps.data?.snapshot ?? null;
  const ready = !!loaded && neededIds.every((id) => loaded.perCompany[String(id)]);
  const snapshot = useMemo(
    () => (header && ready && loaded ? { ...header, perCompany: loaded.perCompany } : null),
    [header, ready, loaded],
  );
  const validEnd = endMonth && header?.months.includes(endMonth) ? endMonth : null;
  const fresh = useMemo(
    () => (snapshot && entity ? buildEntityData(snapshot, entity, validEnd) : null),
    [snapshot, entity, validEnd],
  );
  // Troca de entidade: mantém os números anteriores até os novos chegarem
  // (evita piscar o espaço manual).
  const lastRef = useRef<{ snapshot: OdooSnapshot; data: OdooEntityData } | null>(null);
  if (fresh && snapshot) lastRef.current = { snapshot, data: fresh };
  const data = fresh ?? (available ? (lastRef.current?.data ?? null) : null);
  const shownSnapshot = snapshot ?? (available ? (lastRef.current?.snapshot ?? null) : null);
  const overlay = useMemo(() => (data ? prepareOdooOverlay(data) : null), [data]);

  const active = available && view === "odoo" && overlay !== null;
  return {
    available,
    active,
    loading:
      config.isLoading ||
      (available && !!snapshotKey && (head.isLoading || (!data && comps.isLoading))),
    view,
    setView,
    snapshot: shownSnapshot,
    entityReady: ready,
    syncedAt: head.data?.syncedAt ?? null,
    lastError: config.data?.lastError ?? null,
    instanceKey: config.data?.instanceKey ?? null,
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

/**
 * Retrato com TODAS as empresas (Consolidado e conciliação). Cacheado pelo
 * retrato em uso; só é baixado quando a aba que precisa dele abre.
 */
export function useOdooFullSnapshot(cockpit: OdooCockpit | null): OdooSnapshot | null {
  const config = useQuery({
    queryKey: ["odoo", "cockpit-config"],
    queryFn: () => getCockpitConfig(),
    staleTime: 60_000,
  });
  const snapshotKey = config.data?.snapshotKey ?? null;
  const q = useQuery({
    queryKey: ["odoo", "snapshot-full", snapshotKey],
    queryFn: () => getOdooSnapshot({ data: {} }),
    enabled: !!cockpit?.active && !!snapshotKey,
    staleTime: Infinity,
  });
  return q.data?.snapshot ?? null;
}
