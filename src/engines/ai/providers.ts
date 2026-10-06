// Configuração de provedores de IA + threads + system prompt extra.
// 100% client-side: localStorage (sync) + IndexedDB (durável) via persistence.ts.

import { removeKey, saveKeySync } from "@/engines/finance/persistence";

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

// SOUL padrão — identidade do agente "Finn" (CFO virtual PME Brasil).
// Editável pelo usuário em Configurações.
export const DEFAULT_SOUL = `# SOUL — Finn, CFO Virtual PME Brasil

## IDENTIDADE

Você é o **Finn**, CFO virtual sênior especializado em PMEs brasileiras.
Atua simultaneamente como:
- **CFO Estratégico** — DRE, fluxo de caixa, ROIC, WACC, NCG, DSCR, valuation.
- **Contador Tributarista** — CPC/IFRS, Simples/Presumido/Real, LC 214/2025 (CBS/IBS, Split Payment, eras 2026–2033).
- **Matemático Financeiro** — DCF, CAPM, Monte Carlo, sensibilidade, cenários.

**Tom:** executivo, direto, PT-BR. Sem abertura cerimonial. Verbo no imperativo.
**Narrativa obrigatória:** conecte sempre DRE → Caixa → Indicadores → Valuation.
**Honestidade:** se ROIC < WACC, diga "destrói valor". Nunca suavize.

## REGRAS INVIOLÁVEIS

1. **Nunca calcule de cabeça** — todo número vem de tool. Se não tem tool, diga "não disponível" e indique qual chamar.
2. **Toda recomendação tem 3 números:** valor atual · meta · impacto (Δ R$ ou Δ pp). Sem isso é opinião, não recomendação.
3. **Causalidade exige 2 fontes** — antes de afirmar "EBITDA caiu PORQUE X", valide com pelo menos 2 tools e cite ambas.
4. **Hipóteses são marcadas** — se assumir algo não confirmado, escreva **Hipótese:** antes da afirmação.
5. **Dados atuais vencem memória** — se houver divergência entre memória persistente e tool, os dados da tool prevalecem. Sinalize a divergência.

## MODOS DE RESPOSTA

O consultor escolhe o modo no seletor. Cada um muda sua postura:

| Modo | Postura |
|---|---|
| **Chat** | Conversacional. Explica conceitos. Perguntas de esclarecimento quando ambíguo. |
| **CFO Estratégico** | Visão de longo prazo. Alavancas de valor e capital. |
| **Controller** | Foco em variações, conciliações e qualidade do dado. |
| **Conselho (Board)** | Memorando de conselho: tese em 1 frase → evidência → decisão. |
| **Auditor (relatório)** | Diagnóstico completo: 3 riscos + 3 oportunidades + inconsistências + plano de ação. Tabelas comparativas. Máximo 2 gráficos. |
| **Tributarista** | Especialista em regime, CBS/IBS e Reforma. Sempre compare carga antes × depois. |
| **Contador** | Rotinas: folha, rescisão, férias, pró-labore, encargos, lançamentos. |

> Se a pergunta pedir claramente outro modo, responda no modo atual e finalize com:
> "💡 Para [formato X], troque para o Modo [Y] no seletor."

## TOOLS — QUANDO CHAMAR CADA UMA

**Regra de ouro:** chame sempre a tool mais específica. Nunca puxe dados que não vai usar.

| Situação | Tool |
|---|---|
| Início de qualquer análise | \`get_resumo_executivo\` (8 KPIs, <500 tokens) |
| Pontos críticos/alertas | \`get_alertas_criticos\` |
| Análise 360° completa | \`get_tudo\` (só se pedido explicitamente) |
| DRE / resultado | \`get_dre\` |
| Fluxo de caixa | \`get_fluxo_caixa\` |
| Balanço + estrutura de capital | \`get_capital\` ou \`get_pagina_capital\` |
| Dívida, contratos, covenants | \`get_contratos_divida\` |
| Receitas e inadimplência | \`get_receitas\` |
| Despesas e folha | \`get_despesas\` |
| Regime tributário ativo | \`get_regime_tributario\` |
| 38 KPIs + benchmark setorial | \`get_indicadores\` |
| Score de saúde financeira | \`get_saude_financeira\` |
| Riscos estratégicos e concentração | \`get_estrategico\` |
| Cards prescritivos prontos | \`get_prescritivo\` |
| Drill-down do WACC | \`get_wacc\` |
| Diagnóstico narrativo completo | \`get_diagnostico\` |
| Projeção 12/24/36/60m | \`projetar\` |
| Sensibilidade ±20% | \`sensibilidade\` |
| Simulação de alavanca ("e se...") | \`simular_alavanca\` |
| Comparar com setor | \`comparar_com_setor\` |
| Regime tributário ideal | \`simular_regime_tributario\` |
| Carga CBS/IBS por ano 2026–2033 | \`simular_transicao_reforma\` |
| Impacto Split Payment no caixa | \`simular_split_payment\` |
| Carga por era (atual/transição/pleno) | \`get_eras_reforma\` |
| Selic, IPCA, câmbio, CDI | \`get_macro\` ou \`get_serie_macro\` |
| Salvar/carregar cenário | \`salvar_cenario\` / \`carregar_cenario\` |
| Plano de ação | \`listar_acoes\` / \`criar_acao\` / \`atualizar_acao\` |
| Obrigações fiscais | \`checklist_compliance\` |
| Memória persistente | \`salvar_conclusao_importante\` / \`listar_memorias\` / \`excluir_memoria\` |

## SKILLS — CAPACIDADES MODULARES

Skills são capacidades adicionais ativadas pelo consultor no painel.
Quando um Skill está ativo, incorpore seu comportamento à resposta
sem anunciar que está usando — apenas execute.`;

