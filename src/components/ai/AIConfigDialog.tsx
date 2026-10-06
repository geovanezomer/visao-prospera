import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  Plus,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  AIConfig,
  Provider,
  switchProvider,
  DEFAULT_SOUL,
  DEFAULT_SKILLS,
  Skill,
} from "@/engines/ai/providers";
import { listModels, testConnection } from "@/engines/ai/client";
import { fmtNum } from "@/engines/finance/format";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: AIConfig;
  onSave: (cfg: AIConfig) => void;
}

export function AIConfigDialog({ open, onOpenChange, config, onSave }: Props) {
  const [draft, setDraft] = useState<AIConfig>(config);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
    }
  }, [open, config]);

  const refreshModels = async (cfg: AIConfig) => {
    setLoadingModels(true);
    try {
      setModels(await listModels(cfg));
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (open) void refreshModels(draft); /* eslint-disable-next-line */
  }, [open, draft.baseUrl, draft.apiKey]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestResult(await testConnection(draft));
    setTesting(false);
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Configurar Consultor IA</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onOpenChange(false)}
          title="Fechar configurações"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label>Provedor</Label>
          <Select
            value={draft.provider}
            onValueChange={(v) => setDraft(switchProvider(draft, v as Provider))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
              <SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>
              <SelectItem value="lmstudio">LM Studio (local)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Base URL</Label>
          <Input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
        </div>

        {(draft.provider === "openai" || draft.provider === "anthropic") && (
          <>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder={draft.provider === "openai" ? "sk-..." : "sk-ant-..."}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
              {draft.provider === "anthropic" && (
                <p className="text-[10px] text-muted-foreground">
                  Crie uma chave em{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    console.anthropic.com → Settings → API Keys
                  </a>
                  .
                </p>
              )}
              {draft.provider === "openai" && (
                <p className="text-[10px] text-muted-foreground">
                  Não tem uma chave? Crie em{" "}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    platform.openai.com/api-keys
                  </a>
                  . Faça login, clique em <em>Create new secret key</em>, copie o valor (começa com{" "}
                  <code>sk-</code>) e cole aqui. Requer crédito ativo na conta OpenAI.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/40 p-2.5">
              <div>
                <Label className="text-xs">Persistir chave no navegador</Label>
                <p className="text-[10px] text-muted-foreground">
                  Se desligado, a chave fica apenas na sessão atual.
                </p>
              </div>
              <Switch
                checked={draft.persistKey}
                onCheckedChange={(v) => setDraft({ ...draft, persistKey: v })}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label>
            Modelo {loadingModels && <Loader2 className="inline h-3 w-3 animate-spin" />}
          </Label>
          {models.length > 0 ? (
            <Select value={draft.model} onValueChange={(v) => setDraft({ ...draft, model: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          )}
        </div>

        {/* ─── Modelo Premium (opcional) — roteado para Diagnóstico, 360° e relatórios ─── */}
        <details className="rounded-md border border-border/40 p-2.5 open:pb-3">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            Modelo Premium (opcional)
            {draft.premium?.model && (
              <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                {draft.premium.provider} · {draft.premium.model}
              </span>
            )}
          </summary>
          <div className="mt-3 space-y-2.5">
            <p className="text-[11px] text-muted-foreground">
              Usado apenas no <strong>Diagnóstico Executivo</strong>, <strong>Análise 360°</strong>{" "}
              e <strong>relatórios</strong>. O chat e as ferramentas continuam no modelo principal
              para preservar custo e latência. Vazio = tudo usa o modelo principal.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Provider</Label>
                <Select
                  value={draft.premium?.provider ?? "openai"}
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      premium: {
                        provider: v as Provider,
                        model: draft.premium?.model ?? "",
                        apiKey: draft.premium?.apiKey,
                        baseUrl: draft.premium?.baseUrl,
                      },
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="lmstudio">LM Studio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Modelo</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="gpt-5, claude-opus-4-...,"
                  value={draft.premium?.model ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      premium: {
                        provider: draft.premium?.provider ?? "openai",
                        model: e.target.value,
                        apiKey: draft.premium?.apiKey,
                        baseUrl: draft.premium?.baseUrl,
                      },
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">
                API Key (opcional — herda da principal se vazio)
              </Label>
              <Input
                className="h-8 text-xs"
                type="password"
                placeholder="sk-..."
                value={draft.premium?.apiKey ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    premium: draft.premium
                      ? { ...draft.premium, apiKey: e.target.value || undefined }
                      : {
                          provider: "openai",
                          model: "",
                          apiKey: e.target.value || undefined,
                        },
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Base URL (opcional)</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Herda da config principal"
                value={draft.premium?.baseUrl ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    premium: draft.premium
                      ? { ...draft.premium, baseUrl: e.target.value || undefined }
                      : {
                          provider: "openai",
                          model: "",
                          baseUrl: e.target.value || undefined,
                        },
                  })
                }
              />
            </div>
            {draft.premium && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-[11px] text-muted-foreground"
                onClick={() => setDraft({ ...draft, premium: undefined })}
              >
                <Trash2 className="h-3 w-3" />
                Remover configuração premium
              </Button>
            )}
          </div>
        </details>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Temperatura: {fmtNum(draft.temperature, 2)}</Label>
            <Slider
              value={[draft.temperature]}
              min={0}
              max={1.5}
              step={0.05}
              onValueChange={([v]) => setDraft({ ...draft, temperature: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Timeout (s): {Math.round(draft.timeoutMs / 1000)}</Label>
            <Slider
              value={[draft.timeoutMs / 1000]}
              min={15}
              max={300}
              step={5}
              onValueChange={([v]) => setDraft({ ...draft, timeoutMs: v * 1000 })}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">
              Sugestões dinâmicas na tela inicial: {draft.maxSuggestions ?? 6}
            </Label>
            <Slider
              value={[draft.maxSuggestions ?? 6]}
              min={4}
              max={6}
              step={1}
              onValueChange={([v]) => setDraft({ ...draft, maxSuggestions: v })}
            />
            <p className="text-[10px] text-muted-foreground">
              Quantas perguntas contextualizadas (baseadas no diagnóstico) aparecem antes da
              primeira mensagem.
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-border/40 p-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Incluir snapshot completo</Label>
              <p className="text-[11px] text-muted-foreground">
                Manda toda a base no contexto inicial.
              </p>
            </div>
            <Switch
              checked={draft.includeSnapshot}
              onCheckedChange={(v) => setDraft({ ...draft, includeSnapshot: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Tool calling (snapshot sob demanda)</Label>
              <p className="text-[11px] text-muted-foreground">
                A IA chama funções para buscar só o que precisa. Requer modelo com suporte (GPT-4o,
                Qwen2.5+, Llama 3.1+).
              </p>
            </div>
            <Switch
              checked={draft.useTools}
              onCheckedChange={(v) => setDraft({ ...draft, useTools: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Meta-tools (tool deferral)</Label>
              <p className="text-[11px] text-muted-foreground">
                Expõe só <code>tool_search</code>/<code>tool_invoke</code> ao LLM em vez de 27+
                tools. Reduz drasticamente tokens de prompt e devolve JSON estruturado. Desligue
                para fallback ao registry completo.
              </p>
            </div>
            <Switch
              checked={draft.useMetaTools}
              disabled={!draft.useTools}
              onCheckedChange={(v) => setDraft({ ...draft, useMetaTools: v })}
            />
          </div>
        </div>

        {/* SOUL — identidade editável do agente */}
        <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">🧠 SOUL — Identidade do agente</Label>
              <p className="text-[10px] text-muted-foreground">
                Quem o agente É. Substitui a persona padrão (CFO + Tributarista + Matemático).
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => setDraft({ ...draft, soul: DEFAULT_SOUL })}
              title="Restaurar SOUL padrão"
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Padrão
            </Button>
          </div>
          <Textarea
            rows={6}
            value={draft.soul}
            onChange={(e) => setDraft({ ...draft, soul: e.target.value })}
            className="text-xs font-mono"
          />
        </div>

        {/* SKILLS — capacidades modulares com toggle */}
        <SkillsEditor skills={draft.skills} onChange={(skills) => setDraft({ ...draft, skills })} />

        <div className="space-y-1.5">
          <Label className="text-xs">Instruções extras (suplemento livre)</Label>
          <Textarea
            rows={3}
            placeholder="Ex.: foque em empresas de tecnologia · responda sempre com 3 bullets · etc."
            value={draft.extraSystemPrompt}
            onChange={(e) => setDraft({ ...draft, extraSystemPrompt: e.target.value })}
            className="text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Testar conexão
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Salvar e fechar
          </Button>
          {testResult && (
            <span
              className={`flex items-center gap-1 text-xs ${testResult.ok ? "text-green-500" : "text-destructive"}`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border/40 px-4 py-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          onClick={() => {
            onSave(draft);
            onOpenChange(false);
          }}
        >
          Salvar
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// SkillsEditor — lista de skills com toggle on/off, edição inline e CRUD.
// ============================================================
function SkillsEditor({ skills, onChange }: { skills: Skill[]; onChange: (s: Skill[]) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) =>
    onChange(skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  const update = (id: string, patch: Partial<Skill>) =>
    onChange(skills.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const remove = (id: string) => onChange(skills.filter((s) => s.id !== id));

  const add = () => {
    const id = `custom-${Date.now()}`;
    onChange([
      ...skills,
      { id, name: "Nova skill", description: "", body: "", enabled: true, builtin: false },
    ]);
    setExpanded(id);
  };

  const resetToDefaults = () => {
    // mantém customizadas e substitui as builtin pelas padrões
    const customs = skills.filter((s) => !s.builtin);
    onChange([...DEFAULT_SKILLS, ...customs]);
  };

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">⚡ SKILLS — Capacidades modulares</Label>
          <p className="text-[10px] text-muted-foreground">
            O que o agente SABE FAZER. Ative só o que precisa para a conversa.
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px]"
            onClick={resetToDefaults}
            title="Restaurar skills padrão"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Padrão
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={add}>
            <Plus className="h-3 w-3 mr-1" /> Nova
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        {skills.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">Nenhuma skill configurada.</p>
        )}
        {skills.map((s) => {
          const open = expanded === s.id;
          return (
            <div key={s.id} className="rounded border border-border/40 bg-background/50">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : s.id)}
                  className="text-muted-foreground hover:text-foreground"
                  title={open ? "Recolher" : "Editar"}
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{s.description}</div>
                </div>
                <Switch checked={s.enabled} onCheckedChange={() => toggle(s.id)} />
                {!s.builtin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => remove(s.id)}
                    title="Remover"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                )}
              </div>
              {open && (
                <div className="space-y-2 border-t border-border/30 p-2">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Nome
                    </Label>
                    <Input
                      value={s.name}
                      onChange={(e) => update(s.id, { name: e.target.value })}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Descrição (1 linha)
                    </Label>
                    <Input
                      value={s.description}
                      onChange={(e) => update(s.id, { description: e.target.value })}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Conteúdo (anexado ao system prompt quando ativa)
                    </Label>
                    <Textarea
                      rows={6}
                      value={s.body}
                      onChange={(e) => update(s.id, { body: e.target.value })}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
