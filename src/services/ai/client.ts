// Cliente unificado para LM Studio e OpenAI (API OpenAI-compatible).
import type { AIConfig } from "./providers";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Lista modelos disponíveis no endpoint (GET /v1/models). */
export async function listModels(cfg: AIConfig): Promise<string[]> {
  const res = await fetch(`${cfg.baseUrl}/models`, {
    headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json();
  const arr = Array.isArray(json?.data) ? json.data : [];
  return arr.map((m: any) => m.id).filter(Boolean);
}

/** Testa conexão fazendo uma chamada mínima. */
export async function testConnection(cfg: AIConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const models = await listModels(cfg);
    return { ok: true, message: `Conectado. ${models.length} modelo(s) disponível(is).` };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/** Stream de chat completion (SSE). Yields deltas de texto. */
export async function* streamChat(
  cfg: AIConfig,
  messages: LLMMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // ignora linhas parciais
      }
    }
  }
}
