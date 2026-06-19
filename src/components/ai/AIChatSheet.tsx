import { lazy, Suspense, useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Settings,
  Trash2,
  Send,
  Loader2,
  Bot,
  User,
  Plus,
  MessageSquare,
  RefreshCcw,
  Copy,
  Download,
  ChevronDown,
  ChevronRight,
  Wrench,
  Edit2,
  Sparkles,
  Square,
  Paperclip,
  FileText,
  ImageIcon,
  X,
} from "lucide-react";
import { AIConfigDialog } from "./AIConfigDialog";
import { renameThread, type ChatMessage } from "@/engines/ai/providers";
import { confidenceLabel, MAX_FILES_PER_MSG } from "@/engines/ai/attachments";
import { AuditReport, isAuditReport } from "./AuditReport";
import type { AppState } from "@/engines/finance/types";
import type { SimulatorParams } from "@/engines/finance/simulator";
import { toast } from "sonner";
import { useAIChat } from "@/hooks/useAIChat";
import { AI_MODE_LABELS, AI_MODE_DESCRIPTIONS, type AIMode } from "@/engines/ai/systemPrompt";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ReactMarkdown = lazy(() => import("react-markdown"));

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
  simParams?: SimulatorParams;
}

export function AIChatSheet({
  open,
  onOpenChange,
  state,
  simulatedState,
  simActive,
  simParams,
}: Props) {
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
    processingMsg,
    threads,
    activeId,
    setActiveId,
    suggestions,
    simHasChanges,
    send,
    handleFiles,
    handleStop,
    handleRegenerate,
    handleEditLast,
    handleAudit,
    runPipeline360,
    resumePipeline360,
    resetPipeline360,
    pipeline360,
    handleNewThread,
    handleDeleteThread,
    reloadThreads,
    mode,
    setMode,
    activeSkillId,
    setActiveSkillId,
  } = useAIChat({ state, simulatedState, simActive, simParams });

  const [configOpen, setConfigOpen] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === Auto-scroll ===
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const handleRename = (id: string) => {
    if (!renameVal.trim()) {
      setRenamingId(null);
      return;
    }
    renameThread(state.companyName, id, renameVal.trim());
    reloadThreads();
    setRenamingId(null);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copiado."),
      () => toast.error("Falha ao copiar."),
    );
  };

  const handleExport = () => {
    const t = threads.find((t) => t.id === activeId);
    const md =
      `# ${t?.title || "Conversa"} — ${state.companyName}\n\n` +
      messages
        .map((m) => {
          const who =
            m.role === "user" ? "**Você**" : m.role === "tool" ? `**🔧 ${m.toolName}**` : "**IA**";
          return `${who}\n\n${m.content}`;
        })
        .join("\n\n---\n\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${state.companyName || "empresa"}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const onFilesChange = async (files: FileList | null) => {
    await handleFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          hideCloseButton
          className="relative flex w-full flex-col overflow-hidden p-0 sm:max-w-[520px]"
        >
          <SheetHeader className="flex flex-row items-center justify-between border-b border-border/40 px-3 py-2.5 space-y-0">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-4 w-4 text-primary shrink-0" />
              <SheetTitle className="text-sm truncate">Consultor IA</SheetTitle>
              <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground shrink-0">
                {config.provider}
                {config.useTools ? "+tools" : ""}
              </span>
              {simHasChanges && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300 shrink-0">
                  sim ativo
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <Select value={mode} onValueChange={(v) => setMode(v as AIMode)}>
                <SelectTrigger
                  className="h-7 w-[130px] text-xs mr-1"
                  title="Modo de atuação"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {(Object.keys(AI_MODE_LABELS) as AIMode[]).map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">
                      <div className="flex flex-col">
                        <span className="font-medium">{AI_MODE_LABELS[m]}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {AI_MODE_DESCRIPTIONS[m]}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowThreads((s) => !s)}
                title="Conversas"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleNewThread}
                title="Nova conversa"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleAudit}
                title="Modo auditor"
                disabled={streaming}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
              {mode === "board" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] font-semibold"
                  onClick={() => void runPipeline360()}
                  title="Análise 360° — encadeia CFO → Controller → Auditor"
                  disabled={streaming}
                >
                  360°
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleExport}
                title="Exportar markdown"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setConfigOpen(true)}
                title="Configurar"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </div>
          </SheetHeader>

          {showThreads && (
            <div className="border-b border-border/40 bg-muted/20 max-h-48 overflow-y-auto p-2 space-y-1">
              {threads.length === 0 && (
                <p className="text-[11px] text-muted-foreground px-2">Sem conversas.</p>
              )}
              {threads.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${t.id === activeId ? "bg-primary/10" : "hover:bg-muted/40"}`}
                >
                  {renamingId === t.id ? (
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={() => handleRename(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(t.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-6 text-xs flex-1"
                    />
                  ) : (
                    <button className="flex-1 text-left truncate" onClick={() => setActiveId(t.id)}>
                      {t.title}
                    </button>
                  )}
                  <button
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="Renomear"
                    onClick={() => {
                      setRenamingId(t.id);
                      setRenameVal(t.title);
                    }}
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                  <button
                    className="p-0.5 text-muted-foreground hover:text-destructive"
                    title="Excluir"
                    onClick={() => handleDeleteThread(t.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(pipeline360.active ||
            (pipeline360.aborted && pipeline360.completed.length < pipeline360.total)) && (
            <div className="border-b border-primary/30 bg-primary/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-medium">
                  {pipeline360.active ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  ) : (
                    <Square className="h-3 w-3 text-amber-400" />
                  )}
                  <span>
                    Pipeline 360° · {pipeline360.completed.length}/{pipeline360.total}
                    {!pipeline360.active && pipeline360.aborted && " · cancelado"}
                  </span>
                </div>
                {pipeline360.active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                    onClick={handleStop}
                    title="Cancelar pipeline"
                  >
                    <Square className="mr-1 h-2.5 w-2.5" /> Cancelar
                  </Button>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-primary hover:text-primary"
                      onClick={() => void resumePipeline360()}
                      title="Retomar a partir da próxima etapa"
                    >
                      <RefreshCcw className="mr-1 h-2.5 w-2.5" /> Continuar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                      onClick={resetPipeline360}
                      title="Limpar estado e começar do zero"
                    >
                      <Trash2 className="mr-1 h-2.5 w-2.5" /> Limpar
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {(["cfo", "controller", "auditor"] as const).map((s) => {
                  const done = pipeline360.completed.includes(s);
                  const current = pipeline360.current === s;
                  const cls = done
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                    : current
                      ? "border-primary/50 bg-primary/10 text-primary animate-pulse"
                      : "border-border/40 bg-muted/20 text-muted-foreground";
                  return (
                    <div
                      key={s}
                      className={`flex-1 rounded border px-1.5 py-0.5 text-center text-[10px] uppercase ${cls}`}
                    >
                      {done ? "✓ " : current ? "▶ " : ""}
                      {s}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">

            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Pergunte qualquer coisa sobre os números desta empresa. A IA tem acesso ao DRE,
                  fluxo de caixa, indicadores, valuation, saúde, diagnóstico{" "}
                  {config.useTools ? "via tool-calling sob demanda" : "via snapshot completo"}.
                </p>
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Sugestões
                  </p>
                  {suggestions.map((s: string, i: number) => (
                    <button
                      key={i}
                      onClick={() => void send(s)}
                      className="block w-full rounded-md border border-border/40 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40"
                    >
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
                {!streaming && messages.some((m) => m.role === "assistant") && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleRegenerate}
                    >
                      <RefreshCcw className="mr-1 h-3 w-3" /> Regenerar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleEditLast}
                    >
                      <Edit2 className="mr-1 h-3 w-3" /> Editar última
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/40 p-3">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a) => {
                  const conf = a.ocrUsed ? confidenceLabel(a.ocrConfidence) : null;
                  const confCls =
                    conf?.tone === "bad"
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : conf?.tone === "warn"
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
                  return (
                    <div
                      key={a.id}
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${a.error ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border/40 bg-muted/30"}`}
                    >
                      {a.type === "image" ? (
                        <ImageIcon className="h-3 w-3" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      <span className="max-w-[140px] truncate">{a.name}</span>
                      <span className="text-muted-foreground">{Math.round(a.size / 1024)}kb</span>
                      {conf && (
                        <span
                          className={`rounded px-1 text-[10px] border ${confCls}`}
                          title="Confiança do OCR"
                        >
                          OCR · {conf.label}
                        </span>
                      )}
                      <button
                        onClick={() => removeAttachment(a.id)}
                        className="ml-0.5 hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {processingFile && processingMsg && (
              <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{processingMsg}</span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => void onFilesChange(e.target.files)}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming || processingFile || attachments.length >= MAX_FILES_PER_MSG}
                title={`Anexar imagem ou PDF (máx ${MAX_FILES_PER_MSG})`}
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
                onKeyDown={onKey}
                placeholder="Pergunte sobre DRE, caixa, valuation, riscos… ou anexe um balancete/print"
                rows={2}
                className="min-h-[44px] resize-none text-sm"
                disabled={streaming}
              />
              {streaming ? (
                <Button variant="outline" size="icon" onClick={handleStop} title="Parar">
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={() => void send(input)}
                  disabled={!input.trim() && attachments.length === 0}
                  title="Enviar (Enter)"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Enter envia · Shift+Enter quebra linha ·{" "}
              {config.useTools
                ? "tools ativo"
                : config.includeSnapshot
                  ? "snapshot ativo"
                  : "sem snapshot"}
              {simHasChanges ? " · cenário simulado incluído" : ""}
            </p>
          </div>

          <AIConfigDialog
            open={configOpen}
            onOpenChange={setConfigOpen}
            config={config}
            onSave={updateConfig}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function MessageView({ msg, onCopy }: { msg: ChatMessage; onCopy: (s: string) => void }) {
  const [open, setOpen] = useState(false);

  if (msg.role === "tool") {
    return (
      <div className="rounded border border-border/30 bg-muted/20 text-xs">
        <button
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Wrench className="h-3 w-3 text-primary" />
          <span className="font-mono text-[11px]">{msg.toolName}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {msg.content.length} chars
          </span>
        </button>
        {open && (
          <pre className="border-t border-border/30 px-2 py-2 text-[10px] whitespace-pre-wrap overflow-x-auto">
            {msg.content}
          </pre>
        )}
      </div>
    );
  }

  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
          {msg.content}
        </div>
        <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    );
  }

  // Modo Auditor: relatório estruturado renderizado em card próprio.
  if (isAuditReport(msg.content)) {
    return (
      <div className="flex gap-2 group">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <AuditReport content={msg.content} onCopy={onCopy} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 group">
      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm prose-invert max-w-none text-sm break-words">
          <Suspense
            fallback={<div className="text-xs text-muted-foreground">{msg.content || "…"}</div>}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "_…_"}</ReactMarkdown>
          </Suspense>
        </div>
        {msg.content && (
          <button
            className="mt-1 opacity-0 group-hover:opacity-100 transition text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            onClick={() => onCopy(msg.content)}
          >
            <Copy className="h-3 w-3" /> copiar
          </button>
        )}
      </div>
    </div>
  );
}
