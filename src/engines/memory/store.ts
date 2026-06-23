// Memória persistente do consultor por empresa — armazena conclusões
// importantes da IA (diagnósticos, decisões, hipóteses validadas) para
// reinjeção em conversas futuras. Mesmo padrão do actions/store.ts:
// localStorage + event bus + useSyncExternalStore para reatividade.
import { nanoid } from "nanoid";
import { useSyncExternalStore } from "react";
import { saveKeySync, removeKey } from "@/engines/finance/persistence";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
  try {
    window.dispatchEvent(new CustomEvent("gz-memory-changed"));
  } catch {
    // SSR / sem window
  }
}

export function subscribeMemories(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("gz-finance-memory-")) listener();
  };
  const onCustom = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("gz-memory-changed", onCustom);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("gz-memory-changed", onCustom);
  };
}

export type MemoryCategory =
  | "diagnostico"
  | "decisao"
  | "hipotese"
  | "premissa"
  | "preferencia"
  | "outro";

export interface MemoryItem {
  id: string;
  conteudo: string; // texto da conclusão (≤ 500 chars recomendado)
  categoria: MemoryCategory;
  fonte?: string; // ex: "WACC 18,2% (get_wacc)"
  createdAt: number;
}

const KEY = (company: string) => `gz-finance-memory-${company || "default"}`;
const MAX_ITEMS = 50; // teto para não inflar system prompt

function readRaw(company: string): MemoryItem[] {
  try {
    const raw = localStorage.getItem(KEY(company));
    return raw ? (JSON.parse(raw) as MemoryItem[]) : [];
  } catch {
    return [];
  }
}

export function listMemories(company: string): MemoryItem[] {
  return readRaw(company);
}

export function createMemory(
  company: string,
  input: { conteudo: string; categoria?: MemoryCategory; fonte?: string },
): MemoryItem {
  const item: MemoryItem = {
    id: nanoid(),
    conteudo: input.conteudo.trim().slice(0, 800),
    categoria: input.categoria ?? "outro",
    fonte: input.fonte?.trim() || undefined,
    createdAt: Date.now(),
  };
  const all = readRaw(company);
  all.unshift(item);
  // Mantém apenas as MAX_ITEMS mais recentes — evita system prompt gigante.
  const trimmed = all.slice(0, MAX_ITEMS);
  saveKeySync(KEY(company), trimmed);
  emit();
  return item;
}

export function deleteMemory(company: string, id: string) {
  const all = readRaw(company).filter((m) => m.id !== id);
  saveKeySync(KEY(company), all);
  emit();
}

export function clearMemories(company: string) {
  removeKey(KEY(company));
  emit();
}

/** Hook reativo — re-renderiza quando memórias mudam (chat ou UI). */
export function useMemories(company: string): MemoryItem[] {
  const snap = useSyncExternalStore(
    subscribeMemories,
    () => `${company}::${localStorage.getItem(KEY(company)) ?? ""}`,
    () => `${company}::`,
  );
  const raw = snap.slice(company.length + 2);
  try {
    return raw ? (JSON.parse(raw) as MemoryItem[]) : [];
  } catch {
    return [];
  }
}

/** Bloco markdown para injetar no system prompt. */
export function memoriesToPromptBlock(items: MemoryItem[]): string {
  if (!items.length) return "";
  const lines = ["### MEMÓRIA PERSISTENTE (conclusões salvas em sessões anteriores)"];
  for (const m of items) {
    const fonte = m.fonte ? ` _(fonte: ${m.fonte})_` : "";
    lines.push(`- [${m.categoria}] ${m.conteudo}${fonte}`);
  }
  lines.push(
    "_Use estas conclusões como ponto de partida; revalide com tools se houver dúvida ou se os dados mudaram._",
  );
  return lines.join("\n");
}
