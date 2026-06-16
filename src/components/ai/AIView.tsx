import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Settings, Trash2, Send, Loader2, User, Plus, MessageSquare, Download, Edit2, Sparkles, X, Paperclip } from "lucide-react";
import { AIConfigDialog } from "./AIConfigDialog";
import {
  AIConfig, ChatMessage, ChatThread, createThread, deleteThread, loadConfig, loadMessages,
  loadThreads, renameThread, saveConfig, saveMessages, saveThreads, touchThread,
} from "@/services/ai/providers";
import { chatWithTools, streamChat, type LLMMessage, type ToolCall } from "@/services/ai/client";
import { buildSnapshot, getSectionsCached } from "@/services/ai/snapshot";
import { buildLlmMessages } from "@/services/ai/historyUtils";
import { buildSystemPrompt } from "@/services/ai/systemPrompt";
import { runTool } from "@/services/ai/tools";
import { processFile, buildPdfContext, buildVisionMessageContent, confidenceLabel, MAX_FILES_PER_MSG, type ChatAttachment } from "@/services/ai/attachments";
import type { AppState } from "@/lib/finance/types";
import type { SimulatorParams } from "@/lib/finance/simulator";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const ReactMarkdown = lazy(() => import("react-markdown") as any);


interface Props {
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
  simParams?: SimulatorParams;
}

const SUGGESTIONS = [
  "Qual o VPL do meu negócio e o que ele significa na prática?",
  "Por que o caixa fica negativo? Em que mês? Quanto preciso aportar?",
  "Meu DSCR e cobertura de juros são saudáveis?",
  "Onde estão meus maiores custos fixos e o que cortar primeiro?",
  "E se eu cortar 15% dos custos fixos? Qual o impacto?",
  "Que ações me dariam o maior impacto no valuation?",
];

