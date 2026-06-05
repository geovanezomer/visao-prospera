import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { AIConfig, Provider, switchProvider } from "@/services/ai/providers";
import { listModels, testConnection } from "@/services/ai/client";

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

  useEffect(() => { if (open) { setDraft(config); setTestResult(null); } }, [open, config]);

  const refreshModels = async (cfg: AIConfig) => {
    setLoadingModels(true);
    try { setModels(await listModels(cfg)); } catch { setModels([]); }
    finally { setLoadingModels(false); }
  };

  useEffect(() => { if (open) void refreshModels(draft); /* eslint-disable-next-line */ }, [open, draft.baseUrl, draft.apiKey]);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    setTestResult(await testConnection(draft));
    setTesting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Configurar Consultor IA</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provedor</Label>
            <Select value={draft.provider} onValueChange={(v) => setDraft(switchProvider(draft, v as Provider))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lmstudio">LM Studio (local)</SelectItem>
                <SelectItem value="openai">OpenAI (API)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {draft.provider === "openai" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-300 flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Ao usar OpenAI, seus dados financeiros são enviados para <b>api.openai.com</b>. Para 100% local, escolha LM Studio.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
          </div>

          {draft.provider === "openai" && (
            <>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input type="password" placeholder="sk-..." value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/40 p-2.5">
                <div>
                  <Label className="text-xs">Persistir chave no navegador</Label>
                  <p className="text-[10px] text-muted-foreground">Se desligado, a chave fica apenas na sessão atual.</p>
                </div>
                <Switch checked={draft.persistKey} onCheckedChange={(v) => setDraft({ ...draft, persistKey: v })} />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Modelo {loadingModels && <Loader2 className="inline h-3 w-3 animate-spin" />}</Label>
            {models.length > 0 ? (
              <Select value={draft.model} onValueChange={(v) => setDraft({ ...draft, model: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Temperatura: {draft.temperature.toFixed(2)}</Label>
              <Slider value={[draft.temperature]} min={0} max={1.5} step={0.05} onValueChange={([v]) => setDraft({ ...draft, temperature: v })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Timeout (s): {Math.round(draft.timeoutMs / 1000)}</Label>
              <Slider value={[draft.timeoutMs / 1000]} min={15} max={300} step={5} onValueChange={([v]) => setDraft({ ...draft, timeoutMs: v * 1000 })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Limite tokens snapshot: {draft.maxTokensSnapshot}</Label>
            <Slider value={[draft.maxTokensSnapshot]} min={1500} max={20000} step={500} onValueChange={([v]) => setDraft({ ...draft, maxTokensSnapshot: v })} />
            <p className="text-[10px] text-muted-foreground">Modelos pequenos: 2k–4k. GPT-4o-mini: 12k+. Modelos locais 32k+: 16k–20k.</p>
          </div>

          <div className="space-y-2 rounded-md border border-border/40 p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Incluir snapshot completo</Label>
                <p className="text-[11px] text-muted-foreground">Manda toda a base no contexto inicial.</p>
              </div>
              <Switch checked={draft.includeSnapshot} onCheckedChange={(v) => setDraft({ ...draft, includeSnapshot: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Tool calling (snapshot sob demanda)</Label>
                <p className="text-[11px] text-muted-foreground">A IA chama funções para buscar só o que precisa. Requer modelo com suporte (GPT-4o, Qwen2.5+, Llama 3.1+).</p>
              </div>
              <Switch checked={draft.useTools} onCheckedChange={(v) => setDraft({ ...draft, useTools: v })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Instruções extras (suplemento do system prompt)</Label>
            <Textarea
              rows={3}
              placeholder="Ex.: foque em empresas de tecnologia · responda sempre com 3 bullets · etc."
              value={draft.extraSystemPrompt}
              onChange={(e) => setDraft({ ...draft, extraSystemPrompt: e.target.value })}
              className="text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Testar conexão
            </Button>
            {testResult && (
              <span className={`flex items-center gap-1 text-xs ${testResult.ok ? "text-green-500" : "text-destructive"}`}>
                {testResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {testResult.message}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => { onSave(draft); onOpenChange(false); }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
