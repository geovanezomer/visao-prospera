// Cenários salvos por empresa — localStorage.
// IDs via nanoid. Soft delete habilita futuras features (undo, sync).
import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { saveKeySync } from "@/engines/finance/persistence";
import type { SimulatorParams } from "@/engines/finance/simulator";
import type { AppState } from "@/engines/finance/types";

// Event bus reativo + sincronização multi-aba via BroadcastChannel.
type Listener = () => void;
const listeners = new Set<Listener>();

// Canal de broadcast cross-tab — avisa outras abas quando a store muda.
// Fallback silencioso em browsers sem suporte (Safari < 15.4).
let bc: BroadcastChannel | null = null;
function getBC(): BroadcastChannel | null {
  if (bc) return bc;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    bc = new BroadcastChannel("gz-scenarios");
  } catch {
    bc = null;
  }
  return bc;
}

function emit() {
  for (const l of listeners) l();
  try {
    window.dispatchEvent(new CustomEvent("gz-scenarios-changed"));
  } catch {
    // SSR / ambiente sem window — best-effort
  }
  try {
    getBC()?.postMessage({ type: "changed", ts: Date.now() });
  } catch {
    /* ignora */
  }
}

export function subscribeScenarios(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("gz-finance-scenarios-")) listener();
  };
  const onCustom = () => listener();
  const onBC = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("gz-scenarios-changed", onCustom);
  const ch = getBC();
  ch?.addEventListener("message", onBC);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("gz-scenarios-changed", onCustom);
    ch?.removeEventListener("message", onBC);
  };
}
export function useScenarios(
  company: string,
  opts?: { includeDeleted?: boolean },
): ScenarioRecord[] {
  const snap = useSyncExternalStore(
    subscribeScenarios,
    () =>
      `${company}::${localStorage.getItem(`gz-finance-scenarios-${company || "default"}`) ?? ""}`,
    () => `${company}::`,
  );
  const raw = snap.slice(company.length + 2);
  try {
    const all = raw ? (JSON.parse(raw) as ScenarioRecord[]) : [];
    return opts?.includeDeleted ? all : all.filter((s) => !s.isDeleted);
  } catch {
    return [];
  }
}

export interface ScenarioRecord {
  id: string;
  name: string;
  notes?: string;
  /** Opcional: undefined = cenário base (sem alavancas ativas no simulador). */
  params?: SimulatorParams;
  /** Resumo persistido para listagem rápida. */
  summary?: {
    ebitda: number;
    margemEbitda: number;
    lucroLiquido: number;
    ev?: number;
    saldoFinalCaixa?: number;
    receita?: number;
    dscr?: number | null;
  };
  /** Tipo do cenário:
   *  - "whatif" (default): simulação de alavanca, comparado contra base.
   *  - "historical": snapshot de um AppState (ano fechado OU previsão/budget),
   *    usado pelas pills de período no cabeçalho. Carrega AppState inteiro
   *    ao ser restaurado. */
  kind?: "whatif" | "historical";
  /** Apenas para `kind: "historical"`:
   *  - "realizado" (default): ano fiscal fechado/em andamento.
   *  - "previsao": orçamento/projeção (budget) para uso em Previsto × Realizado. */
  subKind?: "realizado" | "previsao";
  /** Apenas para `kind: "historical"`: ano fiscal do snapshot (ex: 2024). */
  fiscalYear?: number;
  /** Snapshot completo do AppState. Obrigatório quando `kind === "historical"`. */
  state?: AppState;
  /** ID do cenário-pai (ramificação/clonagem). Permite árvore de variantes. */
  parentId?: string;
  /** Metadados livres: autor, descrição, premissas estruturadas, tags. */
  metadata?: {
    createdBy?: string;
    description?: string;
    premissas?: Record<string, unknown>;
    tags?: string[];
  };
  createdAt: number;
  updatedAt: number;
  /** Soft delete — filtrado em listScenarios por padrão. */
  isDeleted?: boolean;
}

