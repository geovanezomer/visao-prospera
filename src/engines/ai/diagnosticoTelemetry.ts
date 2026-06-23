// =====================================================================
// Telemetria local do Diagnóstico Executivo (PR3 - Observabilidade).
//
// Log append-only com as últimas N gerações em localStorage (leitura sync)
// + IndexedDB (durabilidade) via persistence.ts. Útil para:
// - Auditoria CVM (quando rodou, qual modelo, quanto tempo levou)
// - Debug do consultor (por que falhou? veio do cache?)
//
// Nada é enviado para fora — 100% local.
// =====================================================================

import { removeKey, saveKeySync } from "@/engines/finance/persistence";

const STORAGE_KEY = "financepro.diag.telemetry.v1";
const MAX_ENTRIES = 50;

export interface TelemetryEntry {
  ts: string; // ISO
  provider: string;
  model: string;
  promptVersion: string;
  briefingHash: string;
  durationMs: number;
  status: "ok" | "cache" | "erro";
  /** Tamanho aprox. do output em chars (proxy de tokens). */
  outputChars?: number;
  errorMsg?: string;
}

export function readTelemetry(): TelemetryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as TelemetryEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordTelemetry(entry: TelemetryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const list = [entry, ...readTelemetry()].slice(0, MAX_ENTRIES);
    saveKeySync(STORAGE_KEY, list);
  } catch {
    // best-effort
  }
}

export function clearTelemetry(): void {
  if (typeof window === "undefined") return;
  removeKey(STORAGE_KEY);
}
