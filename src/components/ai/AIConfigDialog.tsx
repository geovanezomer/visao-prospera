import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
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
    try {
      const list = await listModels(cfg);
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => { if (open) void refreshModels(draft); /* eslint-disable-next-line */ }, [open, draft.baseUrl, draft.apiKey]);

  const handleProvider = (p: Provider) => setDraft(d => switchProvider(d, p));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testConnection(draft);
    setTestResult(res);
    setTesting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar IA</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provedor</Label>
            <Select value={draft.provider} onValueChange={(v) => handleProvider(v as Provider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lmstudio">LM Studio (local)</SelectItem>
                <SelectItem value="openai">OpenAI (API)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
          </div>

          {draft.provider === "openai" && (
            <div className="space-y-1.5">
              <Label>API Key (sk-...)</Label>
              <Input
                type="password"
                placeholder="sk-..."
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">Armazenada no localStorage deste navegador (uso local).</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Modelo {loadingModels && <Loader2 className="inline h-3 w-3 animate-spin" />}</Label>
            {models.length > 0 ? (
              <Select value={draft.model} onValueChange={(v) => setDraft({ ...draft, model: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Temperatura: {draft.temperature.toFixed(2)}</Label>
            <Slider
              value={[draft.temperature]}
              min={0} max={1.5} step={0.05}
              onValueChange={([v]) => setDraft({ ...draft, temperature: v })}
            />
            <p className="text-[11px] text-muted-foreground">Baixa (0.1–0.3) = respostas precisas. Alta = mais criativa.</p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/40 p-3">
            <div>
              <Label className="text-sm">Incluir snapshot dos dados</Label>
              <p className="text-[11px] text-muted-foreground">A IA recebe DRE, indicadores, fluxo, valuation e diagnóstico.</p>
            </div>
            <Switch checked={draft.includeSnapshot} onCheckedChange={(v) => setDraft({ ...draft, includeSnapshot: v })} />
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
