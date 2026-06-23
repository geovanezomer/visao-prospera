// =====================================================================
// Cache persistente do Diagnóstico Executivo (PR3).
//
// - Armazena resultados em localStorage com TTL (default 7 dias).
// - Chave inclui promptVersion + provider + model + briefingHash, evitando
//   reuso indevido entre cenários, prompts ou modelos diferentes.
// - Limite de N entradas (LRU por timestamp).
// =====================================================================

import { removeKey, saveKeySync } from "@/engines/finance/persistence";
import type { DiagnosticoResult } from "./diagnostico";

const STORAGE_KEY = "financepro.diag.cache.v1";
const MAX_ENTRIES = 20;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

interface Entry {
  key: string;
  savedAt: number; // epoch ms
  result: DiagnosticoResult;
}

function readAll(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: Entry[]): void {
  if (typeof window === "undefined") return;
  saveKeySync(STORAGE_KEY, entries);
}

export function getCached(key: string): DiagnosticoResult | null {
  const entries = readAll();
  const hit = entries.find((e) => e.key === key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) {
    // expirado — limpa
    writeAll(entries.filter((e) => e.key !== key));
    return null;
  }
  return hit.result;
}

export function setCached(key: string, result: DiagnosticoResult): void {
  const now = Date.now();
  const entries = readAll()
    .filter((e) => e.key !== key && now - e.savedAt <= TTL_MS) // remove duplicata e expirados
    .concat({ key, savedAt: now, result })
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_ENTRIES);
  writeAll(entries);
}

export function clearCache(): void {
  if (typeof window === "undefined") return;
  removeKey(STORAGE_KEY);
}
