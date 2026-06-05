import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Settings, Trash2, Send, Loader2, Bot, User, Plus, MessageSquare,
  RefreshCcw, Copy, Download, ChevronDown, ChevronRight, Wrench, Edit2, Sparkles, Square,
} from "lucide-react";
import { AIConfigDialog } from "./AIConfigDialog";
import {
  AIConfig, ChatMessage, ChatThread, createThread, deleteThread, loadConfig, loadMessages,
  loadThreads, renameThread, saveConfig, saveMessages, saveThreads, touchThread,
} from "@/services/ai/providers";
import { chatWithTools, streamChat, type LLMMessage, type ToolCall } from "@/services/ai/client";
import { buildSnapshot, getSectionsCached } from "@/services/ai/snapshot";
import { buildSystemPrompt } from "@/services/ai/systemPrompt";
import { runTool } from "@/services/ai/tools";
import type { AppState } from "@/lib/finance/types";
import { toast } from "@/hooks/use-toast";

const ReactMarkdown = lazy(() => import("react-markdown"));

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
}

const SUGGESTIONS = [
  "Qual o VPL do meu negócio e o que ele significa na prática?",
  "Por que o caixa fica negativo? Em que mês? Quanto preciso aportar?",
  "Meu DSCR e cobertura de juros são saudáveis?",
  "Onde estão meus maiores custos fixos e o que cortar primeiro?",
  "E se eu cortar 15% dos custos fixos? Qual o impacto?",
  "Que ações me dariam o maior impacto no valuation?",
];

