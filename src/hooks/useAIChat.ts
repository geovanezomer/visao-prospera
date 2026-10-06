// Hook compartilhado entre AIChatSheet e AIView.
// Orquestra threads, anexos, pipelines e o `send` principal (streaming + tools).
// Hooks especializados ficam em `src/hooks/ai/*`.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AIConfig, ChatMessage, loadConfig, saveConfig, touchThread } from "@/engines/ai/providers";
import { chatWithTools, streamChat, type LLMMessage, type ToolCall } from "@/engines/ai/client";
import { buildSnapshot, getSectionsCached, estimateTokens } from "@/engines/ai/snapshot";
import { buildLlmMessages } from "@/engines/ai/historyUtils";
import { buildSystemPromptParts, type AIMode } from "@/engines/ai/systemPrompt";
import { loadAIMode, saveAIMode } from "@/engines/ai/modeStore";
import { recordChatTrail } from "@/engines/ai/chatTrail";
import { verifyResponse } from "@/engines/ai/verification";
import { useMemories, memoriesToPromptBlock } from "@/engines/memory/store";
import { buildPdfContext, buildVisionMessageContent } from "@/engines/ai/attachments";
import { buildDynamicSuggestions } from "@/engines/ai/suggestions";
import { buildOpeningBriefing } from "@/engines/ai/briefing";
import type { AppState } from "@/engines/finance/types";
import { resolveEffectiveRegime } from "@/engines/finance";
import type { SimulatorParams } from "@/engines/finance/simulator";

import { useChatAttachments } from "./ai/useChatAttachments";
import { useChatThreads } from "./ai/useChatThreads";
import { useChatPipelines } from "./ai/useChatPipelines";

// Limite de tokens do histórico enviado ao LLM (exclui system prompt).
// Se ultrapassado, comprime o miolo preservando contexto inicial + recente.
const MAX_HISTORY_TOKENS = 6000;

export interface UseAIChatParams {
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
  simParams?: SimulatorParams;
}

// Converte um erro de transporte/modelo em markdown amigável.
export function errToMd(e: unknown): string {
  const err = e as { message?: string; name?: string } | undefined;
  const msg = err?.message || String(e);
  if (/timeout/i.test(msg))
    return `**⏱️ Timeout** — o modelo demorou demais. Aumente o timeout em ⚙️.`;
  if (/AbortError/i.test(err?.name || "")) return "_(geração interrompida)_";
  if (/401|403/.test(msg)) return `**🔑 Autenticação falhou** — verifique a API Key em ⚙️.`;
  if (/429/.test(msg)) return `**🚦 Rate limit** — aguarde alguns segundos e tente novamente.`;
  if (/Failed to fetch|NetworkError/i.test(msg))
    return `**🔌 Sem conexão** com o endpoint. LM Studio rodando? URL correta?`;
  return `**Erro:** ${msg}`;
}

