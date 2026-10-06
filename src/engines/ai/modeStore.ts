// Persistência do modo de atuação da IA por empresa (localStorage).
// Modo é transient por sessão mas restaurado ao recarregar.
import type { AIMode } from "./systemPrompt";

const VALID_MODES: readonly AIMode[] = [
  "chat",
  "cfo",
  "controller",
  "auditor",
  "board",
  "tributarista",
];
const KEY = (company: string) => `gz-finance-ai-mode-${company || "default"}`;

export function loadAIMode(company: string): AIMode {
  try {
    const raw = localStorage.getItem(KEY(company));
    if (raw && (VALID_MODES as readonly string[]).includes(raw)) return raw as AIMode;
  } catch {
    // SSR / storage indisponível — cai no default.
  }
  return "chat";
}

export function saveAIMode(company: string, mode: AIMode): void {
  try {
    localStorage.setItem(KEY(company), mode);
  } catch {
    // ignora — não há fallback útil.
  }
}
