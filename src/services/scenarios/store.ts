// Cenários salvos por empresa — localStorage.
import type { SimulatorParams } from "@/lib/finance/simulator";

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
}

const KEY = (company: string) => `gz-finance-scenarios-${company || "default"}`;

export function listScenarios(company: string): ScenarioRecord[] {
  try {
    const raw = localStorage.getItem(KEY(company));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveScenario(company: string, rec: Omit<ScenarioRecord, "id" | "createdAt" | "updatedAt"> & Partial<Pick<ScenarioRecord, "id">>): ScenarioRecord {
  const all = listScenarios(company);
  const now = Date.now();
  if (rec.id) {
    const idx = all.findIndex(s => s.id === rec.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...rec, updatedAt: now } as ScenarioRecord;
      localStorage.setItem(KEY(company), JSON.stringify(all));
      return all[idx];
    }
  }
  const newRec: ScenarioRecord = {
    ...rec,
    id: `sc-${now}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  all.unshift(newRec);
  localStorage.setItem(KEY(company), JSON.stringify(all));
  return newRec;
}

export function deleteScenario(company: string, id: string) {
  const all = listScenarios(company).filter(s => s.id !== id);
  localStorage.setItem(KEY(company), JSON.stringify(all));
}

export function getScenario(company: string, idOrName: string): ScenarioRecord | undefined {
  const all = listScenarios(company);
  return all.find(s => s.id === idOrName || s.name.toLowerCase() === idOrName.toLowerCase());
}
