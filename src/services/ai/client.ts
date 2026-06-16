// Cliente unificado: streaming, tool-calling, retry, timeout.
// Suporta provedores OpenAI-compatíveis (OpenAI, LM Studio) e Anthropic (Claude).
import type { AIConfig } from "./providers";
import { asOpenAITools, asAnthropicTools } from "./tools";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  name?: string;
}

const isAnthropic = (cfg: AIConfig) => cfg.provider === "anthropic";

// Cabeçalhos por provedor. Anthropic exige x-api-key + anthropic-version
// e (no browser) o opt-in `anthropic-dangerous-direct-browser-access`.
const headers = (cfg: AIConfig): Record<string, string> => {
  if (isAnthropic(cfg)) {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
    };
  }
  return {
    "Content-Type": "application/json",
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
  };
};

function withTimeout(cfg: AIConfig, signal?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), cfg.timeoutMs);
  if (signal) signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        if (i < retries) { await new Promise(r => setTimeout(r, 600 * (i + 1))); continue; }
      }
      return res;
    } catch (e: any) {
      lastErr = e;
      if (e?.name === "AbortError") throw e;
      if (i < retries) { await new Promise(r => setTimeout(r, 500 * (i + 1))); continue; }
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

export async function listModels(cfg: AIConfig): Promise<string[]> {
  const res = await fetch(`${cfg.baseUrl}/models`, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json();
  return (Array.isArray(json?.data) ? json.data : []).map((m: any) => m.id).filter(Boolean);
}

// ============================================================
// Helpers Anthropic — converte do nosso formato unificado.
// ============================================================
function splitSystemAndMessages(msgs: LLMMessage[]): { system: string; rest: LLMMessage[] } {
  const systems = msgs.filter(m => m.role === "system").map(m => m.content).filter(Boolean);
  const rest = msgs.filter(m => m.role !== "system");
  return { system: systems.join("\n\n"), rest };
}

// Converte mensagens unificadas para o formato Anthropic (content blocks).
function toAnthropicMessages(msgs: LLMMessage[]): any[] {
  const out: any[] = [];
  for (const m of msgs) {
    if (m.role === "assistant") {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let input: any = {};
          try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      out.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id!, content: m.content }],
      });
    } else {
      out.push({ role: "user", content: m.content });
    }
  }
  return out;
}

export async function testConnection(cfg: AIConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const models = await listModels(cfg);
    return { ok: true, message: `Conectado. ${models.length} modelo(s) disponível(is).` };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/** Stream simples sem tools. */
export async function* streamChat(
  cfg: AIConfig,
  messages: LLMMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const { signal: s, cancel } = withTimeout(cfg, signal);
  try {
    // Branch: Anthropic usa /v1/messages com formato próprio.
    const anth = isAnthropic(cfg);
    const url = anth ? `${cfg.baseUrl}/messages` : `${cfg.baseUrl}/chat/completions`;
    let body: any;
    if (anth) {
      const { system, rest } = splitSystemAndMessages(messages);
      body = {
        model: cfg.model,
        max_tokens: 4096,
        temperature: cfg.temperature,
        stream: true,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(rest),
      };
    } else {
      body = { model: cfg.model, messages, temperature: cfg.temperature, stream: true };
    }

    const res = await fetchWithRetry(url, {
      method: "POST",
      signal: s,
      headers: headers(cfg),
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const obj = JSON.parse(payload);
          if (anth) {
            // Anthropic SSE: content_block_delta com delta.text.
            if (obj?.type === "content_block_delta" && obj?.delta?.type === "text_delta") {
              const txt = obj.delta.text;
              if (typeof txt === "string" && txt) yield txt;
            } else if (obj?.type === "message_stop") {
              return;
            }
          } else {
            const delta = obj?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) yield delta;
          }
        } catch {}
      }
    }
  } finally {
    cancel();
  }
}

