// ============================================================================
// PlansTab — gestão de planos via UI (preço, features, limites, IDs provedor).
// ============================================================================
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listPlansAdmin, upsertPlan, deletePlan, type PlanRow } from "@/lib/admin/plans.functions";
import { TableSkeleton, EmptyState, TypedConfirmDialog } from "@/components/admin/ui-states";

type Editing = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  priceReais: string;
  currency: string;
  interval: string;
  features: string;
  limits: string;
  stripePriceId: string;
  asaasPlanRef: string;
  active: boolean;
  sortOrder: number;
  upsellEnabled: boolean;
  upsellName: string;
  upsellDescription: string;
  upsellPriceReais: string;
  upsellStripePriceId: string;
  upsellAsaasRef: string;
};

const empty: Editing = {
  slug: "",
  name: "",
  description: "",
  priceReais: "0",
  currency: "brl",
  interval: "month",
  features: "",
  limits: "{}",
  stripePriceId: "",
  asaasPlanRef: "",
  active: true,
  sortOrder: 10,
  upsellEnabled: false,
  upsellName: "",
  upsellDescription: "",
  upsellPriceReais: "0",
  upsellStripePriceId: "",
  upsellAsaasRef: "",
};

function rowToEditing(r: PlanRow): Editing {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? "",
    priceReais: (r.priceCents / 100).toFixed(2),
    currency: r.currency,
    interval: r.interval,
    features: r.features.join("\n"),
    limits: JSON.stringify(r.limits, null, 2),
    stripePriceId: r.stripePriceId ?? "",
    asaasPlanRef: r.asaasPlanRef ?? "",
    active: r.active,
    sortOrder: r.sortOrder,
    upsellEnabled: r.upsellEnabled,
    upsellName: r.upsellName ?? "",
    upsellDescription: r.upsellDescription ?? "",
    upsellPriceReais: (r.upsellPriceCents / 100).toFixed(2),
    upsellStripePriceId: r.upsellStripePriceId ?? "",
    upsellAsaasRef: r.upsellAsaasRef ?? "",
  };
}

