import * as React from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Settings,
  Trash2,
  Send,
  Loader2,
  User,
  Plus,
  MessageSquare,
  X,
  Paperclip,
  Brain,
  Layers,
  Users,
  ShieldCheck,
  Wrench,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { AIConfigDialog } from "./AIConfigDialog";
import { VerificationFooter } from "./VerificationFooter";
import type { AppState } from "@/engines/finance/types";
import type { SimulatorParams } from "@/engines/finance/simulator";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuditReport } from "./AuditReport";
import { isAuditReport } from "./auditReportFormat";
import { ChatChart } from "./ChatChart";
import { parseChartSpec } from "./chartSpec";
import { ScenarioBar } from "./ScenarioBar";
import { useAIChat } from "@/hooks/useAIChat";
import { resetAIStorage } from "@/engines/ai/providers";
import {
  useMemories,
  deleteMemory,
  createMemory,
  type MemoryCategory,
} from "@/engines/memory/store";
import { Input } from "@/components/ui/input";
import { AI_MODE_LABELS, AI_MODE_DESCRIPTIONS, type AIMode } from "@/engines/ai/systemPrompt";

// react-markdown não tem assinatura compatível direta com lazy() — usamos cast pontual.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactMarkdown = lazy(() => import("react-markdown") as any);

class AIViewBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; resetNonce: number }
> {
  state: { error: Error | null; resetNonce: number } = { error: null, resetNonce: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Falha ao renderizar Consultor IA", error);
  }

  private recover = () => {
    resetAIStorage();
    this.setState((state) => ({ error: null, resetNonce: state.resetNonce + 1 }));
  };

  render() {
    if (!this.state.error)
      return <React.Fragment key={this.state.resetNonce}>{this.props.children}</React.Fragment>;
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <Bot className="h-8 w-8 text-primary" />
        <h2 className="text-lg font-semibold">Consultor IA indisponível</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Houve uma falha local ao abrir o chat. Vou recriar as configurações e conversas locais de
          IA para recuperar o acesso.
        </p>
        {import.meta.env.DEV && this.state.error.message && (
          <pre className="max-w-xl overflow-auto rounded border border-border/40 bg-muted/20 p-3 text-left text-[11px] text-muted-foreground">
            {this.state.error.message}
          </pre>
        )}
        <Button variant="outline" onClick={this.recover}>
          Recriar chat local
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
      <AIViewContent
        state={state}
        simulatedState={simulatedState}
        simActive={simActive}
        simParams={simParams}
      />
    </AIViewBoundary>
  );
}