// SKILLS padrão — 3 habilidades editáveis com toggle on/off.
export const DEFAULT_SKILLS: Skill[] = [
  {
    id: "auditor-critico",
    name: "Auditor Crítico",
    description:
      "Varredura sistemática: 3 riscos, 3 oportunidades, inconsistências e próximos passos.",
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
    description:
      "Especialista em LC 214/2025 — transição, Split Payment, Cashback, impacto em preço e margem.",
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
    description:
      "Aprofunda valuation: DCF, múltiplos, WACC por CAPM, terminal, Monte Carlo e sensibilidade.",
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
  {
    id: "cfo-estrategico",
    name: "CFO Estratégico",
    description:
      "Postura de CFO sênior: aloca capital, conecta ROIC×WACC e traduz decisão em Δ EBITDA, Δ FCF e Δ EV.",
    enabled: true,
    builtin: true,
    body: `MODO CFO ESTRATÉGICO ATIVO: atue como CFO sênior reportando ao sócio-controlador.
- Priorize criação/destruição de valor (ROIC vs WACC), alocação de capital e alavancas de Enterprise Value (EV).
- Conecte sempre 3 horizontes: hoje (KPIs atuais) · 12m (projeção/sensibilidade) · 36–60m (valuation/terminal).
- Toda recomendação cita impacto em: EBITDA (R$), FCF (R$) e EV (R$, não só pp). Use 'simular_alavanca' e 'get_valuation' antes de afirmar impacto.
- Diagnostique capital de giro estrutural (NCG, ciclo financeiro) e cobertura de juros (DSCR) antes de propor crescimento.
- Encerre com 1 frase de tese ("O caminho é X porque Y, com impacto Z em EV").`,
  },
];

export interface AIConfigPremium {
  provider: Provider;
  /** Modelo obrigatório para ativar o premium. Sem isso, fallback silencioso. */
  model: string;
  /** Se omitido, herda `apiKey` da config base. */
  apiKey?: string;
  /** Se omitido, herda `baseUrl` da config base. */
  baseUrl?: string;
}

export interface AIConfig {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  persistKey: boolean; // se false, chave só vive na sessão
  model: string;
  temperature: number;
  includeSnapshot: boolean;
  useTools: boolean; // function calling (snapshot lazy)
  useMetaTools: boolean; // tool deferral: expõe apenas tool_search/tool_invoke
  soul: string; // identidade editável do agente
  skills: Skill[]; // habilidades modulares on/off
  extraSystemPrompt: string; // suplemento livre (compat legado)
  timeoutMs: number;
  maxSuggestions: number; // 4–6 sugestões dinâmicas na tela inicial
  /** Config opcional para tarefas nobres (diagnóstico, 360°, relatório).
   *  Ausente = todas as tarefas usam a config principal. */
  premium?: AIConfigPremium;
}

/** Tarefas roteáveis. Chat e tools continuam sempre na config base. */
export type AITask = "chat" | "tools" | "diagnostico" | "pipeline360" | "relatorio";

const PREMIUM_TASKS: ReadonlySet<AITask> = new Set(["diagnostico", "pipeline360", "relatorio"]);

/** Providers que exigem apiKey para funcionar (LM Studio é local). */
const providerRequiresKey = (p: Provider): boolean => p !== "lmstudio";

/**
 * Resolve a config efetiva para uma tarefa. Nunca lança.
 * - Tarefas não-premium retornam a config base sem alterações.
 * - Se `premium` estiver ausente ou inválido, cai silenciosamente para a base
 *   e sinaliza via `usedFallback` para telemetria/UI.
 */
export function resolveConfigForTask(
  cfg: AIConfig,
  task: AITask,
): { config: AIConfig; usedPremium: boolean; usedFallback: boolean } {
  if (!PREMIUM_TASKS.has(task)) {
    return { config: cfg, usedPremium: false, usedFallback: false };
  }
  const p = cfg.premium;
  if (!p || !p.model?.trim()) {
    // premium ausente/incompleto — cai na base sem alarde
    return { config: cfg, usedPremium: false, usedFallback: !!p };
  }
  const apiKey = p.apiKey ?? cfg.apiKey;
  if (providerRequiresKey(p.provider) && !apiKey) {
    return { config: cfg, usedPremium: false, usedFallback: true };
  }
  const merged: AIConfig = {
    ...cfg,
    provider: p.provider,
    model: p.model,
    apiKey,
    baseUrl: p.baseUrl ?? cfg.baseUrl,
  };
  return { config: merged, usedPremium: true, usedFallback: false };
}

export const PROVIDER_DEFAULTS: Record<Provider, Pick<AIConfig, "baseUrl" | "model">> = {
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5-20250929" },
};

export const DEFAULT_CONFIG: AIConfig = {
  provider: "anthropic",
  baseUrl: PROVIDER_DEFAULTS.anthropic.baseUrl,
  apiKey: "",
  persistKey: true,
  model: PROVIDER_DEFAULTS.anthropic.model,
  temperature: 0.3,
  includeSnapshot: true,
  useTools: true,
  useMetaTools: true,
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

const stringOr = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

const boolOr = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

// Versão da identidade/skills padrão. Bump para forçar migração no localStorage
// dos usuários que ainda têm o SOUL/SKILLS antigos persistidos.
const SOUL_DEFAULTS_VERSION = 3;

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

// Garante que todas as skills builtin padrão estejam presentes (merge por id).
// Skills builtin desatualizadas são substituídas pelo corpo atual; custom são mantidas.
function mergeBuiltinSkills(existing: Skill[]): Skill[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const def of DEFAULT_SKILLS) {
    const prev = byId.get(def.id);
    byId.set(def.id, {
      ...def,
      enabled: prev?.enabled ?? def.enabled,
    });
  }
  return Array.from(byId.values());
}

function sanitizeConfig(input: unknown): AIConfig {
  const raw = isRecord(input) ? input : {};
  const provider = PROVIDERS.includes(raw.provider as Provider)
    ? (raw.provider as Provider)
    : DEFAULT_CONFIG.provider;
  const defaults = PROVIDER_DEFAULTS[provider];
  const savedVersion = typeof raw.soulVersion === "number" ? raw.soulVersion : 0;
  const needsMigration = savedVersion < SOUL_DEFAULTS_VERSION;
  // Migração: força SOUL atual e mescla skills builtin novas/atualizadas.
  const soul = needsMigration ? DEFAULT_SOUL : stringOr(raw.soul, DEFAULT_CONFIG.soul);
  const skills = needsMigration
    ? mergeBuiltinSkills(sanitizeSkills(raw.skills))
    : sanitizeSkills(raw.skills);
  return {
    provider,
    baseUrl: stringOr(raw.baseUrl, defaults.baseUrl),
    apiKey: stringOr(raw.apiKey, DEFAULT_CONFIG.apiKey),
    persistKey: boolOr(raw.persistKey, DEFAULT_CONFIG.persistKey),
    model: stringOr(raw.model, defaults.model),
    temperature: finiteOr(raw.temperature, DEFAULT_CONFIG.temperature),
    includeSnapshot: boolOr(raw.includeSnapshot, DEFAULT_CONFIG.includeSnapshot),
    useTools: needsMigration ? true : boolOr(raw.useTools, DEFAULT_CONFIG.useTools),
    useMetaTools: boolOr(raw.useMetaTools, DEFAULT_CONFIG.useMetaTools),
    soul,
    skills,
    extraSystemPrompt: stringOr(raw.extraSystemPrompt, DEFAULT_CONFIG.extraSystemPrompt),
    timeoutMs: Math.max(10_000, finiteOr(raw.timeoutMs, DEFAULT_CONFIG.timeoutMs)),
    maxSuggestions: Math.max(
      4,
      Math.min(6, Math.floor(finiteOr(raw.maxSuggestions, DEFAULT_CONFIG.maxSuggestions))),
    ),
    premium: sanitizePremium(raw.premium),
  };
}

/** Aceita apenas premium com `model` não-vazio; caso contrário retorna undefined. */
function sanitizePremium(input: unknown): AIConfigPremium | undefined {
  if (!isRecord(input)) return undefined;
  const provider = PROVIDERS.includes(input.provider as Provider)
    ? (input.provider as Provider)
    : undefined;
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!provider || !model) return undefined;
  const out: AIConfigPremium = { provider, model };
  if (typeof input.apiKey === "string" && input.apiKey) out.apiKey = input.apiKey;
  if (typeof input.baseUrl === "string" && input.baseUrl) out.baseUrl = input.baseUrl;
  return out;
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
  return input.filter(isRecord).map((m) => {
    const role =
      m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "assistant";
    return {
      role,
      content: stringOr(m.content, ""),
      ts: finiteOr(m.ts, Date.now()),
      toolName: typeof m.toolName === "string" ? m.toolName : undefined,
      attachments: Array.isArray(m.attachments)
        ? (m.attachments as ChatMessage["attachments"])
        : undefined,
      verification: isRecord(m.verification)
        ? (m.verification as unknown as ChatMessage["verification"])
        : undefined,
    } satisfies ChatMessage;
  });
}

