// ============================================================================
// ProviderTab — Stripe/Asaas keys + toggle ativo.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Power, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listProviders,
  upsertProvider,
  setActiveProvider,
  testProviderConnection,
  type ProviderRow,
} from "@/lib/admin/providers.functions";

function copy(t: string) {
  navigator.clipboard
    .writeText(t)
    .then(() => toast.success("Copiado."))
    .catch(() => {});
}

export function ProviderTab() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<
    Record<string, { apiKey: string; webhookSecret: string; mode: "test" | "live" }>
  >({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listProviders();
      setRows(r.rows);
      const e: Record<string, { apiKey: string; webhookSecret: string; mode: "test" | "live" }> =
        {};
      for (const row of r.rows) e[row.provider] = { apiKey: "", webhookSecret: "", mode: row.mode };
      setEdits(e);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (p: "stripe" | "asaas") => {
    setBusy(p);
    try {
      const e = edits[p];
      await upsertProvider({
        data: {
          provider: p,
          mode: e.mode,
          apiKey: e.apiKey || undefined,
          webhookSecret: e.webhookSecret || undefined,
        },
      });
      toast.success(`${p} salvo.`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha.");
    } finally {
      setBusy(null);
    }
  };
  const activate = async (p: "stripe" | "asaas") => {
    setBusy(p);
    try {
      await setActiveProvider({ data: { provider: p } });
      toast.success(`${p} ativado.`);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha.");
    } finally {
      setBusy(null);
    }
  };
  const test = async (p: "stripe" | "asaas") => {
    setBusy(p);
    try {
      const r = await testProviderConnection({ data: { provider: p } });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha.");
    } finally {
      setBusy(null);
    }
  };

  if (loading)
    return (
      <div className="p-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
        Apenas <strong>1 provider</strong> pode estar ativo por vez. Trocar afeta novos checkouts
        imediatamente (cache 60s).
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          const e = edits[row.provider] ?? { apiKey: "", webhookSecret: "", mode: "test" as const };
          const webhookUrl = `${origin}/api/public/payments/webhook/${row.provider}`;
          return (
            <section
              key={row.provider}
              className="space-y-3 rounded-lg border border-border/60 bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize">{row.provider}</h3>
                {row.isActive ? (
                  <Badge
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                    variant="outline"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Ativo
                  </Badge>
                ) : (
                  <Badge variant="outline">Inativo</Badge>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Modo</Label>
                <Select
                  value={e.mode}
                  onValueChange={(v) =>
                    setEdits({ ...edits, [row.provider]: { ...e, mode: v as "test" | "live" } })
                  }
                >
                  <SelectTrigger className="h-9 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  API Key{" "}
                  {row.hasApiKey && (
                    <span className="text-muted-foreground">— atual: {row.apiKeyMasked}</span>
                  )}
                </Label>
                <Input
                  type="password"
                  placeholder={row.hasApiKey ? "Manter atual (deixar vazio)" : "sk_… / $aact_…"}
                  value={e.apiKey}
                  onChange={(ev) =>
                    setEdits({ ...edits, [row.provider]: { ...e, apiKey: ev.target.value } })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">
                  Webhook Secret{" "}
                  {row.hasWebhookSecret && (
                    <span className="text-muted-foreground">
                      — atual: {row.webhookSecretMasked}
                    </span>
                  )}
                </Label>
                <Input
                  type="password"
                  placeholder={row.hasWebhookSecret ? "Manter atual" : "whsec_… / token"}
                  value={e.webhookSecret}
                  onChange={(ev) =>
                    setEdits({ ...edits, [row.provider]: { ...e, webhookSecret: ev.target.value } })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">URL do webhook</Label>
                <div className="flex gap-1">
                  <Input readOnly value={webhookUrl} className="text-[11px] font-mono" />
                  <Button size="sm" variant="outline" onClick={() => copy(webhookUrl)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border/40 pt-3">
                <Button
                  size="sm"
                  onClick={() => save(row.provider)}
                  disabled={busy === row.provider}
                >
                  {busy === row.provider ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => test(row.provider)}
                  disabled={busy === row.provider || !row.hasApiKey}
                >
                  Testar conexão
                </Button>
                <Button
                  size="sm"
                  variant={row.isActive ? "secondary" : "default"}
                  onClick={() => activate(row.provider)}
                  disabled={busy === row.provider || row.isActive || !row.hasApiKey}
                  className="ml-auto"
                >
                  <Power className="mr-1.5 h-3.5 w-3.5" />
                  {row.isActive ? "Já ativo" : "Ativar"}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
