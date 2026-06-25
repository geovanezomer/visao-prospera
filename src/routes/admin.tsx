// ============================================================================
// Painel Administrativo — visível apenas para ADMIN_EMAIL.
// Gating client-side é cosmético; toda fn admin* re-checa no servidor.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  RefreshCw,
  KeyRound,
  Undo2,
  ArrowLeft,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import {
  listAdminUsers,
  setUserActive,
  sendPasswordReset,
  revalidatePlan,
  refundPayment,
  type AdminUserRow,
} from "@/lib/admin/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Administração — FinnancePRO" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminPage,
});

// ----------------------------------------------------------------------------
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function planBadgeClass(plan: string | null): string {
  if (plan === "pro") return "bg-primary/15 text-primary border-primary/30";
  if (plan === "starter") return "bg-blue-500/10 text-blue-600 border-blue-500/30";
  return "bg-muted text-muted-foreground border-border";
}

// ----------------------------------------------------------------------------
function AdminPage() {
  const { user, hydrated } = useAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (hydrated && !user) navigate({ to: "/login" });
    else if (hydrated && user && !isAdmin) navigate({ to: "/app" });
  }, [hydrated, user, isAdmin, navigate]);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<AdminUserRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listAdminUsers({ data: { perPage: 200, search } });
      setUsers(res.users);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao listar usuários.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const summary = useMemo(() => {
    const total = users.length;
    const ativos = users.filter((u) => u.isActive).length;
    const pagantes = users.filter((u) => u.planStatus === "active" || u.planStatus === "trialing")
      .length;
    return { total, ativos, pagantes };
  }, [users]);

  if (!hydrated || !user || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Verificando permissões…
      </div>
    );
  }

  // --------------------------------------------------------------------------
  const handleToggleActive = async (row: AdminUserRow, next: boolean) => {
    setBusyId(row.id);
    try {
      await setUserActive({ data: { userId: row.id, active: next } });
      toast.success(next ? "Usuário reativado." : "Usuário desativado.");
      setUsers((prev) =>
        prev.map((u) => (u.id === row.id ? { ...u, isActive: next } : u)),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar status.");
    } finally {
      setBusyId(null);
    }
  };

  const handleReset = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await sendPasswordReset({ data: { userId: row.id } });
      toast.success(`E-mail de redefinição enviado para ${r.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar reset.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRevalidate = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await revalidatePlan({ data: { userId: row.id } });
      toast.success(
        r.sub ? `Plano atual: ${r.sub.plan} (${r.sub.status}).` : "Sem assinatura registrada.",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao revalidar plano.");
    } finally {
      setBusyId(null);
    }
  };

  // --------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="ghost" className="h-8">
              <Link to="/app">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Voltar
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <h1 className="text-sm font-semibold">Administração</h1>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {user.email}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] p-4 sm:p-6">
        {/* KPIs */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Usuários" value={summary.total} />
          <KpiCard label="Ativos" value={summary.ativos} accent="emerald" />
          <KpiCard label="Pagantes" value={summary.pagantes} accent="primary" />
        </div>

        {/* Toolbar */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="Buscar por e-mail, nome ou telefone…"
              className="h-9 pl-8"
            />
          </div>
          <Button onClick={load} disabled={loading} size="sm" variant="outline">
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Atualizar
          </Button>
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Usuário</th>
                  <th className="p-2 text-left">Telefone</th>
                  <th className="p-2 text-left">Plano</th>
                  <th className="p-2 text-left">Inscrição</th>
                  <th className="p-2 text-left">Expira</th>
                  <th className="p-2 text-center">Ativo</th>
                  <th className="p-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-t border-border/40 hover:bg-muted/20">
                      <td className="p-2">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5 font-medium">
                            {u.displayName ?? "—"}
                            {u.isAdmin && (
                              <Badge className="h-4 px-1.5 text-[9px]" variant="outline">
                                ADMIN
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">{u.email}</span>
                        </div>
                      </td>
                      <td className="p-2 text-muted-foreground">{u.phone ?? "—"}</td>
                      <td className="p-2">
                        {u.plan ? (
                          <Badge variant="outline" className={planBadgeClass(u.plan)}>
                            {u.plan} · {u.planStatus}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground">{fmtDate(u.createdAt)}</td>
                      <td className="p-2 text-muted-foreground">{fmtDate(u.currentPeriodEnd)}</td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Switch
                            checked={u.isActive}
                            disabled={busyId === u.id || u.isAdmin}
                            onCheckedChange={(v) => handleToggleActive(u, v)}
                          />
                          {u.isActive ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                          )}
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title="Revalidar plano"
                            onClick={() => handleRevalidate(u)}
                            disabled={busyId === u.id}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            title="Enviar e-mail de redefinição de senha"
                            onClick={() => handleReset(u)}
                            disabled={busyId === u.id}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-red-600 hover:text-red-700"
                            title="Estornar pagamento"
                            onClick={() => setRefundFor(u)}
                            disabled={busyId === u.id || !u.subscriptionId}
                          >
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
        </div>
      </main>

      <RefundDialog
        user={refundFor}
        onClose={() => setRefundFor(null)}
        onDone={() => {
          setRefundFor(null);
          void load();
        }}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "primary";
}) {
  const cls =
    accent === "emerald"
      ? "text-emerald-600"
      : accent === "primary"
        ? "text-primary"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${cls}`}>{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
function RefundDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"total" | "parcial">("total");
  const [valor, setValor] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setMode("total");
      setValor("");
      setReason("");
    }
  }, [user]);

  if (!user) return null;

  const isStripe = (user.provider ?? "stripe") === "stripe";
  const hint = isStripe
    ? "Stripe: informe o valor em REAIS (será convertido p/ centavos)."
    : "Asaas: informe o valor em REAIS.";

  const submit = async () => {
    setBusy(true);
    try {
      let amount: number | undefined;
      if (mode === "parcial") {
        const num = Number(valor.replace(",", "."));
        if (!Number.isFinite(num) || num <= 0) throw new Error("Valor inválido.");
        amount = isStripe ? Math.round(num * 100) : num;
      }
      const r = await refundPayment({
        data: { userId: user.id, amount, reason: reason || undefined },
      });
      toast.success(`Estorno OK (${r.provider} · ${r.status}).`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no estorno.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar pagamento</DialogTitle>
          <DialogDescription>
            Usuário: <strong>{user.email}</strong> · Provedor:{" "}
            <strong>{user.provider ?? "—"}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Button
              variant={mode === "total" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("total")}
              className="flex-1"
            >
              Total
            </Button>
            <Button
              variant={mode === "parcial" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("parcial")}
              className="flex-1"
            >
              Parcial
            </Button>
          </div>

          {mode === "parcial" && (
            <div className="space-y-1">
              <Label className="text-xs">Valor (R$)</Label>
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="ex.: 49,90"
                inputMode="decimal"
              />
              <p className="text-[11px] text-muted-foreground">{hint}</p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Motivo (opcional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex.: Solicitação do cliente"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy} className="bg-red-600 hover:bg-red-700">
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Confirmar estorno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
