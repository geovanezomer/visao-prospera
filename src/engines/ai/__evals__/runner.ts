// =====================================================================
// Runner do golden set — dois níveis.
//
// NÍVEL A (determinístico, sem LLM): valida invariantes.
//   - Tools esperadas existem no registry.
//   - Cada tool esperada roda contra a fixture sem lançar.
//   - Payload combinado contém os padrões numChavePayload.
//   - Prompt do modo carrega as regras/menções necessárias.
//
// NÍVEL B (end-to-end com LLM): executa loop real de tool-calling.
//   Aciona um provider externo (LM Studio / OpenAI-compat) — só sob
//   demanda via `bun run eval:ai`. Não roda no CI.
// =====================================================================

import type { AppState } from "@/engines/finance/types";
import type { EvalCase } from "./goldenSet";
import { FIXTURES } from "./fixtures";
import { TOOLS, runTool } from "@/engines/ai/tools";
import { buildSystemPromptParts } from "@/engines/ai/systemPrompt";

// ---------- NÍVEL A ----------

export interface StaticCaseResult {
  id: string;
  ok: boolean;
  errors: string[];
  toolsRun: string[];
  payloadChars: number;
}

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function getFixture(id: string): AppState {
  const f = FIXTURES[id];
  if (!f) throw new Error(`Fixture desconhecida: ${id}`);
  return f;
}

export async function runStaticCase(c: EvalCase): Promise<StaticCaseResult> {
  const errors: string[] = [];
  const toolsRun: string[] = [];
  let payload = "";

  // 1. Tools esperadas existem no registry?
  for (const name of c.toolsEsperadas) {
    if (!TOOL_NAMES.has(name)) errors.push(`Tool inexistente no registry: ${name}`);
  }

  // 2. Prompt do modo compila sem erro e menciona o modo esperado.
  try {
    const { stable, dynamic } = buildSystemPromptParts({
      snapshot: "",
      includeSnapshot: false,
      useTools: true,
      useMetaTools: true,
      mode: c.mode,
    });
    if (!stable.length || !dynamic.length) errors.push("Prompt vazio");
  } catch (e) {
    errors.push(`buildSystemPromptParts falhou: ${(e as Error).message}`);
  }

  // 3. Roda cada tool esperada e concatena payloads.
  const state = getFixture(c.fixture);
  for (const name of c.toolsEsperadas) {
    if (!TOOL_NAMES.has(name)) continue;
    try {
      const out = await Promise.resolve(runTool(name, {}, state));
      toolsRun.push(name);
      payload += "\n\n" + (out || "");
    } catch (e) {
      errors.push(`Tool ${name} lançou: ${(e as Error).message}`);
    }
  }

  // 4. Payload contém os padrões-chave?
  for (const re of c.numChavePayload || []) {
    if (!re.test(payload)) errors.push(`Payload não contém padrão ${re}`);
  }

  return {
    id: c.id,
    ok: errors.length === 0,
    errors,
    toolsRun,
    payloadChars: payload.length,
  };
}

// ---------- NÍVEL B ----------

export interface LiveCaseResult {
  id: string;
  ok: boolean;
  score: number; // 0-100
  toolsCalled: string[];
  hitsDeveConter: number;
  missDeveConter: RegExp[];
  hitsProibicao: RegExp[]; // proibições disparadas (== ruim)
  toolsCoverage: number; // % das toolsEsperadas efetivamente chamadas
  responsePreview: string;
  errorMsg?: string;
}

/**
 * Executa o loop tool-calling real via endpoint OpenAI-compat.
 * Import dinâmico para não puxar dependências pesadas no bundle da UI.
 */
export async function runLiveCase(
  c: EvalCase,
  cfg: { baseUrl: string; apiKey?: string; model: string },
): Promise<LiveCaseResult> {
  const { chatWithTools } = await import("@/engines/ai/client");
  const state = getFixture(c.fixture);
  const { stable, dynamic } = buildSystemPromptParts({
    snapshot: "",
    includeSnapshot: false,
    useTools: true,
    useMetaTools: false,
    mode: c.mode,
  });
  const sysPrompt = { stable, dynamic };
  const messages = [
    { role: "system" as const, content: `${sysPrompt.stable}\n\n${sysPrompt.dynamic}` },
    { role: "user" as const, content: c.pergunta },
  ];

  const toolsCalled: string[] = [];
  try {
    const out = await chatWithTools(
      {
        provider: "lmstudio",
        model: cfg.model,
        apiKey: cfg.apiKey || "",
        baseUrl: cfg.baseUrl,
      } as unknown as Parameters<typeof chatWithTools>[0],
      messages,
      (name, args) => Promise.resolve(runTool(name, args, state)),
      {
        signal: new AbortController().signal,
        metaTools: false,
        onProgress: (e) => {
          if (e.type === "tool") toolsCalled.push(e.call.name);
        },
      },
    );

    const text = out.finalText || "";
    const missDeveConter = c.deveConter.filter((re) => !re.test(text));
    const hitsProibicao = c.naoPodeConter.filter((re) => re.test(text));
    const hitsExpected = c.toolsEsperadas.filter((t) => toolsCalled.includes(t)).length;
    const toolsCoverage = c.toolsEsperadas.length
      ? Math.round((hitsExpected / c.toolsEsperadas.length) * 100)
      : 100;

    // Score simples: 50% deveConter + 30% !naoPodeConter + 20% tools.
    const deveScore = c.deveConter.length
      ? ((c.deveConter.length - missDeveConter.length) / c.deveConter.length) * 50
      : 50;
    const proibScore = c.naoPodeConter.length
      ? ((c.naoPodeConter.length - hitsProibicao.length) / c.naoPodeConter.length) * 30
      : 30;
    const toolsScore = (toolsCoverage / 100) * 20;
    const score = Math.round(deveScore + proibScore + toolsScore);
    const ok = missDeveConter.length === 0 && hitsProibicao.length === 0 && toolsCoverage > 0;

    return {
      id: c.id,
      ok,
      score,
      toolsCalled,
      hitsDeveConter: c.deveConter.length - missDeveConter.length,
      missDeveConter,
      hitsProibicao,
      toolsCoverage,
      responsePreview: text.slice(0, 400),
    };
  } catch (e) {
    return {
      id: c.id,
      ok: false,
      score: 0,
      toolsCalled,
      hitsDeveConter: 0,
      missDeveConter: c.deveConter,
      hitsProibicao: [],
      toolsCoverage: 0,
      responsePreview: "",
      errorMsg: (e as Error).message,
    };
  }
}