const KEY = (company: string) => `gz-finance-scenarios-${company || "default"}`;

function readRaw(company: string): ScenarioRecord[] {
  try {
    const raw = localStorage.getItem(KEY(company));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function listScenarios(
  company: string,
  opts?: { includeDeleted?: boolean },
): ScenarioRecord[] {
  const all = readRaw(company);
  return opts?.includeDeleted ? all : all.filter((s) => !s.isDeleted);
}

export function saveScenario(
  company: string,
  rec: Omit<ScenarioRecord, "id" | "createdAt" | "updatedAt"> & Partial<Pick<ScenarioRecord, "id">>,
): ScenarioRecord {
  const all = readRaw(company);
  const now = Date.now();
  if (rec.id) {
    const idx = all.findIndex((s) => s.id === rec.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...rec, updatedAt: now } as ScenarioRecord;
      saveKeySync(KEY(company), all);
      emit();
      return all[idx];
    }
  }
  const newRec: ScenarioRecord = {
    ...rec,
    id: nanoid(),
    createdAt: now,
    updatedAt: now,
  };
  all.unshift(newRec);
  saveKeySync(KEY(company), all);
  emit();
  return newRec;
}

/** Soft delete: marca isDeleted=true. Não remove do storage. */
export function deleteScenario(company: string, id: string) {
  const all = readRaw(company);
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], isDeleted: true, updatedAt: Date.now() };
  saveKeySync(KEY(company), all);
  emit();
}

export function restoreScenario(company: string, id: string) {
  const all = readRaw(company);
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], isDeleted: false, updatedAt: Date.now() };
  saveKeySync(KEY(company), all);
  emit();
}

export function getScenario(company: string, idOrName: string): ScenarioRecord | undefined {
  const all = listScenarios(company);
  return all.find((s) => s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase());
}

// ─── Snapshots históricos (Fase 3) ────────────────────────────────────
// Reutiliza a store de cenários para guardar AppState de anos fechados.
// Pills no cabeçalho só aparecem quando há 2+ historicals salvos.

/** Lista apenas cenários históricos, ordenados por ano (asc). */
export function listHistoricals(company: string): ScenarioRecord[] {
  return listScenarios(company)
    .filter((s) => s.kind === "historical" && s.state)
    .sort((a, b) => (a.fiscalYear ?? 0) - (b.fiscalYear ?? 0));
}

/** Teto de snapshots históricos por empresa — protege o localStorage (~5MB)
 *  e evita listas infinitas na UI. Mantém sempre os anos mais recentes. */
export const MAX_HISTORICALS_PER_COMPANY = 20;

/**
 * Arquiva o AppState atual como snapshot histórico.
 *
 * - `subKind === "realizado"` (default): idempotente por ano — se já existe
 *   realizado para `fiscalYear`, sobrescreve. Nome default: "Ano YYYY".
 * - `subKind === "previsao"`: permite múltiplas previsões por ano (ex:
 *   "Previsão 2026 - Conservador" e "Previsão 2026 - Agressivo"). Idempotente
 *   por nome dentro do mesmo ano.
 *
 * Faz auto-pruning ao exceder MAX_HISTORICALS_PER_COMPANY (mantém os
 * `fiscalYear` mais recentes).
 */