function AIViewContent({ state, simulatedState, simActive, simParams }: Props) {
  const {
    config,
    updateConfig,
    messages,
    input,
    setInput,
    streaming,
    attachments,
    removeAttachment,
    processingFile,
    threads,
    activeId,
    setActiveId,
    suggestions,
    simHasChanges,
    mode,
    setMode,
    handleAudit,
    runPipeline360,
    resumePipeline360,
    resetPipeline360,
    pipeline360,
    runConcilio,
    handleStop,
    send,
    handleFiles,
    handleNewThread,
    handleDeleteThread,
  } = useAIChat({ state, simulatedState, simActive, simParams });

  const [configOpen, setConfigOpen] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // Auto-scroll "inteligente": só puxa pra baixo se o usuário já está perto do fim.
  // Se rolou pra cima durante o streaming, mostra botão "voltar ao fim" e respeita a posição.
  const stickToBottomRef = useRef(true);

  const scrollToBottom = (smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  };

  // Detecta scroll do usuário: se afastar > 80px do fim, "desgruda".
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 80;
    stickToBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom && (streaming || messages.length > 0));
  };

  // Quando chegam novos tokens / mensagens, só auto-scroll se o usuário está colado no fim.
  useEffect(() => {
    if (!scrollRef.current) return;
    if (stickToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else if (streaming) {
      setShowJumpToBottom(true);
    }
  }, [messages, streaming]);

  const onFilesChange = async (files: FileList | null) => {
    await handleFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="sticky top-0 z-20 flex flex-row items-center justify-between border-b border-border/40 px-4 py-3 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Consultor Financeiro IA</h2>
          <div className="flex gap-2">
            <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {config.provider}
            </span>
            {mode !== "chat" && (
              <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {AI_MODE_LABELS[mode]}
              </span>
            )}
            {simHasChanges && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                simulação ativa
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleAudit}
            disabled={streaming || pipeline360.active}
            title="Auditoria rápida (relatório estruturado)"
          >
            <ShieldCheck className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowThreads((s) => !s)}>
            <MessageSquare className="h-4 w-4" />
          </Button>
          <MemoriesPopover company={state.companyName || "default"} />
          <Button variant="ghost" size="icon" onClick={() => setConfigOpen(true)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {showThreads && (
          <div className="w-64 border-r border-border/40 bg-card/10 overflow-y-auto p-4 space-y-2">
            <Button
              onClick={handleNewThread}
              variant="outline"
              className="w-full justify-start gap-2 mb-4"
            >
              <Plus className="h-4 w-4" /> Nova Conversa
            </Button>
            {threads.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-lg p-3 text-sm cursor-pointer transition-colors ${t.id === activeId ? "bg-primary/10 border border-primary/20" : "hover:bg-accent"}`}
                onClick={() => setActiveId(t.id)}
              >
                <span className="flex-1 truncate">{t.title}</span>
                <Trash2
                  className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteThread(t.id);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-6 space-y-6"
          >
            {messages.length === 0 ? (
              <div className="max-w-3xl mx-auto space-y-6">
                <div className="bg-card/30 rounded-xl p-6 border border-border/40">
                  <h3 className="text-lg font-medium mb-2">Como posso ajudar hoje?</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Eu analiso seus dados financeiros em tempo real. Posso identificar gargalos,
                    simular cenários de crescimento, auditar seu regime tributário e ajudar no
                    valuation.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {suggestions.map((s: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => void send(s)}
                      className="text-left text-sm p-4 rounded-lg border border-border/40 hover:bg-accent hover:border-primary/50 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.map((m, i) => {
                  // Tool call — card colapsado mostrando nome + payload em tempo real.
                  if (m.role === "tool") {
                    return <ToolCallCard key={i} name={m.toolName ?? "tool"} payload={m.content} />;
                  }
                  // Modo Auditor: relatório estruturado renderizado em card próprio.
                  if (m.role === "assistant" && isAuditReport(m.content)) {
                    return (
                      <div key={i} className="flex gap-4">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card border-border/40">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <AuditReport
                            content={m.content}
                            onCopy={handleCopy}
                            onAction={(p) => void send(p)}
                          />
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className={`flex gap-4 ${m.role === "user" ? "flex-row-reverse" : ""}`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg border ${m.role === "user" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border/40"}`}
                      >
                        {m.role === "user" ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div
                        className={`group relative flex flex-col gap-2 rounded-2xl px-5 py-3 text-sm max-w-[85%] min-w-0 overflow-hidden ${m.role === "user" ? "bg-primary/15 border border-primary/20" : "border border-border/60"}`}
                      >
                        <div className="prose prose-invert prose-sm max-w-none break-words [overflow-wrap:anywhere] prose-p:leading-relaxed prose-pre:bg-black/40 prose-pre:p-3 prose-pre:rounded-lg prose-pre:overflow-x-auto prose-pre:max-w-full prose-code:break-words">
                          <Suspense
                            fallback={<div className="h-20 animate-pulse bg-muted rounded" />}
                          >
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                // Intercepta ```finance-chart {json}``` e renderiza gráfico interativo.
                                code({
                                  className,
                                  children,
                                  ...props
                                }: React.ComponentProps<"code">) {
                                  const lang = /language-(\w+)/.exec(className || "")?.[1];
                                  if (lang === "finance-chart") {
                                    const spec = parseChartSpec(String(children).trim());
                                    if (spec) return <ChatChart spec={spec} />;
                                  }
                                  return (
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  );
                                },
                              }}
                            >
                              {m.content}
                            </ReactMarkdown>
                          </Suspense>
                        </div>
                        {m.role === "assistant" && m.verification && (
                          <VerificationFooter verification={m.verification} />
                        )}
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

          {showJumpToBottom && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => scrollToBottom(true)}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 shadow-lg rounded-full gap-1.5 border border-border/60"
            >
              <ChevronDown className="h-4 w-4" />
              {streaming ? "IA digitando — voltar ao fim" : "Voltar ao fim"}
            </Button>
          )}

          {(pipeline360.active || pipeline360.completed.length > 0) && (
            <div className="border-t border-border/40 bg-card/20 px-4 py-2">
              <div className="max-w-4xl mx-auto flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1 flex-wrap">
                  {(["cfo", "controller", "auditor"] as const).map((stage, i) => {
                    const done = pipeline360.completed.includes(stage);
                    const current = pipeline360.current === stage;
                    return (
                      <div key={stage} className="flex items-center gap-1.5">
                        <div
                          className={`h-2 w-2 rounded-full ${
                            done ? "bg-primary" : current ? "bg-primary animate-pulse" : "bg-muted"
                          }`}
                        />
                        <span
                          className={`text-xs ${
                            done || current ? "text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {AI_MODE_LABELS[stage]}
                        </span>
                        {i < 2 && <span className="text-muted-foreground text-xs">→</span>}
                      </div>
                    );
                  })}
                  {pipeline360.model && (
                    <Badge
                      variant="outline"
                      className={`ml-1 text-[10px] ${
                        pipeline360.usedPremium
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : ""
                      }`}
                      title={
                        pipeline360.usedFallback
                          ? "Premium não configurado — usando modelo base."
                          : pipeline360.usedPremium
                            ? "Executado com modelo premium."
                            : "Modelo base."
                      }
                    >
                      {pipeline360.usedPremium ? "Premium · " : ""}
                      {pipeline360.provider}/{pipeline360.model}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {pipeline360.active && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleStop}
                    >
                      Parar
                    </Button>
                  )}
                  {!pipeline360.active && pipeline360.aborted && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void resumePipeline360()}
                    >
                      Retomar
                    </Button>
                  )}
                  {!pipeline360.active && pipeline360.completed.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={resetPipeline360}
                    >
                      Reiniciar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-border/40 bg-card/30 p-4">
            <div className="max-w-4xl mx-auto space-y-3">
              <ScenarioBar company={state.companyName || "default"} simParams={simParams} />
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-1.5 bg-background border border-border/40 rounded-full pl-2.5 pr-1.5 py-1 text-[11px]"
                    >
                      <span className="truncate max-w-[120px]">{a.name}</span>
                      <button
                        onClick={() => removeAttachment(a.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative flex items-end gap-2 bg-background border border-border/60 rounded-xl px-3 py-2 shadow-inner focus-within:border-primary/50 transition-colors">
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  className="hidden"
                  onChange={(e) => void onFilesChange(e.target.files)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processingFile}
                >
                  {processingFile ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                </Button>
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder="Envie uma mensagem..."
                  className="min-h-[40px] max-h-48 resize-none bg-transparent border-0 focus-visible:ring-0 p-2 shadow-none scrollbar-thin"
                  rows={1}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => void runPipeline360(input)}
                  disabled={mode !== "board" || streaming || pipeline360.active}
                  title={
                    mode !== "board"
                      ? "Disponível no Modo Conselho (Board)"
                      : "Análise 360° (CFO → Controller → Auditor)"
                  }
                >
                  <Layers className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => void runConcilio(input)}
                  disabled={mode !== "board" || streaming || pipeline360.active}
                  title={
                    mode !== "board"
                      ? "Disponível no Modo Conselho (Board)"
                      : "Conselho Virtual — 3 especialistas em paralelo (CFO · Tributarista · Valuation)"
                  }
                >
                  <Users className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => void send(input)}
                  disabled={streaming || (!input.trim() && !attachments.length)}
                  size="icon"
                  className="h-9 w-9 shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Select value={mode} onValueChange={(v) => setMode(v as AIMode)}>
                  <SelectTrigger className="h-7 w-full text-xs" title="Modo de atuação">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AI_MODE_LABELS) as AIMode[]).map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">
                        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                          <span className="font-medium">{AI_MODE_LABELS[m]}</span>
                          <span className="text-[10px] text-muted-foreground">
                            — {AI_MODE_DESCRIPTIONS[m]}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AIConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        onSave={updateConfig}
      />
    </div>
  );
}

// Popover compacto: lista memórias persistentes salvas pela IA com
// botões de exclusão individual. Reativo via useMemories (localStorage).
function MemoriesPopover({ company }: { company: string }) {
  const items = useMemories(company);
  const [filter, setFilter] = useState<MemoryCategory | "todas">("todas");
  const [novoConteudo, setNovoConteudo] = useState("");
  const [novaCategoria, setNovaCategoria] = useState<MemoryCategory>("decisao");

  const filtradas = filter === "todas" ? items : items.filter((m) => m.categoria === filter);

  const adicionar = () => {
    const conteudo = novoConteudo.trim();
    if (!conteudo) return;
    createMemory(company, { conteudo, categoria: novaCategoria, fonte: "manual (consultor)" });
    setNovoConteudo("");
  };

  // Contadores por categoria para mostrar no filtro.
  const contar = (c: MemoryCategory) => items.filter((m) => m.categoria === c).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title={`Memórias persistentes (${items.length})`}>
          <Brain className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-h-[520px] overflow-y-auto">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Memória persistente</h4>
          <span className="text-xs text-muted-foreground">{items.length}/50</span>
        </div>

        {/* Quick-add: consultor registra decisões/hipóteses manualmente */}
        <div className="mb-3 space-y-2 rounded border border-border/40 p-2">
          <div className="text-[10px] uppercase text-muted-foreground">Registrar nova</div>
          <Input
            placeholder="Ex.: Cortar folha em 20% a partir de jan/2027"
            value={novoConteudo}
            onChange={(e) => setNovoConteudo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                adicionar();
              }
            }}
            className="h-8 text-xs"
          />
          <div className="flex gap-1">
            <Select
              value={novaCategoria}
              onValueChange={(v) => setNovaCategoria(v as MemoryCategory)}
            >
              <SelectTrigger className="h-8 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decisao">Decisão tomada</SelectItem>
                <SelectItem value="hipotese">Hipótese validada</SelectItem>
                <SelectItem value="premissa">Premissa</SelectItem>
                <SelectItem value="diagnostico">Diagnóstico</SelectItem>
                <SelectItem value="preferencia">Preferência</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={adicionar} disabled={!novoConteudo.trim()} className="h-8">
              Salvar
            </Button>
          </div>
        </div>

        {/* Filtros por categoria */}
        <div className="mb-2 flex flex-wrap gap-1">
          {(
            [
              "todas",
              "decisao",
              "hipotese",
              "premissa",
              "diagnostico",
              "preferencia",
              "outro",
            ] as const
          ).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                filter === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {c} {c !== "todas" && `(${contar(c as MemoryCategory)})`}
            </button>
          ))}
        </div>

        {filtradas.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma memória nesta categoria. Registre decisões já tomadas, hipóteses validadas ou
            premissas — a IA usará isso como ponto de partida nas próximas conversas.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtradas.map((m) => (
              <li
                key={m.id}
                className="rounded border border-border/40 p-2 text-xs flex gap-2 items-start"
              >
                <div className="flex-1">
                  <div className="text-[10px] uppercase text-muted-foreground">{m.categoria}</div>
                  <div>{m.conteudo}</div>
                  {m.fonte && (
                    <div className="mt-1 text-[10px] text-muted-foreground">fonte: {m.fonte}</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => deleteMemory(company, m.id)}
                  title="Remover memória"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Card de tool call em tempo real — mostra nome + payload colapsável.
// Streamed via onProgress no useAIChat: cada tool aparece imediatamente
// que o engine retorna o resultado, antes do assistant final consolidar.
function ToolCallCard({ name, payload }: { name: string; payload: string }) {
  const [open, setOpen] = useState(false);
  const chars = payload?.length ?? 0;
  return (
    <div className="flex gap-4 animate-in fade-in duration-300">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40 border-border/40">
        <Wrench className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0 rounded-lg border border-border/40 bg-card/40 text-xs">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent/40 rounded-lg"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <code className="font-mono text-[11px] text-primary">{name}</code>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {chars > 0 ? `${chars.toLocaleString("pt-BR")} chars` : "executando…"}
          </span>
        </button>
        {open && (
          <pre className="max-h-80 overflow-auto border-t border-border/40 bg-background/60 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono">
            {payload || "_(sem retorno)_"}
          </pre>
        )}
      </div>
    </div>
  );
}
