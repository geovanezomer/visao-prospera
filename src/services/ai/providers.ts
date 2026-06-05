// Configuração de provedores de IA + threads + system prompt extra.
// 100% client-side, localStorage.

export type Provider = "lmstudio" | "openai";

export interface AIConfig {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  persistKey: boolean;        // se false, chave só vive na sessão
  model: string;
  temperature: number;
  includeSnapshot: boolean;
  useTools: boolean;          // function calling (snapshot lazy)
  extraSystemPrompt: string;  // suplemento do usuário
  timeoutMs: number;
  maxTokensSnapshot: number;  // limite estimado de tokens do snapshot
}

export const PROVIDER_DEFAULTS: Record<Provider, Pick<AIConfig, "baseUrl" | "model">> = {
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" },
  openai:   { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

export const DEFAULT_CONFIG: AIConfig = {
  provider: "lmstudio",
  baseUrl: PROVIDER_DEFAULTS.lmstudio.baseUrl,
  apiKey: "",
  persistKey: true,
  model: PROVIDER_DEFAULTS.lmstudio.model,
  temperature: 0.3,
  includeSnapshot: true,
  useTools: false,
  extraSystemPrompt: "",
  timeoutMs: 120_000,
  maxTokensSnapshot: 6000,
};

const CFG_KEY = "gz-finance-ai-config";
const SESSION_KEY_BAG = "gz-finance-ai-sessionkey";

export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const cfg = { ...DEFAULT_CONFIG, ...parsed } as AIConfig;
    if (!cfg.persistKey) {
      cfg.apiKey = sessionStorage.getItem(SESSION_KEY_BAG) || "";
    }
    return cfg;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: AIConfig) {
  try {
    if (cfg.persistKey) {
      sessionStorage.removeItem(SESSION_KEY_BAG);
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    } else {
      sessionStorage.setItem(SESSION_KEY_BAG, cfg.apiKey || "");
      // grava sem a chave
      localStorage.setItem(CFG_KEY, JSON.stringify({ ...cfg, apiKey: "" }));
    }
  } catch {}
}

export function switchProvider(cfg: AIConfig, provider: Provider): AIConfig {
  const d = PROVIDER_DEFAULTS[provider];
  return { ...cfg, provider, baseUrl: d.baseUrl, model: d.model };
}

// ============================================================
// Threads (várias conversas por empresa)
// ============================================================
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  ts: number;
  toolName?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const THREADS_KEY = (company: string) => `gz-finance-ai-threads-${company || "default"}`;
const MSGS_KEY = (company: string, tid: string) => `gz-finance-ai-chat-${company || "default"}-${tid}`;
const LEGACY_KEY = (company: string) => `gz-finance-ai-chat-${company || "default"}`;

export function loadThreads(company: string): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY(company));
    if (raw) return JSON.parse(raw);
    // migração: chave legada -> thread default
    const legacy = localStorage.getItem(LEGACY_KEY(company));
    if (legacy) {
      const t: ChatThread = { id: "default", title: "Conversa principal", createdAt: Date.now(), updatedAt: Date.now() };
      localStorage.setItem(THREADS_KEY(company), JSON.stringify([t]));
      localStorage.setItem(MSGS_KEY(company, "default"), legacy);
      localStorage.removeItem(LEGACY_KEY(company));
      return [t];
    }
    return [];
  } catch { return []; }
}

export function saveThreads(company: string, threads: ChatThread[]) {
  try { localStorage.setItem(THREADS_KEY(company), JSON.stringify(threads)); } catch {}
}

export function loadMessages(company: string, tid: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY(company, tid));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveMessages(company: string, tid: string, msgs: ChatMessage[]) {
  try { localStorage.setItem(MSGS_KEY(company, tid), JSON.stringify(msgs.slice(-100))); } catch {}
}

export function deleteThread(company: string, tid: string) {
  try {
    localStorage.removeItem(MSGS_KEY(company, tid));
    const ts = loadThreads(company).filter(t => t.id !== tid);
    saveThreads(company, ts);
  } catch {}
}

export function createThread(company: string, title?: string): ChatThread {
  const t: ChatThread = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: title || "Nova conversa",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const all = loadThreads(company);
  all.unshift(t);
  saveThreads(company, all);
  return t;
}

export function renameThread(company: string, tid: string, title: string) {
  const ts = loadThreads(company).map(t => t.id === tid ? { ...t, title, updatedAt: Date.now() } : t);
  saveThreads(company, ts);
}

export function touchThread(company: string, tid: string) {
  const ts = loadThreads(company).map(t => t.id === tid ? { ...t, updatedAt: Date.now() } : t);
  saveThreads(company, ts);
}
