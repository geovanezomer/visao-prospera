// Utilitários de compressão de histórico para chamadas ao LLM.
// Preserva system prompt e contexto-âncora; comprime apenas o meio.

import type { ChatMessage } from "./providers";
import type { LLMMessage } from "./client";
import { estimateTokens } from "./snapshot";

// Orçamento de tokens APENAS para o histórico (não conta o system prompt).
// Ajuste conforme a janela do modelo: 6k é seguro para modelos locais de 8k-16k.
export const MAX_HISTORY_TOKENS = 6000;

// Quantas mensagens preservar nas pontas (não comprimir).
const KEEP_HEAD = 2; // primeiras: âncora de contexto da sessão
const KEEP_TAIL = 6; // últimas: turno corrente + recência relevante

const OMITTED_PLACEHOLDER: LLMMessage = {
  role: "assistant",
  content: "_(histórico de análises anteriores omitido para economizar contexto)_",
};

/**
 * Calcula tokens totais de um array de mensagens LLM.
 * Aceita content como string ou array (vision messages).
 */
function tokensOf(msgs: LLMMessage[]): number {
  let total = 0;
  for (const m of msgs) {
    if (typeof m.content === "string") {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      // Vision: soma só os textos; imagens não contam tokens textuais.
      for (const part of m.content as any[]) {
        if (part?.type === "text" && typeof part.text === "string") {
          total += estimateTokens(part.text);
        } else {
          total += 300; // estimativa fixa por imagem (placeholder)
        }
      }
    }
  }
  return total;
}

/**
 * Converte ChatMessage[] (histórico interno) em LLMMessage[] (formato API),
 * com substituição do conteúdo da última mensagem do usuário quando necessário.
 */
export function mapHistoryToLlm(opts: {
  history: ChatMessage[];
  forTools: boolean;
  lastUserContent: string | unknown[]; // texto ou vision array
}): LLMMessage[] {
  const { history, forTools, lastUserContent } = opts;
  const filtered = history.filter((m) =>
    forTools ? m.role === "user" || m.role === "assistant" : true,
  );
  const out: LLMMessage[] = [];
  filtered.forEach((m, idx) => {
    const isLastUser = idx === filtered.length - 1 && m.role === "user";
    const role = (m.role === "tool" ? "assistant" : m.role) as LLMMessage["role"];
    out.push({
      role,
      content: isLastUser ? (lastUserContent as any) : m.content,
    });
  });
  return out;
}

/**
 * Comprime histórico se estourar MAX_HISTORY_TOKENS.
 * Estratégia: mantém KEEP_HEAD + KEEP_TAIL; substitui o meio por um placeholder.
 * NÃO TOCA no system prompt (passado separadamente pelo caller).
 */
export function compressHistory(
  history: LLMMessage[],
  maxTokens: number = MAX_HISTORY_TOKENS,
): LLMMessage[] {
  const total = tokensOf(history);
  if (total <= maxTokens) return history;
  if (history.length <= KEEP_HEAD + KEEP_TAIL) return history;

  const head = history.slice(0, KEEP_HEAD);
  const tail = history.slice(-KEEP_TAIL);
  let compressed: LLMMessage[] = [...head, OMITTED_PLACEHOLDER, ...tail];

  // Se ainda assim ultrapassar (turno atual muito grande), reduz o head para 1.
  if (tokensOf(compressed) > maxTokens && KEEP_HEAD > 1) {
    compressed = [history[0], OMITTED_PLACEHOLDER, ...tail];
  }
  return compressed;
}

/**
 * Monta o array final para o LLM: [system, ...históricoComprimido].
 */
export function buildLlmMessages(opts: {
  systemPrompt: string;
  history: ChatMessage[];
  forTools: boolean;
  lastUserContent: string | unknown[];
  maxHistoryTokens?: number;
}): LLMMessage[] {
  const llmHistory = mapHistoryToLlm({
    history: opts.history,
    forTools: opts.forTools,
    lastUserContent: opts.lastUserContent,
  });
  const compressed = compressHistory(llmHistory, opts.maxHistoryTokens);
  return [{ role: "system", content: opts.systemPrompt }, ...compressed];
}