export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const savedVersion =
      isRecord(parsed) && typeof parsed.soulVersion === "number" ? parsed.soulVersion : 0;
    const cfg = sanitizeConfig(parsed);
    if (!cfg.persistKey) {
      cfg.apiKey = sessionStorage.getItem(SESSION_KEY_BAG) || "";
      const premKey = sessionStorage.getItem(SESSION_KEY_BAG + "-premium") || "";
      if (cfg.premium && premKey) cfg.premium = { ...cfg.premium, apiKey: premKey };
    }
    // Persiste a migração para que o usuário enxergue o SOUL/Skills novos
    // mesmo sem editar nada nas configurações.
    if (raw && savedVersion < SOUL_DEFAULTS_VERSION) {
      try {
        const persisted = { ...cfg, soulVersion: SOUL_DEFAULTS_VERSION };
        const toStore = cfg.persistKey ? persisted : { ...persisted, apiKey: "" };
        saveKeySync(CFG_KEY, toStore);
      } catch {
        // ignora falha de storage
      }
    }
    return cfg;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Nome do evento custom emitido após saveConfig — ouvido por hooks reativos. */
export const AI_CONFIG_CHANGED_EVENT = "ai-config-changed";

export function saveConfig(cfg: AIConfig) {
  try {
    const safe = sanitizeConfig(cfg);
    // Marca a versão dos defaults atualmente em uso para evitar migrar de novo.
    const persisted = { ...safe, soulVersion: SOUL_DEFAULTS_VERSION };
    if (safe.persistKey) {
      sessionStorage.removeItem(SESSION_KEY_BAG);
      sessionStorage.removeItem(SESSION_KEY_BAG + "-premium");
      saveKeySync(CFG_KEY, persisted);
    } else {
      // Espelha o comportamento da chave principal: quando persistKey=false,
      // também mantém a chave premium fora do storage durável.
      sessionStorage.setItem(SESSION_KEY_BAG, safe.apiKey || "");
      const premiumKey = safe.premium?.apiKey || "";
      if (premiumKey) sessionStorage.setItem(SESSION_KEY_BAG + "-premium", premiumKey);
      else sessionStorage.removeItem(SESSION_KEY_BAG + "-premium");
      const strippedPremium = safe.premium ? { ...safe.premium, apiKey: undefined } : undefined;
      saveKeySync(CFG_KEY, { ...persisted, apiKey: "", premium: strippedPremium });
    }
  } catch {
    // storage indisponível (modo privado / quota) — config segue só em memória
  }

  // Notifica listeners NA MESMA ABA (storage event só dispara entre abas).
  try {
    window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED_EVENT));
  } catch {
    // ambientes sem window (SSR) — ignora
  }
}

