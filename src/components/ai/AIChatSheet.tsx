import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Settings, Trash2, Send, Loader2, Bot, User } from "lucide-react";
import { AIConfigDialog } from "./AIConfigDialog";
import { AIConfig, ChatMessage, clearHistory, loadConfig, loadHistory, saveConfig, saveHistory } from "@/services/ai/providers";
import { streamChat, type LLMMessage } from "@/services/ai/client";
import { buildSnapshot } from "@/services/ai/snapshot";
import { buildSystemPrompt } from "@/services/ai/systemPrompt";
import type { AppState } from "@/lib/finance/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: AppState;
}

const SUGGESTIONS = [
  "Qual o VPL do meu negócio e o que ele significa na prática?",
  "Por que o caixa fica negativo? Em que mês? Quanto preciso aportar?",
  "Meu DSCR e cobertura de juros são saudáveis?",
  "Onde estão meus maiores custos fixos e o que cortar primeiro?",
  "Compare meu EBITDA com a média do setor — estou bem?",
  "Que ações me dariam o maior impacto no valuation?",
];

export function AIChatSheet({ open, onOpenChange, state }: Props) {
  const [config, setConfig] = useState<AIConfig>(() => loadConfig());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(state.companyName));
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recarrega histórico ao trocar de empresa
  useEffect(() => { setMessages(loadHistory(state.companyName)); }, [state.companyName]);

  // Persiste
  useEffect(() => { saveHistory(state.companyName, messages); }, [messages, state.companyName]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const snapshot = useMemo(() => {
    if (!config.includeSnapshot) return "";
    try { return buildSnapshot(state); } catch { return ""; }
  }, [state, config.includeSnapshot]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;

    const userMsg: ChatMessage = { role: "user", content, ts: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);

    const systemPrompt = buildSystemPrompt(snapshot, config.includeSnapshot);
    const llmMessages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      ...next.map(m => ({ role: m.role, content: m.content }) as LLMMessage),
    ];

    const ac = new AbortController();
    abortRef.current = ac;

    let acc = "";
    setMessages([...next, { role: "assistant", content: "", ts: Date.now() }]);

    try {
      for await (const delta of streamChat(config, llmMessages, ac.signal)) {
        acc += delta;
        setMessages(prev => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc, ts: Date.now() };
          return copy;
        });
      }
    } catch (e: any) {
      const errMsg = e?.name === "AbortError"
        ? "_(geração interrompida)_"
        : `**Erro ao conectar:** ${e?.message || e}\n\nVerifique a configuração da IA (⚙️).`;
      setMessages(prev => {
        const copy = prev.slice();
        copy[copy.length - 1] = { role: "assistant", content: (acc ? acc + "\n\n" : "") + errMsg, ts: Date.now() };
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleClear = () => {
    clearHistory(state.companyName);
    setMessages([]);
  };

  const handleStop = () => abortRef.current?.abort();

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[460px]">
          <SheetHeader className="flex flex-row items-center justify-between border-b border-border/40 px-4 py-3 space-y-0">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <SheetTitle className="text-sm">Consultor IA</SheetTitle>
              <span className="rounded-md border border-border/40 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {config.provider}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfigOpen(true)} title="Configurar">
                <Settings className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClear} title="Limpar histórico">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Pergunte qualquer coisa sobre os números desta empresa. A IA lê DRE, fluxo de caixa, indicadores, valuation e diagnóstico em tempo real.
                </p>
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sugestões</p>
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => void send(s)}
                      className="block w-full rounded-md border border-border/40 px-3 py-2 text-left text-xs hover:bg-muted/40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                    {m.role === "assistant" && <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                    <div className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : "prose prose-sm prose-invert max-w-none flex-1 text-sm"
                    }>
                      {m.role === "assistant"
                        ? <ReactMarkdown>{m.content || "_…_"}</ReactMarkdown>
                        : <span className="whitespace-pre-wrap">{m.content}</span>}
                    </div>
                    {m.role === "user" && <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  </div>
                ))}
                {streaming && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> pensando…
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
                <Button variant="outline" size="icon" onClick={handleStop} title="Parar">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </Button>
              ) : (
                <Button size="icon" onClick={() => void send(input)} disabled={!input.trim()} title="Enviar (Enter)">
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Enter envia · Shift+Enter quebra linha · {config.includeSnapshot ? "snapshot ativo" : "snapshot desativado"}
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
