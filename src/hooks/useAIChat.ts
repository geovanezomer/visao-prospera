// Hook compartilhado entre AIChatSheet e AIView.
// Centraliza toda a lógica de chat (threads, streaming, tool-calling, anexos)
// para eliminar duplicação. Os componentes ficam apenas com JSX.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AIConfig,
  ChatMessage,
  ChatThread,
  createThread,
  deleteThread,
  loadConfig,
  loadMessages,
  loadThreads,
  saveConfig,
  saveMessages,
  saveThreads,
  touchThread,
} from "@/engines/ai/providers";
import { chatWithTools, streamChat, type LLMMessage, type ToolCall } from "@/engines/ai/client";
import { buildSnapshot, getSectionsCached } from "@/engines/ai/snapshot";
import { buildLlmMessages } from "@/engines/ai/historyUtils";
import { estimateTokens } from "@/engines/ai/snapshot";

// Limite de tokens do histórico enviado ao LLM (exclui system prompt).
// Se ultrapassado, comprime o miolo preservando contexto inicial + recente.
const MAX_HISTORY_TOKENS = 6000;
import { buildSystemPrompt, type AIMode } from "@/engines/ai/systemPrompt";
import { loadAIMode, saveAIMode } from "@/engines/ai/modeStore";
import { recordChatTrail } from "@/engines/ai/chatTrail";
import {
  loadPipeline360,
  savePipeline360,
  clearPipeline360,
} from "@/engines/ai/pipeline360Store";
import { useMemories, memoriesToPromptBlock } from "@/engines/memory/store";
import {
  processFile,
  buildPdfContext,
  buildVisionMessageContent,
  confidenceLabel,
  MAX_FILES_PER_MSG,
  type ChatAttachment,
} from "@/engines/ai/attachments";
import { buildDynamicSuggestions } from "@/engines/ai/suggestions";
import { buildOpeningBriefing } from "@/engines/ai/briefing";
import type { AppState } from "@/engines/finance/types";
import { resolveEffectiveRegime } from "@/engines/finance";
import type { SimulatorParams } from "@/engines/finance/simulator";

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
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads(state.companyName));
  const [activeId, setActiveId] = useState<string>(() => {
    const ts = loadThreads(state.companyName);
    return ts[0]?.id ?? "";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [processingFile, setProcessingFile] = useState(false);
  const [processingMsg, setProcessingMsg] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // Injeta briefing inicial estilo CFO em conversa nova/vazia.
  const injectBriefingIfEmpty = (
    companyName: string,
    threadId: string,
    currentMsgs: ChatMessage[],
  ) => {
    if (currentMsgs.length > 0) return currentMsgs;
    // M-3: passa as seções já cacheadas para evitar recalcular DRE/indicadores/health/diagnose.
    const md = buildOpeningBriefing(state, getSectionsCached(state));
    if (!md) return currentMsgs;
    const briefingMsg: ChatMessage = { role: "assistant", content: md, ts: Date.now() };
    const next = [briefingMsg];
    saveMessages(companyName, threadId, next);
    return next;
  };

  // === Bootstrap por empresa ===
  useEffect(() => {
    const ts = loadThreads(state.companyName);
    if (ts.length === 0) {
      const t = createThread(state.companyName, "Conversa principal");
      setThreads([t]);
      setActiveId(t.id);
      setMessages(injectBriefingIfEmpty(state.companyName, t.id, []));
    } else {
      setThreads(ts);
      const cur = ts.find((t) => t.id === activeId) ?? ts[0];
      setActiveId(cur.id);
      const loaded = loadMessages(state.companyName, cur.id);
      setMessages(injectBriefingIfEmpty(state.companyName, cur.id, loaded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.companyName]);

  // === Carrega msgs ao trocar thread ===
  useEffect(() => {
    if (activeId) {
      const loaded = loadMessages(state.companyName, activeId);
      setMessages(injectBriefingIfEmpty(state.companyName, activeId, loaded));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, state.companyName]);

  // === Persiste msgs ===
  // Não salva array vazio: no primeiro render o efeito dispara antes do bootstrap
  // carregar as mensagens do storage, e gravar [] apagaria o histórico salvo.
  // Threads novas usam id distinto, então não há risco de "ficar preso" com msgs antigas.
  useEffect(() => {
    if (activeId && messages.length > 0) saveMessages(state.companyName, activeId, messages);
  }, [messages, state.companyName, activeId]);

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

  // Contexto runtime: empresa + regime efetivo (com downgrade Simples→Presumido) + cenário simulado ativo.
  const runtimeContext = useMemo(() => {
    // Descreve as alavancas simuladas ativas em linguagem natural (ex: "fixos -20%, PMR -5d").
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
      if (p.outsourcePctCpv) parts.push(`terceirizar ${p.outsourcePctCpv}% CPV`);
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

  // Memórias persistentes da empresa — injetadas no system prompt.
  const memories = useMemories(state.companyName || "default");
  const memoriesBlock = useMemo(() => memoriesToPromptBlock(memories), [memories]);

  // Modo de atuação ativo (chat / cfo / controller / auditor / board).
  // Persistido por empresa em localStorage — restaurado ao recarregar.
  const [mode, setModeRaw] = useState<AIMode>(() => loadAIMode(state.companyName || "default"));

  // Ao trocar de empresa, recarrega o modo persistido daquela empresa.
  useEffect(() => {
    setModeRaw(loadAIMode(state.companyName || "default"));
  }, [state.companyName]);

  const setMode = (m: AIMode) => {
    setModeRaw(m);
    saveAIMode(state.companyName || "default", m);
  };

  // Skills habilitadas — a IA decide qual aplicar; sem seleção manual no chat.
  const effectiveSkills = config.skills;

  const buildSysPrompt = (overrideMode?: AIMode) =>
    buildSystemPrompt({
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

    // Audit Trail — captura início do turno, finalizado em ambos os caminhos.
    const trailStart = Date.now();
    const recordTrail = (status: "ok" | "erro" | "abortado", responseChars: number, tools: string[], errorMsg?: string) => {
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
      // Separa system prompt (sempre preservado) do restante do histórico.
      const sys = full[0]?.role === "system" ? [full[0]] : [];
      const rest = sys.length ? full.slice(1) : full;

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
        setMessages([
          ...history,
          ...collected.map((c) => ({
            role: "tool" as const,
            content: c.result ?? "",
            toolName: c.name,
            ts: Date.now(),
          })),
          { role: "assistant", content: out.finalText, ts: Date.now() },
        ]);
        recordTrail("ok", out.finalText.length, collected.map((c) => c.name));
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

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_FILES_PER_MSG - attachments.length;
    if (remaining <= 0) {
      toast.error(`Máx ${MAX_FILES_PER_MSG} anexos por mensagem.`);
      return;
    }
    const toProcess = Array.from(files).slice(0, remaining);
    setProcessingFile(true);
    try {
      const results: ChatAttachment[] = [];
      for (const f of toProcess) {
        setProcessingMsg(`Lendo ${f.name}…`);
        const att = await processFile(f, (m) => setProcessingMsg(m));
        if (att.error) toast.error(`${att.name}: ${att.error}`);
        else if (att.ocrUsed) {
          const lbl = confidenceLabel(att.ocrConfidence);
          if (lbl.tone === "bad")
            toast.warning(`${att.name}: OCR com confiança ${lbl.label}. Revise antes de usar.`);
          else toast.success(`${att.name}: OCR concluído — confiança ${lbl.label}.`);
        }
        results.push(att);
      }
      setAttachments((prev) => [...prev, ...results]);
    } finally {
      setProcessingFile(false);
      setProcessingMsg("");
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const handleStop = () => abortRef.current?.abort();

  const handleNewThread = () => {
    const t = createThread(state.companyName, `Conversa ${threads.length + 1}`);
    const next = [t, ...threads];
    setThreads(next);
    saveThreads(state.companyName, next);
    setActiveId(t.id);
    setMessages(injectBriefingIfEmpty(state.companyName, t.id, []));
  };

  const handleDeleteThread = (id: string) => {
    deleteThread(state.companyName, id);
    const next = threads.filter((t) => t.id !== id);
    setThreads(next);
    if (id === activeId) {
      const fallback = next[0] ?? createThread(state.companyName, "Conversa principal");
      if (!next.length) {
        setThreads([fallback]);
        saveThreads(state.companyName, [fallback]);
      }
      setActiveId(fallback.id);
      setMessages(
        injectBriefingIfEmpty(
          state.companyName,
          fallback.id,
          loadMessages(state.companyName, fallback.id),
        ),
      );
    }
  };

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

  // === Pipeline 360°: cfo → controller → auditor ===
  // Disponível a partir do Board Mode. Executa 3 estágios sequenciais,
  // cada um com seu próprio system prompt (modo) e recebendo o output do anterior.
  // O estado `pipeline360` expõe progresso ao vivo para a UI (estágio atual +
  // concluídos). O botão Parar reusa `handleStop` (aborta o stream em curso
  // e a checagem `ac.signal.aborted` entre estágios encerra o pipeline limpo).
  type Pipeline360Stage = "cfo" | "controller" | "auditor";
  interface Pipeline360State {
    active: boolean;
    current: Pipeline360Stage | null;
    completed: Pipeline360Stage[];
    total: number;
    aborted?: boolean;
    /** Pergunta original — preservada para permitir Reiniciar após cancelar. */
    question?: string;
    /** Outputs já produzidos — passados ao próximo estágio no resume. */
    outputs?: Array<{ stage: Pipeline360Stage; output: string }>;
  }
  const [pipeline360, setPipeline360] = useState<Pipeline360State>({
    active: false,
    current: null,
    completed: [],
    total: 3,
  });

  // Restaura pipeline persistido ao trocar de empresa/thread.
  useEffect(() => {
    if (!activeId) return;
    const persisted = loadPipeline360(state.companyName || "default", activeId);
    if (persisted) {
      setPipeline360({
        active: false,
        current: null,
        completed: persisted.completed,
        total: persisted.total,
        aborted: persisted.aborted,
        question: persisted.question,
        outputs: persisted.outputs,
      });
    } else {
      setPipeline360({ active: false, current: null, completed: [], total: 3 });
    }
  }, [activeId, state.companyName]);

  // Persiste mudanças relevantes do pipeline (não persiste `active`/`current`).
  useEffect(() => {
    if (!activeId) return;
    const company = state.companyName || "default";
    if (pipeline360.completed.length === 0 && !pipeline360.question) {
      clearPipeline360(company, activeId);
      return;
    }
    savePipeline360(company, activeId, {
      completed: pipeline360.completed,
      total: pipeline360.total,
      aborted: pipeline360.aborted,
      question: pipeline360.question,
      outputs: pipeline360.outputs,
    });
  }, [
    activeId,
    state.companyName,
    pipeline360.completed,
    pipeline360.total,
    pipeline360.aborted,
    pipeline360.question,
    pipeline360.outputs,
  ]);

  // Executa N estágios a partir de `startIdx`, reaproveitando outputs prévios.
  // Usado tanto pelo run inicial quanto pelo resume após cancelar.
  const _runPipelineStages = async (
    q: string,
    startIdx: number,
    seedOutputs: Array<{ stage: Pipeline360Stage; output: string }>,
  ) => {
    if (!activeId) return;
    const { PIPELINE_360, buildStagePrompt, stageHeader } = await import(
      "@/engines/ai/pipeline"
    );
    setStreaming(true);
    touchThread(state.companyName, activeId);
    const ac = new AbortController();
    abortRef.current = ac;
    const outputs = [...seedOutputs];
    let convo: ChatMessage[] = messages.slice();
    let aborted = false;

    try {
      for (let i = startIdx; i < PIPELINE_360.length; i++) {
        if (ac.signal.aborted) {
          aborted = true;
          break;
        }
        const stage = PIPELINE_360[i];
        setPipeline360((p) => ({ ...p, current: stage, active: true }));
        const stagePrompt = buildStagePrompt(stage, q, outputs);
        const sysPrompt = buildSysPrompt(stage);
        const header = stageHeader(stage, i);

        const llm = buildLlmMessages({
          systemPrompt: sysPrompt,
          history: convo,
          forTools: false,
          lastUserContent: stagePrompt,
        });

        let acc = header;
        convo = [...convo, { role: "assistant", content: acc, ts: Date.now() }];
        setMessages(convo);
        const stageStart = Date.now();
        try {
          for await (const delta of streamChat(config, llm, ac.signal)) {
            acc += delta;
            setMessages((prev) => {
              const copy = prev.slice();
              copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
              return copy;
            });
          }
          const body = acc.slice(header.length);
          outputs.push({ stage, output: body });
          convo = [
            ...convo.slice(0, -1),
            { role: "assistant", content: acc, ts: Date.now() },
          ];
          setPipeline360((p) => ({
            ...p,
            completed: [...p.completed, stage],
            current: null,
            outputs: [...outputs],
          }));
          recordChatTrail(state.companyName || "default", {
            threadId: activeId,
            mode: stage,
            provider: config.provider,
            model: config.model,
            userText: `[pipeline360 ${i + 1}/3] ${q}`,
            responseChars: body.length,
            tools: [],
            durationMs: Date.now() - stageStart,
            status: "ok",
          });
        } catch (e: unknown) {
          const stageAborted = ac.signal.aborted;
          aborted = aborted || stageAborted;
          acc += stageAborted ? "\n\n_(⏸ cancelado pelo usuário)_" : "\n\n" + errToMd(e);
          setMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
            return copy;
          });
          recordChatTrail(state.companyName || "default", {
            threadId: activeId,
            mode: stage,
            provider: config.provider,
            model: config.model,
            userText: `[pipeline360 ${i + 1}/3] ${q}`,
            responseChars: acc.length - header.length,
            tools: [],
            durationMs: Date.now() - stageStart,
            status: stageAborted ? "abortado" : "erro",
            errorMsg: e instanceof Error ? e.message : String(e),
          });
          break;
        }
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setPipeline360((p) => ({
        ...p,
        active: false,
        current: null,
        aborted,
        question: q,
        outputs: [...outputs],
      }));
    }
  };

  const runPipeline360 = async (userQuestion?: string) => {
    if (streaming || !activeId) return;
    if (mode !== "board") {
      toast.error("Análise 360° disponível apenas no Modo Conselho (Board).");
      return;
    }
    const q = (userQuestion ?? input).trim() || "Análise 360° para decisão de conselho.";
    const userMsg: ChatMessage = {
      role: "user",
      content: `🎯 **Análise 360° (pipeline cfo → controller → auditor)**\n\n${q}`,
      ts: Date.now(),
    };
    setMessages([...messages, userMsg]);
    setInput("");
    setPipeline360({
      active: true,
      current: null,
      completed: [],
      total: 3,
      question: q,
      outputs: [],
    });
    // Aguarda flush do setMessages? _runPipelineStages lê `messages` da closure
    // atual, que já inclui userMsg porque chamamos setMessages acima. Mas para
    // garantir, passamos o convo via push direto: usamos um microtask.
    await Promise.resolve();
    await _runPipelineStages(q, 0, []);
  };

  // Retoma o pipeline a partir do próximo estágio após um cancelar/erro.
  // Reaproveita pergunta + outputs preservados em `pipeline360`.
  const resumePipeline360 = async () => {
    if (streaming || !activeId) return;
    const startIdx = pipeline360.completed.length;
    if (startIdx >= pipeline360.total) {
      toast.info("Pipeline já concluído.");
      return;
    }
    if (!pipeline360.question) {
      toast.error("Sem pipeline anterior para retomar.");
      return;
    }
    setPipeline360((p) => ({ ...p, active: true, aborted: false, current: null }));
    await _runPipelineStages(
      pipeline360.question,
      startIdx,
      pipeline360.outputs ?? [],
    );
  };




  // Recarrega threads do storage (usado por AIChatSheet ao renomear).
  const reloadThreads = () => setThreads(loadThreads(state.companyName));

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
    runPipeline360,
    resumePipeline360,
    resetPipeline360: () => {
      if (streaming) {
        toast.error("Cancele o pipeline em execução antes de limpar.");
        return;
      }
      clearPipeline360(state.companyName || "default", activeId);
      setPipeline360({ active: false, current: null, completed: [], total: 3 });
      toast.success("Pipeline 360° reiniciado.");
    },
    pipeline360,
    handleNewThread,
    handleDeleteThread,
    reloadThreads,
  };
}
