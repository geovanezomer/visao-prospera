import * as React from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import { Bot, Settings, Trash2, Send, Loader2, User, Plus, MessageSquare, X, Paperclip } from "lucide-react";
import { AIConfigDialog } from "./AIConfigDialog";
import type { AppState } from "@/lib/finance/types";
import type { SimulatorParams } from "@/lib/finance/simulator";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AuditReport, isAuditReport } from "./AuditReport";
import { useAIChat } from "@/hooks/useAIChat";

const ReactMarkdown = lazy(() => import("react-markdown") as any);

class AIViewBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Falha ao renderizar Consultor IA", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <Bot className="h-8 w-8 text-primary" />
        <h2 className="text-lg font-semibold">Consultor IA indisponível</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Houve uma falha local ao abrir o chat. Recarregue a página ou limpe as configurações do chat em ⚙️.
        </p>
        <Button variant="outline" onClick={() => this.setState({ error: null })}>
          Tentar novamente
        </Button>
      </div>
    );
  }
}

const handleCopy = (s: string) => {
  navigator.clipboard.writeText(s).then(() => toast.success("Copiado"));
};

interface Props {
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
  simParams?: SimulatorParams;
}

export function AIView({ state, simulatedState, simActive, simParams }: Props) {
  return (
    <AIViewBoundary>
      <AIViewContent state={state} simulatedState={simulatedState} simActive={simActive} simParams={simParams} />
    </AIViewBoundary>
  );
}

function AIViewContent({ state, simulatedState, simActive, simParams }: Props) {
  const {
    config, updateConfig,
    messages, input, setInput, streaming,
    attachments, removeAttachment, processingFile,
    threads, activeId, setActiveId,
    suggestions, simHasChanges,
    send, handleFiles,
    handleNewThread, handleDeleteThread,
  } = useAIChat({ state, simulatedState, simActive, simParams });

  const [configOpen, setConfigOpen] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === Auto-scroll ===
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const onFilesChange = async (files: FileList | null) => {
    await handleFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
            <Button onClick={handleNewThread} variant="outline" className="w-full justify-start gap-2 mb-4">
              <Plus className="h-4 w-4" /> Nova Conversa
            </Button>
            {threads.map(t => (
              <div key={t.id} className={`flex items-center gap-2 rounded-lg p-3 text-sm cursor-pointer transition-colors ${t.id === activeId ? "bg-primary/10 border border-primary/20" : "hover:bg-accent"}`}
                onClick={() => setActiveId(t.id)}>
                <span className="flex-1 truncate">{t.title}</span>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteThread(t.id);
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
                  {suggestions.map((s: string, i: number) => (
                    <button key={i} onClick={() => void send(s)} className="text-left text-sm p-4 rounded-lg border border-border/40 hover:bg-accent hover:border-primary/50 transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.map((m, i) => {
                  // Modo Auditor: relatório estruturado renderizado em card próprio.
                  if (m.role === "assistant" && isAuditReport(m.content)) {
                    return (
                      <div key={i} className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card border-border/40">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <AuditReport content={m.content} onCopy={handleCopy} />
                        </div>
                      </div>
                    );
                  }
                  return (
                  <div key={i} className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg border ${m.role === "user" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/40"}`}>
                      {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div className={`group relative flex flex-col gap-2 rounded-2xl px-5 py-3 text-sm shadow-sm max-w-[85%] ${m.role === "user" ? "bg-primary/15 border border-primary/20" : "bg-card/80 border border-border/60"}`}>
                      <Suspense fallback={<div className="h-20 animate-pulse bg-muted rounded" />}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:p-3 prose-pre:rounded-lg">
                          {m.content}
                        </ReactMarkdown>
                      </Suspense>
                    </div>
                  </div>
                  );
                })}
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
                      <button onClick={() => removeAttachment(a.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative flex items-end gap-2 bg-background border border-border/60 rounded-xl px-3 py-2 shadow-inner focus-within:border-primary/50 transition-colors">
                <input type="file" multiple ref={fileInputRef} className="hidden" onChange={(e) => void onFilesChange(e.target.files)} />
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

      <AIConfigDialog open={configOpen} onOpenChange={setConfigOpen} config={config} onSave={updateConfig} />
    </div>
  );
}
