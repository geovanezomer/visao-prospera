// Hook compartilhado entre AIChatSheet e AIView.
// Centraliza toda a lógica de chat (threads, streaming, tool-calling, anexos)
// para eliminar duplicação. Os componentes ficam apenas com JSX.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AIConfig, ChatMessage, ChatThread, createThread, deleteThread, loadConfig, loadMessages,
  loadThreads, saveConfig, saveMessages, saveThreads, touchThread,
} from "@/services/ai/providers";
import { chatWithTools, streamChat, type LLMMessage, type ToolCall } from "@/services/ai/client";
import { buildSnapshot, getSectionsCached } from "@/services/ai/snapshot";
import { buildLlmMessages } from "@/services/ai/historyUtils";
import { buildSystemPrompt } from "@/services/ai/systemPrompt";
import { runTool } from "@/services/ai/tools";
import {
  processFile, buildPdfContext, buildVisionMessageContent, confidenceLabel,
  MAX_FILES_PER_MSG, type ChatAttachment,
} from "@/services/ai/attachments";
import { buildDynamicSuggestions } from "@/services/ai/suggestions";
import type { AppState } from "@/lib/finance/types";
import { resolveEffectiveRegime } from "@/lib/finance/calculations";
import type { SimulatorParams } from "@/lib/finance/simulator";

export interface UseAIChatParams {
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
  simParams?: SimulatorParams;
}

