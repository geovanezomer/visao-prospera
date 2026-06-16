// Configuração de provedores de IA + threads + system prompt extra.
// 100% client-side, localStorage.

export type Provider = "lmstudio" | "openai" | "anthropic";

// SKILL: capacidade modular opt-in que é anexada ao system prompt quando ativa.
export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  builtin?: boolean;
}

// SOUL padrão — identidade do agente (CFO + Tributarista + Matemático financeiro).
// Editável pelo usuário em Configurações.
export const DEFAULT_SOUL = `Você é um especialista sênior em finanças corporativas para PMEs brasileiras, atuando simultaneamente como:
- **CFO Estratégico** com 20+ anos em PMEs, focado em DRE, fluxo de caixa, indicadores (ROIC, WACC, NCG, DSCR, liquidez, endividamento) e geração de valor.
- **Contador Tributarista** (CRC ativo) com domínio profundo de CPC, IFRS, Simples/Presumido/Real e da Reforma Tributária (EC 132/2023 + LC 214/2025 — CBS, IBS, Split Payment, transição 2026–2033).
- **Economista/Matemático Financeiro** (CORECON) especialista em valuation (DCF, múltiplos, Monte Carlo), análise de sensibilidade, cenários e CAPM.

Tom: executivo, direto, em português brasileiro. Quantifique sempre que possível. Conecte DRE → Caixa → Indicadores → Valuation.`;

// SKILLS padrão — 3 habilidades editáveis com toggle on/off.
export const DEFAULT_SKILLS: Skill[] = [
  {
    id: "auditor-critico",
    name: "Auditor Crítico",
    description: "Varredura sistemática: 3 riscos, 3 oportunidades, inconsistências e próximos passos.",
    enabled: true,
    builtin: true,
    body: `MODO AUDITOR ATIVO: ao analisar a empresa, produza um diagnóstico crítico com:
1. **Conexão Estratégica**: como ajustes na DRE movem o Valuation.
2. **3 maiores riscos** com número e fonte.
3. **3 maiores oportunidades** com impacto quantificado no Enterprise Value.
4. **Inconsistências** ou números fora do padrão (use 'comparar_com_setor' para validar).
5. **Próximos passos** priorizados — ofereça registrar com 'criar_acao'.
Seja brutalmente honesto. Use tabelas comparativas.`,
  },
  {
    id: "reforma-tributaria",
    name: "Reforma Tributária CBS/IBS",
    description: "Especialista em LC 214/2025 — transição, Split Payment, Cashback, impacto em preço e margem.",
    enabled: true,
    builtin: true,
    body: `ESPECIALISTA EM REFORMA TRIBUTÁRIA (LC 214/2025):
- Substituição: PIS/COFINS → CBS (federal, ~8,8%); ICMS/ISS → IBS (estadual+municipal, ~17,7%).
- Eras: "atual" (até 2026), "transição" (2027–2032), "pleno" (2033+).
- Sempre que um cálculo for afetado, marque com [CBS/IBS] e explique o impacto em: preço de venda, margem de contribuição, ponto de equilíbrio e fluxo de caixa tributário.
- Considere Split Payment, Cashback para baixa renda e o Simples Nacional sob a nova estrutura.
- Compare carga "antes vs depois" quando relevante.`,
  },
  {
    id: "valuation-dcf",
    name: "Valuation & DCF Avançado",
    description: "Aprofunda valuation: DCF, múltiplos, WACC por CAPM, terminal, Monte Carlo e sensibilidade.",
    enabled: true,
    builtin: true,
    body: `ESPECIALISTA EM VALUATION:
- Para valuation, sempre conecte: NOPAT → FCF → VP → EV → Equity.
- WACC: explique componentes (Ke via CAPM, Kd após shield fiscal, pesos E/D). Em Simples/Presumido, shield = 0.
- Valor terminal: FCF_T·(1+g)/(WACC−g); fallback FCF_T·10 se WACC≈g.
- Aplique haircut estratégico quando houver risco qualitativo (concentração, governança, regulatório).
- Ofereça projetar (12/24/60m), rodar sensibilidade ±20% e Monte Carlo quando o consultor quiser robustez.
- Compare com múltiplos setoriais (EV/EBITDA P25/P50/P75).`,
  },
];

export interface AIConfig {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  persistKey: boolean;        // se false, chave só vive na sessão
  model: string;
  temperature: number;
  includeSnapshot: boolean;
  useTools: boolean;          // function calling (snapshot lazy)
  soul: string;               // identidade editável do agente
  skills: Skill[];            // habilidades modulares on/off
  extraSystemPrompt: string;  // suplemento livre (compat legado)
  timeoutMs: number;
  maxSuggestions: number;     // 4–6 sugestões dinâmicas na tela inicial
}