export function AIView({ state, simulatedState, simActive, simParams }: Props) {
  const [config, setConfig] = useState<AIConfig>(() => loadConfig());
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads(state.companyName));
  const [activeId, setActiveId] = useState<string>(() => {
    const ts = loadThreads(state.companyName);
    return ts[0]?.id ?? "";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [processingFile, setProcessingFile] = useState(false);
  const [processingMsg, setProcessingMsg] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }, [state.companyName]);

  useEffect(() => {
    if (activeId) setMessages(loadMessages(state.companyName, activeId));
  }, [activeId, state.companyName]);

  useEffect(() => {
    if (activeId) saveMessages(state.companyName, activeId, messages);
  }, [messages, state.companyName, activeId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const simHasChanges = !!simActive && simActive > 0;
  const snapshot = useMemo(() => {
    if (!config.includeSnapshot || config.useTools) return "";
    try {
      getSectionsCached(state, simHasChanges ? simulatedState : undefined);
      return buildSnapshot(state, simHasChanges ? simulatedState : undefined);
    } catch { return ""; }
  }, [state, simulatedState, simHasChanges, config.includeSnapshot, config.useTools]);

  // Contexto runtime: data, empresa, regime efetivo (com downgrade Simples→Presumido).
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
        setMessages([ ...history, { role: "assistant", content: errToMd(e), ts: Date.now() } ]);
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
      return;
    }

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
    if (remaining <= 0) { toast.error(`Máx ${MAX_FILES_PER_MSG} anexos.`); return; }
    const toProcess = Array.from(files).slice(0, remaining);
    setProcessingFile(true);
    try {
      const results: ChatAttachment[] = [];
      for (const f of toProcess) {
        setProcessingMsg(`Lendo ${f.name}…`);
        const att = await processFile(f, (m) => setProcessingMsg(m));
        if (att.error) toast.error(`${att.name}: ${att.error}`);
        results.push(att);
      }
      setAttachments(prev => [...prev, ...results]);
    } finally {
      setProcessingFile(false);
      setProcessingMsg("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const errToMd = (e: any) => `**Erro:** ${e.message || "Falha desconhecida"}`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex flex-row items-center justify-between border-b border-border/40 px-4 py-3 bg-card/20">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Consultor Financeiro IA</h2>
          <div className="flex gap-2">
            <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {config.provider}
            </span>
            {simHasChanges && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                simulação ativa
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowThreads(s => !s)}><MessageSquare className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setConfigOpen(true)}><Settings className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showThreads && (
          <div className="w-64 border-r border-border/40 bg-card/10 overflow-y-auto p-4 space-y-2">
            <Button onClick={() => {
              const t = createThread(state.companyName, `Conversa ${threads.length + 1}`);
              setThreads([t, ...threads]);
              setActiveId(t.id);
            }} variant="outline" className="w-full justify-start gap-2 mb-4">
              <Plus className="h-4 w-4" /> Nova Conversa
            </Button>
            {threads.map(t => (
              <div key={t.id} className={`flex items-center gap-2 rounded-lg p-3 text-sm cursor-pointer transition-colors ${t.id === activeId ? "bg-primary/10 border border-primary/20" : "hover:bg-accent"}`}
                onClick={() => setActiveId(t.id)}>
                <span className="flex-1 truncate">{t.title}</span>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" onClick={(e) => {
                  e.stopPropagation();
                  deleteThread(state.companyName, t.id);
                  setThreads(threads.filter(x => x.id !== t.id));
                }} />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 ? (
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="bg-card/30 rounded-xl p-6 border border-border/40">
                  <h3 className="text-lg font-medium mb-2">Como posso ajudar hoje?</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Eu analiso seus dados financeiros em tempo real. Posso identificar gargalos, simular cenários de crescimento, auditar seu regime tributário e ajudar no valuation.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => void send(s)} className="text-left text-sm p-4 rounded-lg border border-border/40 hover:bg-accent hover:border-primary/50 transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg border ${m.role === "user" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/40"}`}>
                      {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div className={`group relative flex flex-col gap-2 rounded-2xl px-5 py-3 text-sm shadow-sm max-w-[85%] ${m.role === "user" ? "bg-primary/15 border border-primary/20" : "bg-card/80 border border-border/60"}`}>
                      <Suspense fallback={<div className="h-20 animate-pulse bg-muted rounded" />}>
                        <ReactMarkdown className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:p-3 prose-pre:rounded-lg">
                          {m.content}
                        </ReactMarkdown>
                      </Suspense>
                    </div>
                  </div>
                ))}
                {streaming && (
                  <div className="flex gap-4 animate-in fade-in duration-500">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card border-border/40">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    </div>
                    <div className="bg-card/50 rounded-lg p-3 h-10 w-20 flex items-center justify-center gap-1">
                      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/40 bg-card/30 p-4">
            <div className="max-w-4xl mx-auto space-y-3">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map(a => (
                    <div key={a.id} className="flex items-center gap-1.5 bg-background border border-border/40 rounded-full pl-2.5 pr-1.5 py-1 text-[11px]">
                      <span className="truncate max-w-[120px]">{a.name}</span>
                      <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative flex items-end gap-2 bg-background border border-border/60 rounded-xl px-3 py-2 shadow-inner focus-within:border-primary/50 transition-colors">
                <input type="file" multiple ref={fileInputRef} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary" onClick={() => fileInputRef.current?.click()} disabled={processingFile}>
                  {processingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                  placeholder="Envie uma mensagem..."
                  className="min-h-[40px] max-h-48 resize-none bg-transparent border-0 focus-visible:ring-0 p-2 shadow-none scrollbar-thin"
                  rows={1}
                />
                <Button onClick={() => void send(input)} disabled={streaming || (!input.trim() && !attachments.length)} size="icon" className="h-9 w-9 shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AIConfigDialog open={configOpen} onOpenChange={setConfigOpen} config={config} onSave={(c) => { setConfig(c); saveConfig(c); }} />
    </div>
  );
}
