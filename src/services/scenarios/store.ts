// Cenários salvos por empresa — localStorage.
// IDs via nanoid. Soft delete habilita futuras features (undo, sync).
import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import type { SimulatorParams } from "@/lib/finance/simulator";

// Event bus reativo (mesmo padrão de actions/store).
type Listener = () => void;
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l();
  try { window.dispatchEvent(new CustomEvent("gz-scenarios-changed")); } catch {}
}
export function subscribeScenarios(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith("gz-finance-scenarios-")) listener(); };
  const onCustom = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("gz-scenarios-changed", onCustom);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("gz-scenarios-changed", onCustom);
  };
}
export function useScenarios(company: string, opts?: { includeDeleted?: boolean }): ScenarioRecord[] {
  const snap = useSyncExternalStore(
    subscribeScenarios,
    () => `${company}::${localStorage.getItem(`gz-finance-scenarios-${company || "default"}`) ?? ""}`,
    () => `${company}::`,
  );
  const raw = snap.slice(company.length + 2);
  try {
    const all = raw ? (JSON.parse(raw) as ScenarioRecord[]) : [];
    return opts?.includeDeleted ? all : all.filter(s => !s.isDeleted);
  } catch { return []; }
}

export interface ScenarioRecord {
  id: string;
  name: string;
  notes?: string;
  params: SimulatorParams;
  /** Resumo persistido para listagem rápida. */
  summary?: {
    ebitda: number;
    margemEbitda: number;
    lucroLiquido: number;
    ev?: number;
    saldoFinalCaixa?: number;
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
  } catch { return []; }
}

export function listScenarios(company: string, opts?: { includeDeleted?: boolean }): ScenarioRecord[] {
  const all = readRaw(company);
  return opts?.includeDeleted ? all : all.filter(s => !s.isDeleted);
}

export function saveScenario(company: string, rec: Omit<ScenarioRecord, "id" | "createdAt" | "updatedAt"> & Partial<Pick<ScenarioRecord, "id">>): ScenarioRecord {
  const all = readRaw(company);
  const now = Date.now();
  if (rec.id) {
    const idx = all.findIndex(s => s.id === rec.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...rec, updatedAt: now } as ScenarioRecord;
      localStorage.setItem(KEY(company), JSON.stringify(all)); emit();
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
  localStorage.setItem(KEY(company), JSON.stringify(all)); emit();
  return newRec;
}

/** Soft delete: marca isDeleted=true. Não remove do storage. */
export function deleteScenario(company: string, id: string) {
  const all = readRaw(company);
  const idx = all.findIndex(s => s.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], isDeleted: true, updatedAt: Date.now() };
  localStorage.setItem(KEY(company), JSON.stringify(all)); emit();
}

export function restoreScenario(company: string, id: string) {
  const all = readRaw(company);
  const idx = all.findIndex(s => s.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], isDeleted: false, updatedAt: Date.now() };
  localStorage.setItem(KEY(company), JSON.stringify(all)); emit();
}

export function getScenario(company: string, idOrName: string): ScenarioRecord | undefined {
  const all = listScenarios(company);
  return all.find(s => s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase());
}