export function PlansTab() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Editing>(empty);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PlanRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listPlansAdmin();
      setPlans(r.plans);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      const limits = editing.limits.trim() ? JSON.parse(editing.limits) : {};
      const cents = Math.round(parseFloat(editing.priceReais.replace(",", ".") || "0") * 100);
      const upsellCents = Math.round(
        parseFloat(editing.upsellPriceReais.replace(",", ".") || "0") * 100,
      );
      setSaving(true);
      await upsertPlan({
        data: {
          id: editing.id,
          slug: editing.slug,
          name: editing.name,
          description: editing.description || null,
          priceCents: cents,
          currency: editing.currency,
          interval: editing.interval as any,
          features: editing.features
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          limits,
          stripePriceId: editing.stripePriceId || null,
          asaasPlanRef: editing.asaasPlanRef || null,
          active: editing.active,
          sortOrder: editing.sortOrder,
          upsellEnabled: editing.upsellEnabled,
          upsellName: editing.upsellName || null,
          upsellDescription: editing.upsellDescription || null,
          upsellPriceCents: upsellCents,
          upsellStripePriceId: editing.upsellStripePriceId || null,
          upsellAsaasRef: editing.upsellAsaasRef || null,
        },
      });
      toast.success("Plano salvo.");
      setEditing(empty);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deletePlan({ data: { id: confirmDelete.id } });
      toast.success("Plano excluído");
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,420px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Planos</h3>
          <Button size="sm" variant="outline" onClick={() => setEditing(empty)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Novo
          </Button>
        </div>
        {loading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : plans.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Nenhum plano cadastrado"
            description="Cadastre um plano no formulário ao lado para começar."
          />
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="rounded-md border border-border/60 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{p.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {p.slug}
                    </Badge>
                    {!p.active && (
                      <Badge variant="destructive" className="text-[10px]">
                        inativo
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(rowToEditing(p))}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(p)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  R$ {(p.priceCents / 100).toFixed(2)} / {p.interval} · {p.features.length} features
                </div>
              </div>
            ))}
          </div>
        )}

        <TypedConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
          expectedText={confirmDelete?.slug ?? ""}
          title="Excluir plano definitivamente"
          description={
            <>
              Esta ação é <strong>irreversível</strong>. O plano{" "}
              <strong>{confirmDelete?.name}</strong> ({confirmDelete?.slug}) será removido.
            </>
          }
          confirmLabel="Excluir plano"
          busy={deleting}
          onConfirm={confirmRemove}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-semibold">{editing.id ? "Editar" : "Novo"} plano</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Slug</Label>
            <Input
              value={editing.slug}
              onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
              placeholder="pro"
            />
          </div>
          <div>
            <Label className="text-xs">Nome</Label>
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Anual"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Descrição</Label>
          <Input
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Preço (R$)</Label>
            <Input
              value={editing.priceReais}
              onChange={(e) => setEditing({ ...editing, priceReais: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Moeda</Label>
            <Input
              value={editing.currency}
              onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Período</Label>
            <Select
              value={editing.interval}
              onValueChange={(v) => setEditing({ ...editing, interval: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Mensal</SelectItem>
                <SelectItem value="year">Anual</SelectItem>
                <SelectItem value="week">Semanal</SelectItem>
                <SelectItem value="day">Diário</SelectItem>
                <SelectItem value="lifetime">Vitalício</SelectItem>
                <SelectItem value="one_time">Pagamento único</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Features (uma por linha)</Label>
          <Textarea
            rows={5}
            value={editing.features}
            onChange={(e) => setEditing({ ...editing, features: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">Limites (JSON)</Label>
          <Textarea
            rows={3}
            className="font-mono text-xs"
            value={editing.limits}
            onChange={(e) => setEditing({ ...editing, limits: e.target.value })}
            placeholder='{"users":1,"reports":50}'
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Stripe price_id</Label>
            <Input
              value={editing.stripePriceId}
              onChange={(e) => setEditing({ ...editing, stripePriceId: e.target.value })}
              placeholder="price_xxx"
            />
          </div>
          <div>
            <Label className="text-xs">Asaas ref</Label>
            <Input
              value={editing.asaasPlanRef}
              onChange={(e) => setEditing({ ...editing, asaasPlanRef: e.target.value })}
              placeholder="97.00:MONTHLY"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Ordem</Label>
            <Input
              type="number"
              value={editing.sortOrder}
              onChange={(e) =>
                setEditing({ ...editing, sortOrder: parseInt(e.target.value || "0", 10) })
              }
            />
          </div>
          <div className="flex items-end gap-2">
            <Switch
              checked={editing.active}
              onCheckedChange={(c) => setEditing({ ...editing, active: c })}
            />
            <span className="text-xs">Ativo</span>
          </div>
        </div>

        {/* Upsell opcional no checkout */}
        <div className="rounded-md border border-dashed border-border/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-semibold">Upsell no checkout</Label>
              <p className="text-[10px] text-muted-foreground">
                Oferece um adicional opcional na hora da compra.
              </p>
            </div>
            <Switch
              checked={editing.upsellEnabled}
              onCheckedChange={(c) => setEditing({ ...editing, upsellEnabled: c })}
            />
          </div>
          {editing.upsellEnabled && (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nome</Label>
                  <Input
                    value={editing.upsellName}
                    onChange={(e) => setEditing({ ...editing, upsellName: e.target.value })}
                    placeholder="Onboarding 1:1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Preço (R$)</Label>
                  <Input
                    value={editing.upsellPriceReais}
                    onChange={(e) => setEditing({ ...editing, upsellPriceReais: e.target.value })}
                    placeholder="197.00"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={editing.upsellDescription}
                  onChange={(e) => setEditing({ ...editing, upsellDescription: e.target.value })}
                  placeholder="Sessão de 1h com nosso especialista"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Stripe price_id (opcional)</Label>
                  <Input
                    value={editing.upsellStripePriceId}
                    onChange={(e) =>
                      setEditing({ ...editing, upsellStripePriceId: e.target.value })
                    }
                    placeholder="price_xxx"
                  />
                </div>
                <div>
                  <Label className="text-xs">Asaas ref (opcional)</Label>
                  <Input
                    value={editing.upsellAsaasRef}
                    onChange={(e) => setEditing({ ...editing, upsellAsaasRef: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <Button onClick={save} disabled={saving} className="w-full">
          {saving ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-2 h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}
