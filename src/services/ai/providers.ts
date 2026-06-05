// Configuração de provedores de IA (LM Studio local OU OpenAI).
// Ambos usam a mesma API OpenAI-compatible (/chat/completions com SSE).
// Persistido em localStorage — uso local Docker, conforme escolhido.

export type Provider = "lmstudio" | "openai";

export interface AIConfig {
  provider: Provider;
  baseUrl: string;
  apiKey: string;        // vazio em LM Studio
  model: string;
  temperature: number;
  includeSnapshot: boolean;
}

export const PROVIDER_DEFAULTS: Record<Provider, Pick<AIConfig, "baseUrl" | "model">> = {
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" },
  openai:   { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

export const DEFAULT_CONFIG: AIConfig = {
  provider: "lmstudio",
  baseUrl: PROVIDER_DEFAULTS.lmstudio.baseUrl,
  apiKey: "",
  model: PROVIDER_DEFAULTS.lmstudio.model,
  temperature: 0.3,
  includeSnapshot: true,
};

const CFG_KEY = "gz-finance-ai-config";

export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: AIConfig) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
}

export function switchProvider(cfg: AIConfig, provider: Provider): AIConfig {
  const d = PROVIDER_DEFAULTS[provider];
  return { ...cfg, provider, baseUrl: d.baseUrl, model: d.model };
}

// ===== Histórico de chat por empresa =====
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

const HIST_KEY = (company: string) => `gz-finance-ai-chat-${company || "default"}`;

export function loadHistory(company: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HIST_KEY(company));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveHistory(company: string, msgs: ChatMessage[]) {
  try {
    localStorage.setItem(HIST_KEY(company), JSON.stringify(msgs.slice(-50)));
  } catch {}
}

export function clearHistory(company: string) {
  try { localStorage.removeItem(HIST_KEY(company)); } catch {}
}