export function resetAIStorage() {
  try {
    sessionStorage.removeItem(SESSION_KEY_BAG);
    sessionStorage.removeItem(SESSION_KEY_BAG + "-premium");
    const prefixes = [CFG_KEY, "gz-finance-ai-threads-", "gz-finance-ai-chat-"];
    // Itera localStorage (espelho sync) e remove em ambas as camadas via removeKey.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
        removeKey(key);
      }
    }
  } catch {
    // storage indisponível — reset best-effort
  }
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
  /** Resposta Auditável — verificação determinística dos números citados. */
  verification?: import("./verification").VerificationResult;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const THREADS_KEY = (company: string) => `gz-finance-ai-threads-${company || "default"}`;
const MSGS_KEY = (company: string, tid: string) =>
  `gz-finance-ai-chat-${company || "default"}-${tid}`;
const LEGACY_KEY = (company: string) => `gz-finance-ai-chat-${company || "default"}`;

export function loadThreads(company: string): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY(company));
    if (raw) return sanitizeThreads(JSON.parse(raw));
    // migração: chave legada -> thread default
    const legacy = localStorage.getItem(LEGACY_KEY(company));
    if (legacy) {
      const t: ChatThread = {
        id: "default",
        title: "Conversa principal",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveKeySync(THREADS_KEY(company), [t]);
      // legacy é string crua, não JSON; preserva como veio para não corromper.
      try {
        saveKeySync(MSGS_KEY(company, "default"), JSON.parse(legacy));
      } catch {
        // legacy malformado — descarta
      }
      removeKey(LEGACY_KEY(company));
      return [t];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveThreads(company: string, threads: ChatThread[]) {
  try {
    saveKeySync(THREADS_KEY(company), sanitizeThreads(threads));
  } catch {
    // storage indisponível — threads não persistem nesta sessão
  }
}

export function loadMessages(company: string, tid: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY(company, tid));
    return raw ? sanitizeMessages(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveMessages(company: string, tid: string, msgs: ChatMessage[]) {
  try {
    saveKeySync(MSGS_KEY(company, tid), sanitizeMessages(msgs).slice(-100));
  } catch {
    // storage indisponível — mensagens não persistem nesta sessão
  }
}

export function deleteThread(company: string, tid: string) {
  try {
    removeKey(MSGS_KEY(company, tid));
    const ts = loadThreads(company).filter((t) => t.id !== tid);
    saveThreads(company, ts);
  } catch {
    // storage indisponível — exclusão best-effort
  }
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
  const ts = loadThreads(company).map((t) =>
    t.id === tid ? { ...t, title, updatedAt: Date.now() } : t,
  );
  saveThreads(company, ts);
}

export function touchThread(company: string, tid: string) {
  const ts = loadThreads(company).map((t) => (t.id === tid ? { ...t, updatedAt: Date.now() } : t));
  saveThreads(company, ts);
}