export function useAIChat({ state, simulatedState, simActive, simParams }: UseAIChatParams) {
  const [config, setConfig] = useState<AIConfig>(() => loadConfig());
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // === Threads + mensagens (com briefing inicial) ===
  const threadsApi = useChatThreads({
    companyName: state.companyName,
    getBriefingMd: () => buildOpeningBriefing(state, getSectionsCached(state)) || null,
  });
  const {
    threads,
    activeId,
    setActiveId,
    messages,
    setMessages,
    handleNewThread,
    handleDeleteThread,
    reloadThreads,
  } = threadsApi;

  // === Anexos ===
  const attachmentsApi = useChatAttachments();
  const {
    attachments,
    setAttachments,
    removeAttachment,
    processingFile,
    processingMsg,
    handleFiles,
  } = attachmentsApi;

  // === Snapshot (cache por hash) ===
  const simHasChanges = !!simActive && simActive > 0;
  const snapshot = useMemo(() => {
    if (!config.includeSnapshot || config.useTools) return "";
    try {
      getSectionsCached(state, simHasChanges ? simulatedState : undefined);
      return buildSnapshot(state, simHasChanges ? simulatedState : undefined);
    } catch {
      return "";
    }
  }, [state, simulatedState, simHasChanges, config.includeSnapshot, config.useTools]);

  // Contexto runtime: empresa + regime efetivo + cenário simulado ativo.
  const runtimeContext = useMemo(() => {
    // Descreve alavancas simuladas ativas em linguagem natural.
    const describeSim = (): string | undefined => {
      if (!simHasChanges || !simParams) return undefined;
      const p = simParams;
      const parts: string[] = [];
      if (p.priceDeltaPct) parts.push(`preço ${p.priceDeltaPct > 0 ? "+" : ""}${p.priceDeltaPct}%`);
      if (p.volumeDeltaPct)
        parts.push(`volume ${p.volumeDeltaPct > 0 ? "+" : ""}${p.volumeDeltaPct}%`);
      if (p.cpvDeltaPct) parts.push(`CPV ${p.cpvDeltaPct > 0 ? "+" : ""}${p.cpvDeltaPct}%`);
      if (p.payrollDeltaPct)
        parts.push(`folha ${p.payrollDeltaPct > 0 ? "+" : ""}${p.payrollDeltaPct}%`);
      if (p.fixedCutPct)
        parts.push(
          `fixos ${p.fixedCutPct > 0 ? "-" : "+"}${Math.abs(p.fixedCutPct)}% (top ${p.fixedCutTopN})`,
        );

      if (p.pmrDeltaDays) parts.push(`PMR ${p.pmrDeltaDays > 0 ? "+" : ""}${p.pmrDeltaDays}d`);
      if (p.pmpDeltaDays) parts.push(`PMP ${p.pmpDeltaDays > 0 ? "+" : ""}${p.pmpDeltaDays}d`);
      if (p.antecipPctAm) parts.push(`antecipação ${p.antecipPctAm}% a.m.`);
      if (p.loanPrincipal) parts.push(`empréstimo R$${p.loanPrincipal.toLocaleString("pt-BR")}`);
      if (p.debtPaydownPct) parts.push(`quitar ${p.debtPaydownPct}% dívida`);
      if (p.kdDeltaPp) parts.push(`Kd ${p.kdDeltaPp > 0 ? "+" : ""}${p.kdDeltaPp}p.p.`);
      if (p.regimeOverride && p.regimeOverride !== "base")
        parts.push(`regime → ${p.regimeOverride}`);
      return parts.length ? `Simulação ativa (${parts.join(", ")})` : undefined;
    };
    try {
      const eff = resolveEffectiveRegime(state);
      const t = state.tax;
      const nominal = t.regime;
      const base =
        eff !== nominal ? `${eff} (nominal: ${nominal} — downgrade por exceder limite)` : eff;
      const extra =
        eff === "simples"
          ? ` · Anexo ${t.simplesAnexo}, Fator R ${(t.fatorR * 100).toFixed(1)}%`
          : "";
      return {
        companyName: state.companyName,
        regimeLabel: base + extra,
        cenarioAtivo: describeSim(),
      };
    } catch {
      return {
        companyName: state.companyName,
        regimeLabel: state.tax?.regime,
        cenarioAtivo: describeSim(),
      };
    }
  }, [state.companyName, state.tax, simHasChanges, simParams]);

  // Sugestões dinâmicas baseadas no diagnose().
  const suggestions = useMemo(
    () => buildDynamicSuggestions(state, config.maxSuggestions),
    [state, config.maxSuggestions],
  );

  // Memórias persistentes da empresa.
  const memories = useMemories(state.companyName || "default");
  const memoriesBlock = useMemo(() => memoriesToPromptBlock(memories), [memories]);

  // Modo de atuação ativo (chat / cfo / controller / auditor / board / tributarista).
  const [mode, setModeRaw] = useState<AIMode>(() => loadAIMode(state.companyName || "default"));
  useEffect(() => {
    setModeRaw(loadAIMode(state.companyName || "default"));
  }, [state.companyName]);
  const setMode = (m: AIMode) => {
    setModeRaw(m);
    saveAIMode(state.companyName || "default", m);
  };

  const effectiveSkills = config.skills;

  // Retorna { stable, dynamic } para habilitar prompt caching (Anthropic).
  const buildSysPrompt = (overrideMode?: AIMode) =>
    buildSystemPromptParts({
      snapshot,
      includeSnapshot: config.includeSnapshot,
      useTools: config.useTools,
      useMetaTools: config.useMetaTools,
      extra: config.extraSystemPrompt,
      soul: config.soul,
      skills: effectiveSkills,
      mode: overrideMode ?? mode,
      context: runtimeContext,
      memoriesBlock,
    });

  // === Pipelines (360° + Conselho) ===
  const pipelinesApi = useChatPipelines({
    companyName: state.companyName,
    activeId,
    mode,
    config,
    streaming,
    setStreaming,
    messages,
    setMessages,
    input,
    setInput,
    abortRef,
    buildSysPrompt,
    errToMd,
  });

  // === send: caminho principal (streaming simples ou tool-calling) ===
  const send = async (
    text: string,
    opts?: { mode?: AIMode; auditMode?: boolean; replaceLast?: boolean },
  ) => {
    const content = text.trim();
    const effectiveMode: AIMode = opts?.mode ?? (opts?.auditMode ? "auditor" : mode);
    const isReport = effectiveMode === "auditor";
    if ((!content && !isReport && attachments.length === 0) || streaming) return;
    if (!activeId) return;

    const atts = attachments.slice();
    const pdfCtx = buildPdfContext(atts);
    const displayContent =
      content + (pdfCtx ? `\n\n_(📎 ${atts.length} anexo${atts.length > 1 ? "s" : ""})_` : "");

    let history = messages.slice();
    if (opts?.replaceLast) {
      while (history.length && history[history.length - 1].role !== "user") history.pop();
    } else if (content || atts.length) {
      const userMsg: ChatMessage = {
        role: "user",
        content: displayContent,
        ts: Date.now(),
        attachments: atts.map((a) => ({
          name: a.name,
          type: a.type,
          size: a.size,
          error: a.error,
        })),
      } as ChatMessage;
      history = [...history, userMsg];
    }

    setMessages(history);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    touchThread(state.companyName, activeId);

    const sysPrompt = buildSysPrompt(effectiveMode);
    const ac = new AbortController();
    abortRef.current = ac;

    // Audit Trail — captura início do turno.
    const trailStart = Date.now();
    const recordTrail = (
      status: "ok" | "erro" | "abortado",
      responseChars: number,
      tools: string[],
      errorMsg?: string,
    ) => {
      recordChatTrail(state.companyName || "default", {
        threadId: activeId,
        mode: effectiveMode,
        provider: config.provider,
        model: config.model,
        userText: content,
        responseChars,
        tools,
        durationMs: Date.now() - trailStart,
        status,
        errorMsg,
      });
    };

    const fullUserText = content + pdfCtx;
    const hasImages = atts.some((a) => a.type === "image" && a.dataUrl && !a.error);
    const lastUserContent = hasImages
      ? buildVisionMessageContent(fullUserText, atts)
      : fullUserText;

    const buildLlmHistory = (forTools: boolean): LLMMessage[] => {
      const full = buildLlmMessages({
        systemPrompt: sysPrompt,
        history,
        forTools,
        lastUserContent,
      });
      let sysCount = 0;
      while (sysCount < full.length && full[sysCount].role === "system") sysCount++;
      const sys = full.slice(0, sysCount);
      const rest = full.slice(sysCount);

      // Soma tokens só do conteúdo textual (strings); parts vision não contam aqui.
      const tokens = rest.reduce((acc, m) => {
        const c = m.content;
        return acc + (typeof c === "string" ? estimateTokens(c) : 0);
      }, 0);

      if (tokens <= MAX_HISTORY_TOKENS || rest.length <= 8) return full;

      // Preserva 2 primeiras + 6 últimas; substitui o miolo por marcador.
      const head = rest.slice(0, 2);
      const tail = rest.slice(-6);
      const omitted: LLMMessage = {
        role: "assistant",
        content: "_(histórico anterior omitido para economizar contexto)_",
      };
      return [...sys, ...head, omitted, ...tail];
    };

    // === Caminho 1: TOOL CALLING ===
    if (config.useTools) {
      const llm = buildLlmHistory(true);
      const collected: ToolCall[] = [];
      try {
        const { runTool } = await import("@/engines/ai/tools");
        const out = await chatWithTools(
          config,
          llm,
          (name, args) =>
            runTool(name, args, state, simHasChanges ? simulatedState : undefined, simParams),
          {
            signal: ac.signal,
            metaTools: config.useMetaTools,
            onProgress: (e) => {
              if (e.type === "tool") {
                collected.push(e.call);
                if (e.call.name === "criar_acao")
                  toast.success("Ação adicionada ao plano", {
                    description: "Painel de ações atualizado.",
                  });
                else if (e.call.name === "salvar_cenario")
                  toast.success("Cenário salvo", {
                    description: "Disponível no menu de cenários.",
                  });
                else if (e.call.name === "atualizar_acao") toast.success("Ação atualizada");
                else if (e.call.name === "excluir_acao") toast.success("Ação removida");
                else if (e.call.name === "excluir_cenario") toast.success("Cenário removido");
                setMessages([
                  ...history,
                  ...collected.map((c) => ({
                    role: "tool" as const,
                    content: c.result ?? "",
                    toolName: c.name,
                    ts: Date.now(),
                  })),
                ]);
              }
            },
          },
        );
        // Resposta Auditável — verifica cifras da resposta final contra os
        // payloads das tools deste turno. Anota, não altera a resposta.
        const verification = verifyResponse(
          out.finalText,
          collected.map((c) => c.result ?? ""),
        );
        setMessages([
          ...history,
          ...collected.map((c) => ({
            role: "tool" as const,
            content: c.result ?? "",
            toolName: c.name,
            ts: Date.now(),
          })),
          { role: "assistant", content: out.finalText, ts: Date.now(), verification },
        ]);
        recordTrail(
          "ok",
          out.finalText.length,
          collected.map((c) => c.name),
        );
      } catch (e: unknown) {
        const msg = errToMd(e);
        setMessages([...history, { role: "assistant", content: msg, ts: Date.now() }]);
        const aborted = ac.signal.aborted;
        recordTrail(
          aborted ? "abortado" : "erro",
          0,
          collected.map((c) => c.name),
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
      return;
    }

    // === Caminho 2: STREAMING simples ===
    const llm = buildLlmHistory(false);
    let acc = "";
    setMessages([...history, { role: "assistant", content: "", ts: Date.now() }]);
    try {
      for await (const delta of streamChat(config, llm, ac.signal)) {
        acc += delta;
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
          return copy;
        });
      }
      recordTrail("ok", acc.length, []);
    } catch (e: unknown) {
      setMessages((prev) => {
        const copy = prev.slice();
        copy[copy.length - 1] = {
          role: "assistant",
          content: (acc ? acc + "\n\n" : "") + errToMd(e),
          ts: Date.now(),
        };
        return copy;
      });
      const aborted = ac.signal.aborted;
      recordTrail(
        aborted ? "abortado" : "erro",
        acc.length,
        [],
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const handleRegenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.content, { replaceLast: true });
  };

  const handleEditLast = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      const idx = messages.lastIndexOf(lastUser);
      setMessages(messages.slice(0, idx));
    }
  };

  const handleAudit = () =>
    void send("Faça uma análise completa estilo auditor.", { mode: "auditor" });

  // Atualiza config + persiste.
  const updateConfig = (c: AIConfig) => {
    setConfig(c);
    saveConfig(c);
  };

  return {
    // estado
    config,
    updateConfig,
    messages,
    setMessages,
    input,
    setInput,
    streaming,
    attachments,
    removeAttachment,
    processingFile,
    processingMsg,
    threads,
    activeId,
    setActiveId,
    snapshot,
    suggestions,
    simHasChanges,
    mode,
    setMode,
    // ações
    send,
    handleFiles,
    handleStop,
    handleRegenerate,
    handleEditLast,
    handleAudit,
    runPipeline360: pipelinesApi.runPipeline360,
    resumePipeline360: pipelinesApi.resumePipeline360,
    runConcilio: pipelinesApi.runConcilio,
    resetPipeline360: pipelinesApi.resetPipeline360,
    pipeline360: pipelinesApi.pipeline360,
    handleNewThread,
    handleDeleteThread,
    reloadThreads,
  };
}
