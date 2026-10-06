// ============================================================================
// FlagsTab — gestão de feature flags com rollout %, e-mails e planos.
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2, Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  listFeatureFlags,
  upsertFeatureFlag,
  deleteFeatureFlag,
  type FeatureFlag,
} from "@/lib/admin/featureFlags.functions";

type Editing = {
  key: string;
  description: string;
  enabled: boolean;
  rollout_percent: number;
  allowed_emails: string;
  allowed_plans: string;
};

const empty: Editing = {
  key: "",
  description: "",
  enabled: false,
  rollout_percent: 0,
  allowed_emails: "",
  allowed_plans: "",
};

export function FlagsTab() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Editing>(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listFeatureFlags();
      setFlags(r.flags);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao listar.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (f: FeatureFlag) =>
    setEditing({
      key: f.key,
      description: f.description ?? "",
      enabled: f.enabled,
      rollout_percent: f.rollout_percent,
      allowed_emails: f.allowed_emails.join(", "),
      allowed_plans: f.allowed_plans.join(", "),
    });

  const save = async () => {
    setSaving(true);
    try {
      await upsertFeatureFlag({
        data: {
          key: editing.key.trim(),
          description: editing.description || undefined,
          enabled: editing.enabled,
          rollout_percent: editing.rollout_percent,
          allowed_emails: editing.allowed_emails
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          allowed_plans: editing.allowed_plans
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      toast.success("Flag salva.");
      setEditing(empty);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (key: string) => {
    if (!confirm(`Excluir flag "${key}"?`)) return;
    try {
      await deleteFeatureFlag({ data: { key } });
      toast.success("Flag removida.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Flag className="h-4 w-4" />
          {editing.key && flags.some((f) => f.key === editing.key) ? "Editar flag" : "Nova flag"}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Chave (snake/kebab)</Label>
            <Input
              value={editing.key}
              onChange={(e) => setEditing({ ...editing, key: e.target.value.toLowerCase() })}
              placeholder="new_dashboard"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs">Rollout (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={editing.rollout_percent}
              onChange={(e) =>
                setEditing({ ...editing, rollout_percent: Number(e.target.value) || 0 })
              }
              className="h-9"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Descrição</Label>
            <Input
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className="h-9"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">
              E-mails permitidos (separados por vírgula) — bypass de rollout
            </Label>
            <Textarea
              value={editing.allowed_emails}
              onChange={(e) => setEditing({ ...editing, allowed_emails: e.target.value })}
              rows={2}
              placeholder="alice@x.com, bob@y.com"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Planos permitidos (separados por vírgula)</Label>
            <Input
              value={editing.allowed_plans}
              onChange={(e) => setEditing({ ...editing, allowed_plans: e.target.value })}
              placeholder="pro, lifetime"
              className="h-9"
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              checked={editing.enabled}
              onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
            />
            <Label className="text-sm">Habilitada</Label>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          {editing.key && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(empty)}>
              Cancelar
            </Button>
          )}
          <Button onClick={save} disabled={saving || !editing.key} size="sm">
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Salvar
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card">
        <div className="flex items-center justify-between border-b border-border/40 p-3">
          <h3 className="text-sm font-semibold">Flags ativas</h3>
          <Button size="sm" variant="ghost" onClick={() => setEditing(empty)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nova
          </Button>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : flags.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma flag.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Chave</th>
                <th className="p-2 text-left">Descrição</th>
                <th className="p-2 text-center">Rollout</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.key} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="p-2 font-mono text-xs">{f.key}</td>
                  <td className="p-2 text-muted-foreground">{f.description ?? "—"}</td>
                  <td className="p-2 text-center">{f.rollout_percent}%</td>
                  <td className="p-2 text-center">
                    <Badge
                      variant="outline"
                      className={
                        f.enabled
                          ? "border-emerald-500/40 text-emerald-600"
                          : "border-border text-muted-foreground"
                      }
                    >
                      {f.enabled ? "ON" : "OFF"}
                    </Badge>
                  </td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(f)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(f.key)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