export function AIChatSheet({ open, onOpenChange, state, simulatedState, simActive }: Props) {
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
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    // eslint-disable-next-line
  }, [state.companyName]);

  // === Carrega msgs ao trocar thread ===
  useEffect(() => {
    if (activeId) setMessages(loadMessages(state.companyName, activeId));
  }, [activeId, state.companyName]);

  // === Persiste msgs ===
  useEffect(() => {
    if (activeId) saveMessages(state.companyName, activeId, messages);
  }, [messages, state.companyName, activeId]);

  // === Auto-scroll ===
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  // === Snapshot (cache por hash via getSectionsCached interno) ===
  const simHasChanges = !!simActive && simActive > 0;
  const snapshot = useMemo(() => {
    if (!config.includeSnapshot || config.useTools) return "";
    try {
      // toca cache
      getSectionsCached(state, simHasChanges ? simulatedState : undefined);
      return buildSnapshot(state, simHasChanges ? simulatedState : undefined, config.maxTokensSnapshot);
    } catch { return ""; }
  }, [state, simulatedState, simHasChanges, config.includeSnapshot, config.useTools, config.maxTokensSnapshot]);

  const buildSysPrompt = (auditMode?: boolean) =>
    buildSystemPrompt({
      snapshot,
      includeSnapshot: config.includeSnapshot,
      useTools: config.useTools,
      extra: config.extraSystemPrompt,
      auditMode,
    });

  const send = async (text: string, opts?: { auditMode?: boolean; replaceLast?: boolean }) => {
    const content = text.trim();
    if ((!content && !opts?.auditMode) || streaming) return;
    if (!activeId) return;

    let history = messages.slice();
    if (opts?.replaceLast) {
      // remove última assistant (e tools associados) para regenerar
      while (history.length && history[history.length - 1].role !== "user") history.pop();
    } else if (content) {
      const userMsg: ChatMessage = { role: "user", content, ts: Date.now() };
      history = [...history, userMsg];
    }

    setMessages(history);
    setInput("");
    setStreaming(true);
    touchThread(state.companyName, activeId);

    const sysPrompt = buildSysPrompt(opts?.auditMode);
    const ac = new AbortController();
    abortRef.current = ac;

    // === Caminho 1: TOOL CALLING ===
    if (config.useTools) {
      const llm: LLMMessage[] = [
        { role: "system", content: sysPrompt },
        ...history
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({ role: m.role, content: m.content }) as LLMMessage),
      ];
      const collected: ToolCall[] = [];
      try {
        const out = await chatWithTools(
          config,
          llm,
          (name, args) => runTool(name, args, state, simHasChanges ? simulatedState : undefined),
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
        setMessages([
          ...history,
          { role: "assistant", content: errToMd(e), ts: Date.now() },
        ]);
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
      return;
    }

    // === Caminho 2: STREAMING simples ===
    const llm: LLMMessage[] = [
      { role: "system", content: sysPrompt },
      ...history.map(m => ({ role: m.role === "tool" ? "assistant" : m.role, content: m.content }) as LLMMessage),
    ];
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

  const handleRename = (id: string) => {
    if (!renameVal.trim()) { setRenamingId(null); return; }
    renameThread(state.companyName, id, renameVal.trim());
    setThreads(loadThreads(state.companyName));
    setRenamingId(null);
  };

  const handleRegenerate = () => {
    // remove última assistant e re-envia a última user
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser) void send(lastUser.content, { replaceLast: true });
  };

  const handleEditLast = () => {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      // remove tudo a partir desse último user
      const idx = messages.lastIndexOf(lastUser);
      setMessages(messages.slice(0, idx));
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast({ description: "Copiado." }),
      () => toast({ description: "Falha ao copiar.", variant: "destructive" }),
    );
  };

  const handleExport = () => {
    const t = threads.find(t => t.id === activeId);
    const md = `# ${t?.title || "Conversa"} — ${state.companyName}\n\n` +
      messages.map(m => {
        const who = m.role === "user" ? "**Você**" : m.role === "tool" ? `**🔧 ${m.toolName}**` : "**IA**";
        return `${who}\n\n${m.content}`;
      }).join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `chat-${state.companyName || "empresa"}-${Date.now()}.md`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleAudit = () => void send("Faça uma análise completa estilo auditor.", { auditMode: true });

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[520px]">
          <SheetHeader className="flex flex-row items-center justify-between border-b border-border/40 px-3 py-2.5 space-y-0">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-4 w-4 text-primary shrink-0" />
              <SheetTitle className="text-sm truncate">Consultor IA</SheetTitle>
              <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground shrink-0">
                {config.provider}{config.useTools ? "+tools" : ""}
              </span>
              {simHasChanges && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300 shrink-0">
                  sim ativo
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowThreads(s => !s)} title="Conversas">
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewThread} title="Nova conversa">
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleAudit} title="Modo auditor" disabled={streaming}>
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport} title="Exportar markdown">
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfigOpen(true)} title="Configurar">
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </div>
          </SheetHeader>

          {showThreads && (
            <div className="border-b border-border/40 bg-muted/20 max-h-48 overflow-y-auto p-2 space-y-1">
              {threads.length === 0 && <p className="text-[11px] text-muted-foreground px-2">Sem conversas.</p>}
              {threads.map(t => (
                <div key={t.id} className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${t.id === activeId ? "bg-primary/10" : "hover:bg-muted/40"}`}>
                  {renamingId === t.id ? (
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={() => handleRename(t.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(t.id); if (e.key === "Escape") setRenamingId(null); }}
                      className="h-6 text-xs flex-1"
                    />
                  ) : (
                    <button className="flex-1 text-left truncate" onClick={() => setActiveId(t.id)}>{t.title}</button>
                  )}
                  <button className="p-0.5 text-muted-foreground hover:text-foreground" title="Renomear" onClick={() => { setRenamingId(t.id); setRenameVal(t.title); }}>
                    <Edit2 className="h-3 w-3" />
                  </button>
                  <button className="p-0.5 text-muted-foreground hover:text-destructive" title="Excluir" onClick={() => handleDeleteThread(t.id)}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Pergunte qualquer coisa sobre os números desta empresa. A IA tem acesso ao DRE, fluxo de caixa, indicadores, valuation, saúde, diagnóstico {config.useTools ? "via tool-calling sob demanda" : "via snapshot completo"}.
                </p>
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sugestões</p>
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => void send(s)} className="block w-full rounded-md border border-border/40 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <MessageView key={i} msg={m} onCopy={handleCopy} />
                ))}
                {streaming && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> pensando…
                  </div>
                )}
                {!streaming && messages.some(m => m.role === "assistant") && (
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleRegenerate}>
                      <RefreshCcw className="mr-1 h-3 w-3" /> Regenerar
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleEditLast}>
                      <Edit2 className="mr-1 h-3 w-3" /> Editar última
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/40 p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Pergunte sobre DRE, caixa, valuation, riscos…"
                rows={2}
                className="min-h-[44px] resize-none text-sm"
                disabled={streaming}
              />
              {streaming ? (
                <Button variant="outline" size="icon" onClick={handleStop} title="Parar"><Square className="h-4 w-4" /></Button>
              ) : (
                <Button size="icon" onClick={() => void send(input)} disabled={!input.trim()} title="Enviar (Enter)"><Send className="h-4 w-4" /></Button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Enter envia · Shift+Enter quebra linha · {config.useTools ? "tools ativo" : config.includeSnapshot ? "snapshot ativo" : "sem snapshot"}
              {simHasChanges ? " · cenário simulado incluído" : ""}
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <AIConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        onSave={(c) => { setConfig(c); saveConfig(c); }}
      />
    </>
  );
}

function errToMd(e: any): string {
  const msg = e?.message || String(e);
  if (/timeout/i.test(msg)) return `**⏱️ Timeout** — o modelo demorou demais. Aumente o timeout em ⚙️.`;
  if (/AbortError/i.test(e?.name || "")) return "_(geração interrompida)_";
  if (/401|403/.test(msg)) return `**🔑 Autenticação falhou** — verifique a API Key em ⚙️.`;
  if (/429/.test(msg)) return `**🚦 Rate limit** — aguarde alguns segundos e tente novamente.`;
  if (/Failed to fetch|NetworkError/i.test(msg)) return `**🔌 Sem conexão** com o endpoint. LM Studio rodando? URL correta?`;
  return `**Erro:** ${msg}`;
}

function MessageView({ msg, onCopy }: { msg: ChatMessage; onCopy: (s: string) => void }) {
  const [open, setOpen] = useState(false);

  if (msg.role === "tool") {
    return (
      <div className="rounded border border-border/30 bg-muted/20 text-xs">
        <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Wrench className="h-3 w-3 text-primary" />
          <span className="font-mono text-[11px]">{msg.toolName}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">{msg.content.length} chars</span>
        </button>
        {open && (
          <pre className="border-t border-border/30 px-2 py-2 text-[10px] whitespace-pre-wrap overflow-x-auto">{msg.content}</pre>
        )}
      </div>
    );
  }

  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">{msg.content}</div>
        <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex gap-2 group">
      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm prose-invert max-w-none text-sm break-words">
          <Suspense fallback={<div className="text-xs text-muted-foreground">{msg.content || "…"}</div>}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "_…_"}</ReactMarkdown>
          </Suspense>
        </div>
        {msg.content && (
          <button className="mt-1 opacity-0 group-hover:opacity-100 transition text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => onCopy(msg.content)}>
            <Copy className="h-3 w-3" /> copiar
          </button>
        )}
      </div>
    </div>
  );
}