// Converte um erro de transporte/modelo em markdown amigável.
export function errToMd(e: any): string {
  const msg = e?.message || String(e);
  if (/timeout/i.test(msg)) return `**⏱️ Timeout** — o modelo demorou demais. Aumente o timeout em ⚙️.`;
  if (/AbortError/i.test(e?.name || "")) return "_(geração interrompida)_";
  if (/401|403/.test(msg)) return `**🔑 Autenticação falhou** — verifique a API Key em ⚙️.`;
  if (/429/.test(msg)) return `**🚦 Rate limit** — aguarde alguns segundos e tente novamente.`;
  if (/Failed to fetch|NetworkError/i.test(msg)) return `**🔌 Sem conexão** com o endpoint. LM Studio rodando? URL correta?`;
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

  // === Bootstrap por empresa ===
  useEffect(() => {
    const ts = loadThreads(state.companyName);
    if (ts.length === 0) {
      const t = createThread(state.companyName, "Conversa principal");
      setThreads([t]);
      setActiveId(t.id);
      setMessages([]);
    } else {
      setThreads(ts);
      const cur = ts.find(t => t.id === activeId) ?? ts[0];
      setActiveId(cur.id);
      setMessages(loadMessages(state.companyName, cur.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.companyName]);

  // === Carrega msgs ao trocar thread ===
  useEffect(() => {
    if (activeId) setMessages(loadMessages(state.companyName, activeId));
  }, [activeId, state.companyName]);

  // === Persiste msgs ===
  useEffect(() => {
    if (activeId) saveMessages(state.companyName, activeId, messages);
  }, [messages, state.companyName, activeId]);

  // === Snapshot (cache por hash) ===
  const simHasChanges = !!simActive && simActive > 0;
  const snapshot = useMemo(() => {
    if (!config.includeSnapshot || config.useTools) return "";
    try {
      getSectionsCached(state, simHasChanges ? simulatedState : undefined);
      return buildSnapshot(state, simHasChanges ? simulatedState : undefined);
    } catch { return ""; }
  }, [state, simulatedState, simHasChanges, config.includeSnapshot, config.useTools]);

  // Contexto runtime: empresa + regime efetivo (com downgrade Simples→Presumido).
  const runtimeContext = useMemo(() => {
    try {
      const eff = resolveEffectiveRegime(state);
      const t = state.tax;
      const nominal = t.regime;
      const base = eff !== nominal ? `${eff} (nominal: ${nominal} — downgrade por exceder limite)` : eff;
      const extra = eff === "simples"
        ? ` · Anexo ${t.simplesAnexo}, Fator R ${(t.fatorR * 100).toFixed(1)}%`
        : "";
      return { companyName: state.companyName, regimeLabel: base + extra };
    } catch {
      return { companyName: state.companyName, regimeLabel: state.tax?.regime };
    }
  }, [state.companyName, state.tax]);

  // Sugestões dinâmicas baseadas no diagnose().
  const suggestions = useMemo(() => buildDynamicSuggestions(state), [state]);

  const buildSysPrompt = (auditMode?: boolean) =>
    buildSystemPrompt({
      snapshot,
      includeSnapshot: config.includeSnapshot,
      useTools: config.useTools,
      extra: config.extraSystemPrompt,
      soul: config.soul,
      skills: config.skills,
      auditMode,
      context: runtimeContext,
    });

  const send = async (text: string, opts?: { auditMode?: boolean; replaceLast?: boolean }) => {
    const content = text.trim();
    if ((!content && !opts?.auditMode && attachments.length === 0) || streaming) return;
    if (!activeId) return;

    const atts = attachments.slice();
    const pdfCtx = buildPdfContext(atts);
    const displayContent = content + (pdfCtx ? `\n\n_(📎 ${atts.length} anexo${atts.length > 1 ? "s" : ""})_` : "");

    let history = messages.slice();
    if (opts?.replaceLast) {
      while (history.length && history[history.length - 1].role !== "user") history.pop();
    } else if (content || atts.length) {
      const userMsg: ChatMessage = {
        role: "user",
        content: displayContent,
        ts: Date.now(),
        attachments: atts.map(a => ({ name: a.name, type: a.type, size: a.size, error: a.error })),
      } as ChatMessage;
      history = [...history, userMsg];
    }

    setMessages(history);
    setInput("");
    setAttachments([]);
    setStreaming(true);
    touchThread(state.companyName, activeId);

    const sysPrompt = buildSysPrompt(opts?.auditMode);
    const ac = new AbortController();
    abortRef.current = ac;

    const fullUserText = content + pdfCtx;
    const hasImages = atts.some(a => a.type === "image" && a.dataUrl && !a.error);
    const lastUserContent = hasImages ? buildVisionMessageContent(fullUserText, atts) : fullUserText;

    const buildLlmHistory = (forTools: boolean): LLMMessage[] =>
      buildLlmMessages({
        systemPrompt: sysPrompt,
        history,
        forTools,
        lastUserContent,
      });

    // === Caminho 1: TOOL CALLING ===
    if (config.useTools) {
      const llm = buildLlmHistory(true);
      const collected: ToolCall[] = [];
      try {
        const out = await chatWithTools(
          config,
          llm,
          (name, args) => runTool(name, args, state, simHasChanges ? simulatedState : undefined, simParams),
          {
            signal: ac.signal,
            onProgress: (e) => {
              if (e.type === "tool") {
                collected.push(e.call);
                if (e.call.name === "criar_acao") toast.success("Ação adicionada ao plano", { description: "Painel de ações atualizado." });
                else if (e.call.name === "salvar_cenario") toast.success("Cenário salvo", { description: "Disponível no menu de cenários." });
                else if (e.call.name === "atualizar_acao") toast.success("Ação atualizada");
                else if (e.call.name === "deletar_acao") toast.success("Ação removida");
                setMessages([
                  ...history,
                  ...collected.map(c => ({
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
          ...collected.map(c => ({ role: "tool" as const, content: c.result ?? "", toolName: c.name, ts: Date.now() })),
          { role: "assistant", content: out.finalText, ts: Date.now() },
        ]);
      } catch (e: any) {
        setMessages([...history, { role: "assistant", content: errToMd(e), ts: Date.now() }]);
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
        setMessages(prev => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
          return copy;
        });
      }
    } catch (e: any) {
      setMessages(prev => {
        const copy = prev.slice();
        copy[copy.length - 1] = {
          role: "assistant",
          content: (acc ? acc + "\n\n" : "") + errToMd(e),
          ts: Date.now(),
        };
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_FILES_PER_MSG - attachments.length;
    if (remaining <= 0) { toast.error(`Máx ${MAX_FILES_PER_MSG} anexos por mensagem.`); return; }
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
          if (lbl.tone === "bad") toast.warning(`${att.name}: OCR com confiança ${lbl.label}. Revise antes de usar.`);
          else toast.success(`${att.name}: OCR concluído — confiança ${lbl.label}.`);
        }
        results.push(att);
      }
      setAttachments(prev => [...prev, ...results]);
    } finally {
      setProcessingFile(false);
      setProcessingMsg("");
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments(prev => prev.filter(a => a.id !== id));

  const handleStop = () => abortRef.current?.abort();

  const handleNewThread = () => {
    const t = createThread(state.companyName, `Conversa ${threads.length + 1}`);
    const next = [t, ...threads];
    setThreads(next);
    saveThreads(state.companyName, next);
    setActiveId(t.id);
    setMessages([]);
  };

  const handleDeleteThread = (id: string) => {
    deleteThread(state.companyName, id);
    const next = threads.filter(t => t.id !== id);
    setThreads(next);
    if (id === activeId) {
      const fallback = next[0] ?? createThread(state.companyName, "Conversa principal");
      if (!next.length) { setThreads([fallback]); saveThreads(state.companyName, [fallback]); }
      setActiveId(fallback.id);
      setMessages(loadMessages(state.companyName, fallback.id));
    }
  };

  const handleRegenerate = () => {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser) void send(lastUser.content, { replaceLast: true });
  };

  const handleEditLast = () => {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      const idx = messages.lastIndexOf(lastUser);
      setMessages(messages.slice(0, idx));
    }
  };

  const handleAudit = () =>
    void send("Faça uma análise completa estilo auditor.", { auditMode: true });

  // Recarrega threads do storage (usado por AIChatSheet ao renomear).
  const reloadThreads = () => setThreads(loadThreads(state.companyName));

  // Atualiza config + persiste.
  const updateConfig = (c: AIConfig) => { setConfig(c); saveConfig(c); };

  return {
    // estado
    config, updateConfig,
    messages, setMessages,
    input, setInput,
    streaming,
    attachments, removeAttachment,
    processingFile, processingMsg,
    threads, activeId, setActiveId,
    snapshot, suggestions, simHasChanges,
    // ações
    send, handleFiles, handleStop,
    handleRegenerate, handleEditLast, handleAudit,
    handleNewThread, handleDeleteThread, reloadThreads,
  };
}