// ============================================================
// Round-trip com TOOLS (não-streaming): loop até finalizar
// ============================================================
export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  result?: string;
}

export interface ToolRoundResult {
  finalText: string;
  toolCalls: ToolCall[];
}

export async function chatWithTools(
  cfg: AIConfig,
  initialMessages: LLMMessage[],
  runTool: (name: string, args: any) => string | Promise<string>,
  opts?: { maxRounds?: number; signal?: AbortSignal; onProgress?: (e: { type: "tool"; call: ToolCall } | { type: "text"; delta: string }) => void },
): Promise<ToolRoundResult> {
  const maxRounds = opts?.maxRounds ?? 5;
  const calls: ToolCall[] = [];
  const messages = initialMessages.slice();
  const anth = isAnthropic(cfg);

  for (let i = 0; i < maxRounds; i++) {
    const { signal: s, cancel } = withTimeout(cfg, opts?.signal);
    let res: Response;
    try {
      const url = anth ? `${cfg.baseUrl}/messages` : `${cfg.baseUrl}/chat/completions`;
      let body: any;
      if (anth) {
        const { system, rest } = splitSystemAndMessages(messages);
        body = {
          model: cfg.model,
          max_tokens: 4096,
          temperature: cfg.temperature,
          stream: false,
          ...(system ? { system } : {}),
          messages: toAnthropicMessages(rest),
          tools: asAnthropicTools(),
        };
      } else {
        body = {
          model: cfg.model,
          messages,
          temperature: cfg.temperature,
          tools: asOpenAITools(),
          tool_choice: "auto",
          stream: false,
        };
      }
      res = await fetchWithRetry(url, {
        method: "POST",
        signal: s,
        headers: headers(cfg),
        body: JSON.stringify(body),
      });
    } finally { cancel(); }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    const json = await res.json();

    if (anth) {
      // Resposta Anthropic: { content: [{type:"text"|"tool_use", ...}], stop_reason }
      const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
      const toolUses = blocks.filter(b => b.type === "tool_use");
      const textOut = blocks.filter(b => b.type === "text").map(b => b.text || "").join("");

      if (toolUses.length > 0) {
        // Reconstroi como tool_calls no nosso formato unificado para o histórico.
        const tcs = toolUses.map(tu => ({
          id: tu.id,
          type: "function" as const,
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) },
        }));
        messages.push({ role: "assistant", content: textOut, tool_calls: tcs });
        for (const tu of toolUses) {
          const result = await runTool(tu.name, tu.input || {});
          const call: ToolCall = { id: tu.id, name: tu.name, arguments: tu.input || {}, result };
          calls.push(call);
          opts?.onProgress?.({ type: "tool", call });
          messages.push({ role: "tool", tool_call_id: tu.id, name: tu.name, content: result });
        }
        continue;
      }

      if (opts?.onProgress) opts.onProgress({ type: "text", delta: textOut });
      return { finalText: textOut, toolCalls: calls };
    }

    // OpenAI-compatível.
    const choice = json?.choices?.[0];
    const msg = choice?.message;
    const toolCalls = msg?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });
      for (const tc of toolCalls) {
        let args: any = {};
        try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
        const result = await runTool(tc.function.name, args);
        const call: ToolCall = { id: tc.id, name: tc.function.name, arguments: args, result };
        calls.push(call);
        opts?.onProgress?.({ type: "tool", call });
        messages.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: result });
      }
      continue;
    }

    const finalText = msg?.content || "";
    if (opts?.onProgress) opts.onProgress({ type: "text", delta: finalText });
    return { finalText, toolCalls: calls };
  }

  // M-6: telemetria — atingir maxRounds geralmente indica loop de tool calling.
  console.warn("[ai/client] maxRounds atingido sem resposta final", {
    rounds: maxRounds,
    calls: calls.map(c => c.name),
  });
  return { finalText: "_(Limite de rodadas de tool-calling atingido sem resposta final.)_", toolCalls: calls };
}
