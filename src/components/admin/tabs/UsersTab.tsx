// ============================================================================
// UsersTab — listagem paginada com filtros e ordenação.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, KeyRound, Undo2, Search, Loader2, CheckCircle2, XCircle, ArrowUpDown, Mail, UserPlus, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  listAdminUsers, setUserActive, sendPasswordReset, revalidatePlan, refundPayment, resendMagicLink,
  type AdminUserRow, type AdminUserSort, type AdminUserFilters,
} from "@/lib/admin/admin.functions";
import { createManualUser } from "@/lib/admin/userDetail.functions";
import { exportUsersCsv } from "@/lib/admin/export.functions";
import { Download } from "lucide-react";
import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch { return "—"; }
}
function planClass(plan: string | null) {
  if (plan === "pro") return "bg-primary/15 text-primary border-primary/30";
  if (plan === "starter") return "bg-blue-500/10 text-blue-600 border-blue-500/30";
  if (plan === "lifetime") return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export function UsersTab() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AdminUserSort>("created_desc");
  const [filters, setFilters] = useState<AdminUserFilters>({ plan: "all", status: "all", provider: "all" });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<AdminUserRow | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listAdminUsers({ data: { page, perPage, search, sort, filters } });
      setUsers(r.users); setTotal(r.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao listar.");
    } finally { setLoading(false); }
  };

  // Único efeito controla recarga: muda em paginação/filtros/sort, e a busca
  // entra via debounce de 350ms (sem disparo duplo no mount).
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, sort, filters, search]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const summary = useMemo(() => {
    const ativos = users.filter((u) => u.isActive).length;
    const pagantes = users.filter((u) => u.planStatus === "active" || u.planStatus === "trialing").length;
    return { ativos, pagantes };
  }, [users]);

  const toggleSort = (key: "created" | "expires" | "name") => {
    if (key === "name") setSort(sort === "name_asc" ? "name_desc" : "name_asc");
    else if (key === "created") setSort(sort === "created_desc" ? "created_asc" : "created_desc");
    else setSort(sort === "expires_desc" ? "expires_asc" : "expires_desc");
  };

  const handleToggle = async (row: AdminUserRow, next: boolean) => {
    setBusyId(row.id);
    try {
      await setUserActive({ data: { userId: row.id, active: next } });
      toast.success(next ? "Reativado." : "Desativado.");
      setUsers((prev) => prev.map((u) => (u.id === row.id ? { ...u, isActive: next } : u)));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusyId(null); }
  };
  const handleReset = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try { const r = await sendPasswordReset({ data: { userId: row.id } }); toast.success(`Reset enviado para ${r.email}.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusyId(null); }
  };
  const handleRevalidate = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await revalidatePlan({ data: { userId: row.id } });
      toast.success(r.sub ? `Plano: ${r.sub.plan} (${r.sub.status}).` : "Sem assinatura.");
      void load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusyId(null); }
  };
  const handleResendMagic = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await resendMagicLink({ data: { userId: row.id } });
      if (r.sent) toast.success(`Magic link enviado para ${r.email}.`);
      else toast.message("Resend não configurado — link copiado.", { description: r.link });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Total (página)" value={users.length} />
        <KpiCard label="Ativos" value={summary.ativos} accent="emerald" />
        <KpiCard label="Pagantes" value={summary.pagantes} accent="primary" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative w-full sm:max-w-xs">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e-mail, nome, telefone, sub_id…" className="h-9 pl-8" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Plano</Label>
          <Select value={filters.plan} onValueChange={(v) => { setFilters((f) => ({ ...f, plan: v as any })); setPage(1); }}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="lifetime">Lifetime</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filters.status} onValueChange={(v) => { setFilters((f) => ({ ...f, status: v as any })); setPage(1); }}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="trialing">Trialing</SelectItem>
              <SelectItem value="past_due">Past due</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
              <SelectItem value="none">Sem assinatura</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Provider</Label>
          <Select value={filters.provider} onValueChange={(v) => { setFilters((f) => ({ ...f, provider: v as any })); setPage(1); }}>
            <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="stripe">Stripe</SelectItem>
              <SelectItem value="asaas">Asaas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={load} disabled={loading} size="sm" variant="outline" className="self-end">
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Atualizar
        </Button>
        <Button
          onClick={async () => {
            try {
              const r = await exportUsersCsv();
              const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `usuarios-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`${r.rows} linhas exportadas.`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Falha ao exportar.");
            }
          }}
          size="sm" variant="outline" className="self-end"
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />CSV
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">
                  <button onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Usuário <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-2 text-left">Telefone</th>
                <th className="p-2 text-left">Plano</th>
                <th className="p-2 text-left">
                  <button onClick={() => toggleSort("created")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Inscrição <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-2 text-left">
                  <button onClick={() => toggleSort("expires")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Expira <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-2 text-center">Ativo</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Nenhum usuário.</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="p-2">
                      <button onClick={() => setDetailFor(u.id)} className="flex flex-col text-left hover:underline">
                        <div className="flex items-center gap-1.5 font-medium">
                          {u.displayName ?? "—"}
                          {u.isAdmin && <Badge className="h-4 px-1.5 text-[9px]" variant="outline">ADMIN</Badge>}
                        </div>
                        <span className="text-[11px] text-muted-foreground">{u.email}</span>
                      </button>
                    </td>
                    <td className="p-2 text-muted-foreground">{u.phone ?? "—"}</td>
                    <td className="p-2">
                      {u.plan ? (
                        <Badge variant="outline" className={planClass(u.plan)}>
                          {u.plan} · {u.planStatus}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-muted-foreground">{fmt(u.createdAt)}</td>
                    <td className="p-2 text-muted-foreground">{fmt(u.currentPeriodEnd)}</td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Switch checked={u.isActive} disabled={busyId === u.id || u.isAdmin} onCheckedChange={(v) => handleToggle(u, v)} />
                        {u.isActive ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Revalidar plano" onClick={() => handleRevalidate(u)} disabled={busyId === u.id}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Reenviar magic link" onClick={() => handleResendMagic(u)} disabled={busyId === u.id}>
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Reset de senha" onClick={() => handleReset(u)} disabled={busyId === u.id}>
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:text-red-700" title="Estornar" onClick={() => setRefundFor(u)} disabled={busyId === u.id || !u.subscriptionId}>
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          <div>
            {total} usuários · página {page}/{totalPages}
            <Select value={String(perPage)} onValueChange={(v) => { setPerPage(Number(v)); setPage(1); }}>
              <SelectTrigger className="ml-3 inline-flex h-7 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}/pág</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        </div>
      </div>

      <RefundDialog user={refundFor} onClose={() => setRefundFor(null)} onDone={() => { setRefundFor(null); void load(); }} />
      <UserDetailDrawer userId={detailFor} onClose={() => setDetailFor(null)} onChanged={() => void load()} />
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: "emerald" | "primary" }) {
  const cls = accent === "emerald" ? "text-emerald-600" : accent === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${cls}`}>{value}</div>
    </div>
  );
}

function RefundDialog({ user, onClose, onDone }: { user: AdminUserRow | null; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"total" | "parcial">("total");
  const [valor, setValor] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) { setMode("total"); setValor(""); setReason(""); } }, [user]);
  if (!user) return null;
  const isStripe = (user.provider ?? "stripe") === "stripe";
  const submit = async () => {
    setBusy(true);
    try {
      let amount: number | undefined;
      if (mode === "parcial") {
        const num = Number(valor.replace(",", "."));
        if (!Number.isFinite(num) || num <= 0) throw new Error("Valor inválido.");
        amount = isStripe ? Math.round(num * 100) : num;
      }
      const r = await refundPayment({ data: { userId: user.id, amount, reason: reason || undefined } });
      toast.success(`Estorno OK (${r.provider} · ${r.status}).`);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar pagamento</DialogTitle>
          <DialogDescription>Usuário: <strong>{user.email}</strong> · Provedor: <strong>{user.provider ?? "—"}</strong></DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Button variant={mode === "total" ? "default" : "outline"} size="sm" onClick={() => setMode("total")} className="flex-1">Total</Button>
            <Button variant={mode === "parcial" ? "default" : "outline"} size="sm" onClick={() => setMode("parcial")} className="flex-1">Parcial</Button>
          </div>
          {mode === "parcial" && (
            <div className="space-y-1">
              <Label className="text-xs">Valor (R$)</Label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="49,90" inputMode="decimal" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Solicitação do cliente" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy} className="bg-red-600 hover:bg-red-700">
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Confirmar estorno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
