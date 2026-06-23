// Audit Trail genérico do chat — log append-only de TODAS as interações.
// Generaliza o padrão de diagnosticoTelemetry.ts para qualquer turno de chat.
// 100% local: localStorage (leitura sync) + IndexedDB (durabilidade)
// via persistence.ts. Particionado por companyName para isolar dados.
// Suporta auditoria CVM: "o que a IA respondeu sobre X em DD/MM?".

import { removeKey, saveKeySync } from "@/engines/finance/persistence";

const KEY = (company: string) => `gz-finance-chat-trail-${company || "default"}`;
const MAX_ENTRIES = 200; // teto para não inflar storage

export interface ChatTrailEntry {
  ts: string; // ISO
  company: string;
  threadId?: string;
  mode: string; // AIMode (string para evitar dep cíclica)
  provider: string;
  model: string;
  /** Pergunta do usuário (truncada). */
  userText: string;
  /** Tamanho aprox. da resposta em chars (proxy de tokens). */
  responseChars: number;
  /** Tools chamadas no turno (nomes). */
  tools: string[];
  durationMs: number;
  status: "ok" | "erro" | "abortado";
  errorMsg?: string;
}

function read(company: string): ChatTrailEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY(company));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ChatTrailEntry[]) : [];
  } catch {
    return [];
  }
}

export function readChatTrail(company: string): ChatTrailEntry[] {
  return read(company);
}

export function recordChatTrail(
  company: string,
  entry: Omit<ChatTrailEntry, "ts" | "company">,
): void {
  if (typeof window === "undefined") return;
  try {
    const full: ChatTrailEntry = {
      ts: new Date().toISOString(),
      company: company || "default",
      ...entry,
      userText: (entry.userText || "").slice(0, 500),
    };
    const list = [full, ...read(company)].slice(0, MAX_ENTRIES);
    saveKeySync(KEY(company), list);
  } catch {
    // best-effort
  }
}

export function clearChatTrail(company: string): void {
  if (typeof window === "undefined") return;
  removeKey(KEY(company));
}

/** Exporta o trail em Markdown para auditoria. */
export function chatTrailToMarkdown(entries: ChatTrailEntry[]): string {
  if (!entries.length) return "_Nenhuma interação registrada._";
  const rows = entries
    .map((e) => {
      const tools = e.tools.length ? e.tools.join(", ") : "—";
      const user = e.userText.replace(/\n/g, " ").slice(0, 80);
      return `| ${e.ts} | ${e.mode} | ${e.provider}/${e.model} | ${user} | ${tools} | ${e.responseChars} | ${e.durationMs}ms | ${e.status} |`;
    })
    .join("\n");
  return [
    "| Timestamp | Modo | Modelo | Pergunta | Tools | Chars | Duração | Status |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- |",
    rows,
  ].join("\n");
}