export function archiveYearAsHistorical(
  company: string,
  fiscalYear: number,
  state: import("@/engines/finance/types").AppState,
  summary?: ScenarioRecord["summary"],
  opts?: { subKind?: "realizado" | "previsao"; name?: string },
): ScenarioRecord {
  const subKind = opts?.subKind ?? "realizado";
  const defaultName = subKind === "previsao" ? `Previsão ${fiscalYear}` : `Ano ${fiscalYear}`;
  const name = opts?.name?.trim() || defaultName;
  // Idempotência: realizado → por ano. Previsão → por (ano, nome).
  const existing = listScenarios(company).find((s) => {
    if (s.kind !== "historical" || s.fiscalYear !== fiscalYear) return false;
    const sSub = s.subKind ?? "realizado";
    if (sSub !== subKind) return false;
    return subKind === "realizado" ? true : s.name === name;
  });
  const stamped = { ...state, fiscalYear };
  const rec = saveScenario(company, {
    id: existing?.id,
    name,
    kind: "historical",
    subKind,
    fiscalYear,
    state: stamped,
    summary,
  });
  // Auto-pruning: descarta historicals excedentes (mantém os mais recentes).
  const allHist = readRaw(company)
    .filter((s) => s.kind === "historical" && !s.isDeleted)
    .sort((a, b) => (b.fiscalYear ?? 0) - (a.fiscalYear ?? 0));
  if (allHist.length > MAX_HISTORICALS_PER_COMPANY) {
    const toPrune = allHist.slice(MAX_HISTORICALS_PER_COMPANY);
    const pruneIds = new Set(toPrune.map((s) => s.id));
    const next = readRaw(company).filter((s) => !pruneIds.has(s.id));
    try {
      saveKeySync(KEY(company), next);
      emit();
    } catch {
      /* quota — mantém como está */
    }
  }
  return rec;
}

/**
 * Troca o ano ativo SEM perder dados: auto-arquiva o AppState corrente sob
 * `currentState.fiscalYear` (ou o ano corrente como fallback) antes de
 * devolver o snapshot-alvo.
 *
 * Retorna o AppState a ser aplicado pelo chamador (com `fiscalYear` estampado).
 * Lança se o snapshot-alvo não tem `state`.
 */
export function switchToYear(
  company: string,
  target: ScenarioRecord,
  currentState: import("@/engines/finance/types").AppState,
): import("@/engines/finance/types").AppState {
  if (!target.state || !target.fiscalYear) {
    throw new Error("Snapshot-alvo inválido (sem state ou fiscalYear).");
  }
  const currentYear = currentState.fiscalYear ?? new Date().getFullYear();
  // Só auto-arquiva se o ano corrente é DIFERENTE do alvo — evita sobrescrever
  // o próprio snapshot que estamos carregando.
  if (currentYear !== target.fiscalYear) {
    archiveYearAsHistorical(company, currentYear, currentState);
  }
  return { ...target.state, fiscalYear: target.fiscalYear };
}

// ─── Ramificação e comparação (Fase 4) ───────────────────────────────
// Clonagem com `parentId` permite árvore de variantes (ex: "Otimista_v2"
// derivado de "Otimista_v1"). Comparação multi-cenário consolida métricas.

/**
 * Clona um cenário existente, preservando params e marcando `parentId`.
 * Permite overrides parciais nos params/metadata/name.
 */
export function cloneScenario(
  company: string,
  parentIdOrName: string,
  overrides?: {
    name?: string;
    paramsOverride?: Partial<SimulatorParams>;
    metadata?: ScenarioRecord["metadata"];
    notes?: string;
  },
): ScenarioRecord | undefined {
  const parent = getScenario(company, parentIdOrName);
  if (!parent) return undefined;
  const params: SimulatorParams | undefined = parent.params
    ? ({ ...parent.params, ...(overrides?.paramsOverride ?? {}) } as SimulatorParams)
    : (overrides?.paramsOverride as SimulatorParams | undefined);
  return saveScenario(company, {
    name: overrides?.name ?? `${parent.name} (clone)`,
    notes: overrides?.notes ?? parent.notes,
    params,
    summary: parent.summary,
    kind: parent.kind ?? "whatif",
    parentId: parent.id,
    metadata: {
      ...(parent.metadata ?? {}),
      ...(overrides?.metadata ?? {}),
    },
  });
}

/** Resolve uma lista de ids/nomes para registros (descarta inexistentes). */
export function resolveScenarios(company: string, idsOrNames: string[]): ScenarioRecord[] {
  return idsOrNames
    .map((s) => getScenario(company, s))
    .filter((s): s is ScenarioRecord => s != null);
}
