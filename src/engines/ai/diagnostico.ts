// =====================================================================
// Geração do Diagnóstico Executivo via LLM.
// Reusa o `streamChat` do client.ts (mesma config do chat do consultor).
//
// Output: DiagnosticoExecutivo (JSON estruturado) — NUNCA texto solto.
// =====================================================================

import { streamChat, type LLMMessage } from "./client";
import type { AIConfig } from "./providers";
import type { Briefing } from "@/engines/finance/briefing";
import {
  buildSystemPrompt,
  buildUserPrompt,
  PROMPT_VERSION,
  type DiagnosticoExecutivo,
} from "./diagnosticoPrompt";

/** Detecta se a config tem o mínimo para gerar — usada pra ocultar o card. */
export function isAIConfigured(cfg: AIConfig): boolean {
  // LM Studio é local: precisa apenas de baseUrl + model.
  if (cfg.provider === "lmstudio") return Boolean(cfg.baseUrl && cfg.model);
  // OpenAI / Anthropic: chave + modelo são obrigatórios.
  return Boolean(cfg.apiKey?.trim() && cfg.model);
}

/** Resultado completo da geração — inclui metadados de auditoria CVM. */
export interface DiagnosticoResult {
  data: DiagnosticoExecutivo;
  /** Provider + modelo usados — vai no rodapé do card. */
  modelo: string;
  provider: AIConfig["provider"];
  promptVersion: typeof PROMPT_VERSION;
  geradoEm: string;
}

/**
 * Extrai JSON do texto do modelo, tolerante a:
 * - JSON puro
 * - bloco markdown ```json ... ```
 * - texto antes/depois (pega do primeiro { ao último } balanceado)
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Caso 1: markdown fence
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // segue para próximas estratégias
    }
  }
  // Caso 2: JSON puro
  try {
    return JSON.parse(trimmed);
  } catch {
    // continua
  }
  // Caso 3: do primeiro `{` ao último `}` balanceado
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // cai no throw
    }
  }
  throw new Error("Resposta da IA não contém JSON válido.");
}

/** Valida estrutura mínima do diagnóstico devolvido pela IA. */
function validateDiagnostico(obj: unknown): DiagnosticoExecutivo {
  if (!obj || typeof obj !== "object") throw new Error("Diagnóstico inválido (não é objeto).");
  const o = obj as Record<string, unknown>;
  if (typeof o.veredito !== "string" || !o.veredito.trim())
    throw new Error("Diagnóstico sem 'veredito'.");
  if (typeof o.contexto !== "string") throw new Error("Diagnóstico sem 'contexto'.");
  if (!Array.isArray(o.pontosCriticos)) throw new Error("Diagnóstico sem 'pontosCriticos'.");
  if (!Array.isArray(o.pontosFortes)) throw new Error("Diagnóstico sem 'pontosFortes'.");
  if (!Array.isArray(o.proximosPassos)) throw new Error("Diagnóstico sem 'proximosPassos'.");
  // Normalização defensiva.
  return {
    veredito: o.veredito.trim(),
    contexto: (o.contexto as string).trim(),
    pontosCriticos: (o.pontosCriticos as unknown[]).slice(0, 3).map((p) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      return {
        titulo: String(pp.titulo ?? "").trim(),
        explicacao: String(pp.explicacao ?? "").trim(),
        indicadoresReferenciados: Array.isArray(pp.indicadoresReferenciados)
          ? (pp.indicadoresReferenciados as string[]).filter((x) => typeof x === "string")
          : [],
      } as DiagnosticoExecutivo["pontosCriticos"][number];
    }),
    pontosFortes: (o.pontosFortes as unknown[]).slice(0, 2).map((p) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      return {
        titulo: String(pp.titulo ?? "").trim(),
        explicacao: String(pp.explicacao ?? "").trim(),
      };
    }),
    proximosPassos: (o.proximosPassos as unknown[]).slice(0, 5).map((p) => {
      const pp = (p ?? {}) as Record<string, unknown>;
      const prazo = pp.prazo === "30d" || pp.prazo === "90d" ? pp.prazo : "imediato";
      return {
        acao: String(pp.acao ?? "").trim(),
        impactoEsperado: String(pp.impactoEsperado ?? "").trim(),
        prazo: prazo as "imediato" | "30d" | "90d",
      };
    }),
  };
}

/**
 * Gera o diagnóstico executivo a partir do briefing.
 * Consome o stream do client.ts (acumula texto e parseia ao final).
 */
export async function gerarDiagnostico(
  briefing: Briefing,
  cfg: AIConfig,
  signal?: AbortSignal,
): Promise<DiagnosticoResult> {
  if (!isAIConfigured(cfg)) {
    throw new Error("IA não configurada.");
  }

  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(briefing) },
  ];

  // Acumula o stream — o output esperado é pequeno (<2KB), não há motivo pra UI streamar.
  let raw = "";
  for await (const chunk of streamChat(cfg, messages, signal)) {
    raw += chunk;
  }

  if (!raw.trim()) throw new Error("Resposta vazia da IA.");

  const parsed = extractJson(raw);
  const data = validateDiagnostico(parsed);

  return {
    data,
    modelo: cfg.model,
    provider: cfg.provider,
    promptVersion: PROMPT_VERSION,
    geradoEm: new Date().toISOString(),
  };
}