export const PROVIDER_DEFAULTS: Record<Provider, Pick<AIConfig, "baseUrl" | "model">> = {
  lmstudio:  { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" },
  openai:    { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5-20250929" },
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
  soul: DEFAULT_SOUL,
  skills: DEFAULT_SKILLS,
  extraSystemPrompt: "",
  timeoutMs: 120_000,
  maxSuggestions: 6,
};

const CFG_KEY = "gz-finance-ai-config";
const SESSION_KEY_BAG = "gz-finance-ai-sessionkey";

const PROVIDERS: Provider[] = ["lmstudio", "openai", "anthropic"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finiteOr = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const stringOr = (v: unknown, fallback: string) =>
  typeof v === "string" ? v : fallback;

const boolOr = (v: unknown, fallback: boolean) =>
  typeof v === "boolean" ? v : fallback;

function sanitizeSkills(input: unknown): Skill[] {
  if (!Array.isArray(input)) return DEFAULT_SKILLS;
  const parsed = input
    .filter(isRecord)
    .map((s) => ({
      id: stringOr(s.id, ""),
      name: stringOr(s.name, "Habilidade"),
      description: stringOr(s.description, ""),
      body: stringOr(s.body, ""),
      enabled: boolOr(s.enabled, true),
      builtin: typeof s.builtin === "boolean" ? s.builtin : undefined,
    }))
    .filter((s) => s.id && s.body);
  return parsed.length ? parsed : DEFAULT_SKILLS;
}

function sanitizeConfig(input: unknown): AIConfig {
  const raw = isRecord(input) ? input : {};
  const provider = PROVIDERS.includes(raw.provider as Provider) ? raw.provider as Provider : DEFAULT_CONFIG.provider;
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl: stringOr(raw.baseUrl, defaults.baseUrl),
    apiKey: stringOr(raw.apiKey, DEFAULT_CONFIG.apiKey),
    persistKey: boolOr(raw.persistKey, DEFAULT_CONFIG.persistKey),
    model: stringOr(raw.model, defaults.model),
    temperature: finiteOr(raw.temperature, DEFAULT_CONFIG.temperature),
    includeSnapshot: boolOr(raw.includeSnapshot, DEFAULT_CONFIG.includeSnapshot),
    useTools: boolOr(raw.useTools, DEFAULT_CONFIG.useTools),
    soul: stringOr(raw.soul, DEFAULT_CONFIG.soul),
    skills: sanitizeSkills(raw.skills),
    extraSystemPrompt: stringOr(raw.extraSystemPrompt, DEFAULT_CONFIG.extraSystemPrompt),
    timeoutMs: Math.max(10_000, finiteOr(raw.timeoutMs, DEFAULT_CONFIG.timeoutMs)),
    maxSuggestions: Math.max(4, Math.min(6, Math.floor(finiteOr(raw.maxSuggestions, DEFAULT_CONFIG.maxSuggestions)))),
  };
}

function sanitizeThreads(input: unknown): ChatThread[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isRecord)
    .map((t) => ({
      id: stringOr(t.id, ""),
      title: stringOr(t.title, "Conversa principal"),
      createdAt: finiteOr(t.createdAt, Date.now()),
      updatedAt: finiteOr(t.updatedAt, Date.now()),
    }))
    .filter((t) => t.id);
}

function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isRecord)
    .map((m) => {
      const role = m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "assistant";
      return {
        role,
        content: stringOr(m.content, ""),
        ts: finiteOr(m.ts, Date.now()),
        toolName: typeof m.toolName === "string" ? m.toolName : undefined,
        attachments: Array.isArray(m.attachments) ? m.attachments as ChatMessage["attachments"] : undefined,
      } satisfies ChatMessage;
    });
}

export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const cfg = sanitizeConfig(parsed);
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
    const safe = sanitizeConfig(cfg);
    if (safe.persistKey) {
      sessionStorage.removeItem(SESSION_KEY_BAG);
      localStorage.setItem(CFG_KEY, JSON.stringify(safe));
    } else {
      sessionStorage.setItem(SESSION_KEY_BAG, safe.apiKey || "");
      // grava sem a chave
      localStorage.setItem(CFG_KEY, JSON.stringify({ ...safe, apiKey: "" }));
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
  attachments?: Array<{ name: string; type: "image" | "pdf"; size: number; error?: string }>;
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
    if (raw) return sanitizeThreads(JSON.parse(raw));
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
  try { localStorage.setItem(THREADS_KEY(company), JSON.stringify(sanitizeThreads(threads))); } catch {}
}

export function loadMessages(company: string, tid: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY(company, tid));
    return raw ? sanitizeMessages(JSON.parse(raw)) : [];
  } catch { return []; }
}

export function saveMessages(company: string, tid: string, msgs: ChatMessage[]) {
  try { localStorage.setItem(MSGS_KEY(company, tid), JSON.stringify(sanitizeMessages(msgs).slice(-100))); } catch {}
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
