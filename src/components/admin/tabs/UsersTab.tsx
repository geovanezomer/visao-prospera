// ============================================================================
// UsersTab — listagem paginada com filtros e ordenação.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { lerNumeroBR } from "@/lib/numeroBR";
import {
  RefreshCw,
  KeyRound,
  Undo2,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  Mail,
  UserPlus,
  Copy,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listAdminUsers,
  setUserActive,
  setUserAIEnabled,
  sendPasswordReset,
  revalidatePlan,
  refundPayment,
  resendMagicLink,
  type AdminUserRow,
  type AdminUserSort,
  type AdminUserFilters,
} from "@/lib/admin/admin.functions";
import { createManualUser, checkEmailAvailable } from "@/lib/admin/userDetail.functions";
import { z } from "zod";
import { exportUsersCsv } from "@/lib/admin/export.functions";
import { Download } from "lucide-react";
import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";
import { getRouteApi } from "@tanstack/react-router";
import { TableSkeleton, EmptyState } from "@/components/admin/ui-states";

const adminRouteApi = getRouteApi("/admin");

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
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
  const [filters, setFilters] = useState<AdminUserFilters>({
    plan: "all",
    status: "all",
    provider: "all",
  });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<AdminUserRow | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Command palette navega com ?user=<id>; abrimos o drawer ao montar/alterar.
  const search_ = adminRouteApi.useSearch();
  const navigate = adminRouteApi.useNavigate();
  useEffect(() => {
    const u = (search_ as { user?: string }).user;
    if (u) {
      setDetailFor(u);
      // Limpa o param para não reabrir se o admin fechar o drawer manualmente.
      navigate({
        to: "/admin",
        search: (prev: Record<string, unknown>) => ({ ...prev, user: undefined }),
        replace: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(search_ as { user?: string }).user]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listAdminUsers({ data: { page, perPage, search, sort, filters } });
      setUsers(r.users);
      setTotal(r.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao listar.");
    } finally {
      setLoading(false);
    }
  };

  // Único efeito controla recarga: muda em paginação/filtros/sort, e a busca
  // entra via debounce de 350ms (sem disparo duplo no mount).
  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, sort, filters, search]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const summary = useMemo(() => {
    const ativos = users.filter((u) => u.isActive).length;
    const pagantes = users.filter(
      (u) => u.planStatus === "active" || u.planStatus === "trialing",
    ).length;
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyId(null);
    }
  };
  const handleToggleAI = async (row: AdminUserRow, next: boolean) => {
    setBusyId(row.id);
    try {
      await setUserAIEnabled({ data: { userId: row.id, enabled: next } });
      toast.success(next ? "Consultor IA liberado." : "Consultor IA bloqueado.");
      setUsers((prev) => prev.map((u) => (u.id === row.id ? { ...u, aiEnabled: next } : u)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyId(null);
    }
  };
  const handleReset = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await sendPasswordReset({ data: { userId: row.id } });
      toast.success(`Reset enviado para ${r.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyId(null);
    }
  };
  const handleRevalidate = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await revalidatePlan({ data: { userId: row.id } });
      toast.success(r.sub ? `Plano: ${r.sub.plan} (${r.sub.status}).` : "Sem assinatura.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyId(null);
    }
  };
  const handleResendMagic = async (row: AdminUserRow) => {
    setBusyId(row.id);
    try {
      const r = await resendMagicLink({ data: { userId: row.id } });
      if (r.sent) toast.success(`Magic link enviado para ${r.email}.`);
      else toast.message("Resend não configurado — link copiado.", { description: r.link });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyId(null);
    }
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
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e-mail, nome, telefone, sub_id…"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Plano</Label>
          <Select
            value={filters.plan}
            onValueChange={(v) => {
              setFilters((f) => ({ ...f, plan: v as AdminUserFilters["plan"] }));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
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
          <Select
            value={filters.status}
            onValueChange={(v) => {
              setFilters((f) => ({ ...f, status: v as AdminUserFilters["status"] }));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
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
          <Select
            value={filters.provider}
            onValueChange={(v) => {
              setFilters((f) => ({ ...f, provider: v as AdminUserFilters["provider"] }));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="stripe">Stripe</SelectItem>
              <SelectItem value="asaas">Asaas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={load} disabled={loading} size="sm" variant="outline" className="self-end">
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
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
          size="sm"
          variant="outline"
          className="self-end"
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          CSV
        </Button>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="self-end">
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          Novo usuário
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">
                  <button
                    onClick={() => toggleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Usuário <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-2 text-left">Telefone</th>
                <th className="p-2 text-left">Plano</th>
                <th className="p-2 text-left">
                  <button
                    onClick={() => toggleSort("created")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Inscrição <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-2 text-left">
                  <button
                    onClick={() => toggleSort("expires")}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Expira <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="p-2 text-center" title="Acesso ao Consultor IA na sidebar">
                  I.A.
                </th>
                <th className="p-2 text-center">Ativo</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableSkeleton rows={8} cols={8} />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      icon={UsersIcon}
                      title="Nenhum usuário encontrado com esses filtros"
                      description="Ajuste ou limpe os filtros para ver mais resultados."
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSearch("");
                            setFilters({ plan: "all", status: "all", provider: "all" });
                            setPage(1);
                          }}
                        >
                          Limpar filtros
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="p-2">
                      <button
                        onClick={() => setDetailFor(u.id)}
                        className="flex flex-col text-left hover:underline"
                      >
                        <div className="flex items-center gap-1.5 font-medium">
                          {u.displayName ?? "—"}
                          {u.isAdmin && (
                            <Badge className="h-4 px-1.5 text-[9px]" variant="outline">
                              ADMIN
                            </Badge>
                          )}
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
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-2 text-muted-foreground">{fmt(u.createdAt)}</td>
                    <td className="p-2 text-muted-foreground">{fmt(u.currentPeriodEnd)}</td>
                    <td className="p-2 text-center">
                      <Switch
                        checked={u.aiEnabled}
                        disabled={busyId === u.id || u.isAdmin}
                        onCheckedChange={(v) => handleToggleAI(u, v)}
                        title={
                          u.isAdmin
                            ? "Admin sempre tem acesso ao Consultor IA"
                            : u.aiEnabled
                              ? "Consultor IA liberado"
                              : "Consultor IA bloqueado"
                        }
                      />
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Switch
                          checked={u.isActive}
                          disabled={busyId === u.id || u.isAdmin}
                          onCheckedChange={(v) => handleToggle(u, v)}
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
                          aria-label={`Revalidar plano de ${u.email}`}
                          onClick={() => handleRevalidate(u)}
                          disabled={busyId === u.id}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="Reenviar magic link"
                          aria-label={`Reenviar magic link para ${u.email}`}
                          onClick={() => handleResendMagic(u)}
                          disabled={busyId === u.id}
                        >
                          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="Reset de senha"
                          aria-label={`Reset de senha de ${u.email}`}
                          onClick={() => handleReset(u)}
                          disabled={busyId === u.id}
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-red-600 hover:text-red-700"
                          title="Estornar"
                          aria-label={`Estornar assinatura de ${u.email}`}
                          onClick={() => setRefundFor(u)}
                          disabled={busyId === u.id || !u.subscriptionId}
                        >
                          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
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
            <Select
              value={String(perPage)}
              onValueChange={(v) => {
                setPerPage(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="ml-3 inline-flex h-7 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}/pág
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      </div>

      <RefundDialog
        user={refundFor}
        onClose={() => setRefundFor(null)}
        onDone={() => {
          setRefundFor(null);
          void load();
        }}
      />
      <UserDetailDrawer
        userId={detailFor}
        onClose={() => setDetailFor(null)}
        onChanged={() => void load()}
      />
      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          void load();
        }}
      />
    </div>
  );
}

const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido").max(255);

function planLabel(p: "starter" | "pro" | "lifetime") {
  return p === "starter" ? "Starter" : p === "pro" ? "Pro" : "Lifetime";
}
function modeLabel(m: "trial" | "ativo" | "lifetime") {
  return m === "trial" ? "Trial" : m === "ativo" ? "Ativo" : "Vitalício";
}

function CreateUserDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [grantOn, setGrantOn] = useState(true);
  const [plan, setPlan] = useState<"starter" | "pro" | "lifetime">("lifetime");
  const [mode, setMode] = useState<"trial" | "ativo" | "lifetime">("lifetime");
  const [durationDays, setDurationDays] = useState<string>("");
  const [sendMagicLink, setSendMagicLink] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resultLink, setResultLink] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("form");
      setEmail("");
      setEmailError(null);
      setDisplayName("");
      setGrantOn(true);
      setPlan("lifetime");
      setMode("lifetime");
      setDurationDays("");
      setSendMagicLink(true);
      setReason("");
      setResultLink(null);
    }
  }, [open]);

  // Valida e-mail e duração; abre etapa de confirmação após checagem de duplicidade.
  const goConfirm = async () => {
    setEmailError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "E-mail inválido");
      return;
    }
    const normalized = parsed.data;
    if (grantOn && mode !== "lifetime") {
      const days = durationDays.trim() ? Number(durationDays) : NaN;
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        toast.error("Duração inválida (1–3650 dias).");
        return;
      }
    }
    setChecking(true);
    try {
      const r = await checkEmailAvailable({ data: { email: normalized } });
      if (!r.available) {
        setEmailError("Já existe um usuário com este e-mail.");
        return;
      }
      setEmail(normalized);
      setStep("confirm");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao validar e-mail.");
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const days = durationDays.trim() ? Number(durationDays) : undefined;
      const r = await createManualUser({
        data: {
          email,
          displayName: displayName.trim() || undefined,
          grant: grantOn
            ? { plan, mode, durationDays: mode === "lifetime" ? undefined : days }
            : undefined,
          sendMagicLink,
          reason: reason.trim() || undefined,
        },
      });
      toast.success(`Usuário criado: ${r.email}`);
      if (r.magicLink) {
        setResultLink(r.magicLink);
      } else {
        onDone();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar.");
      setStep("form");
    } finally {
      setBusy(false);
    }
  };

  const effectiveDays =
    mode === "lifetime"
      ? null
      : durationDays.trim()
        ? Number(durationDays)
        : mode === "trial"
          ? 14
          : 30;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          if (resultLink) onDone();
          else onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {resultLink
              ? "Usuário criado"
              : step === "confirm"
                ? "Confirmar criação"
                : "Novo usuário"}
          </DialogTitle>
          <DialogDescription>
            {step === "confirm"
              ? "Revise os dados antes de criar a conta e conceder o plano."
              : "Cria a conta direto no painel. Útil para presentear acesso (cursos, parcerias), beta-testers ou suporte."}
          </DialogDescription>
        </DialogHeader>

        {resultLink ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              Usuário criado com sucesso. Compartilhe o link mágico abaixo (válido por ~1h):
            </div>
            <div className="flex gap-2">
              <Input readOnly value={resultLink} className="font-mono text-xs" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(resultLink);
                  toast.success("Copiado.");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onDone}>Concluir</Button>
            </DialogFooter>
          </div>
        ) : step === "confirm" ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-border/60 p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">E-mail</span>
                <span className="font-medium">{email}</span>
              </div>
              {displayName.trim() && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nome</span>
                  <span className="font-medium">{displayName.trim()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Magic link</span>
                <span className="font-medium">{sendMagicLink ? "Sim" : "Não"}</span>
              </div>
            </div>

            <div
              className={`rounded-lg border p-3 text-sm space-y-1.5 ${grantOn ? "border-primary/30 bg-primary/5" : "border-border/60"}`}
            >
              {grantOn ? (
                <>
                  <div className="font-medium mb-1">Conceder plano</div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plano</span>
                    <Badge variant="outline" className={planClass(plan)}>
                      {planLabel(plan)}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Período</span>
                    <span className="font-medium">{modeLabel(mode)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Validade</span>
                    <span className="font-medium">
                      {effectiveDays === null
                        ? "Vitalício (sem expiração)"
                        : `${effectiveDays} dias · expira ${new Date(Date.now() + effectiveDays * 86400_000).toLocaleDateString("pt-BR")}`}
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Nenhum plano será concedido agora.</div>
              )}
            </div>

            {reason.trim() && (
              <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Motivo: </span>
                {reason.trim()}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("form")} disabled={busy}>
                Voltar
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                )}
                Confirmar e criar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">E-mail *</Label>
                <Input
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  onBlur={() => {
                    if (!email.trim()) return;
                    const p = emailSchema.safeParse(email);
                    setEmailError(
                      p.success ? null : (p.error.issues[0]?.message ?? "E-mail inválido"),
                    );
                  }}
                  placeholder="aluno@exemplo.com"
                  type="email"
                  aria-invalid={!!emailError}
                />
                {emailError && <p className="text-xs text-destructive">{emailError}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome (opcional)</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Maria Souza"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Conceder plano agora</Label>
                <Switch checked={grantOn} onCheckedChange={setGrantOn} />
              </div>
              {grantOn && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Plano</Label>
                    <Select value={plan} onValueChange={(v) => setPlan(v as typeof plan)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="pro">Pro</SelectItem>
                        <SelectItem value="lifetime">Lifetime</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Modo</Label>
                    <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="ativo">Ativo</SelectItem>
                        <SelectItem value="lifetime">Vitalício</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Duração (dias)</Label>
                    <Input
                      value={durationDays}
                      onChange={(e) => setDurationDays(e.target.value)}
                      placeholder={mode === "trial" ? "14" : mode === "ativo" ? "30" : "—"}
                      disabled={mode === "lifetime"}
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div>
                <Label className="text-sm font-medium">Enviar magic link</Label>
                <p className="text-xs text-muted-foreground">
                  Gera link para o usuário entrar e definir senha.
                </p>
              </div>
              <Switch checked={sendMagicLink} onCheckedChange={setSendMagicLink} />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Motivo (opcional)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Aluno do curso Finanças PRO 2026"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={checking}>
                Cancelar
              </Button>
              <Button onClick={goConfirm} disabled={checking || !email.trim() || !!emailError}>
                {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Revisar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
  const [revoke, setRevoke] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof refundPayment>> | null>(null);
  const [typedEmail, setTypedEmail] = useState("");
  useEffect(() => {
    if (user) {
      setMode("total");
      setValor("");
      setReason("");
      setRevoke(true);
      setResult(null);
      setTypedEmail("");
    }
  }, [user]);
  if (!user) return null;
  const isStripe = (user.provider ?? "stripe") === "stripe";
  const submit = async () => {
    setBusy(true);
    try {
      let amount: number | undefined;
      if (mode === "parcial") {
        const num = lerNumeroBR(valor);
        if (!Number.isFinite(num) || num <= 0) throw new Error("Valor inválido.");
        amount = isStripe ? Math.round(num * 100) : num;
      }
      const r = await refundPayment({
        data: { userId: user.id, amount, reason: reason || undefined, revoke },
      });
      setResult(r);
      if (r.refund.ok) toast.success("Estorno executado.");
      else toast.error(`Falha no estorno: ${r.refund.error}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusy(false);
    }
  };
  const StepLine = ({
    label,
    s,
  }: {
    label: string;
    s: { ok: boolean; error?: string; detail?: string };
  }) => (
    <div className="flex items-center justify-between text-xs">
      <span>{label}</span>
      <span className={s.ok ? "text-emerald-600" : "text-red-600"}>
        {s.ok ? (s.detail === "skipped" ? "ignorado" : "ok") : `falhou: ${s.error ?? "erro"}`}
      </span>
    </div>
  );
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && (result ? onDone() : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar pagamento</DialogTitle>
          <DialogDescription>
            Usuário: <strong>{user.email}</strong> · Provedor:{" "}
            <strong>{user.provider ?? "—"}</strong>
          </DialogDescription>
        </DialogHeader>
        {!result ? (
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
                  placeholder="49,90"
                  inputMode="decimal"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Motivo (opcional)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Solicitação do cliente"
              />
            </div>
            <label className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={revoke}
                onChange={(e) => setRevoke(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Cancelar assinatura e revogar acesso (recomendado — devolve o dinheiro e derruba o
                acesso imediatamente).
              </span>
            </label>
            {/* Type-to-confirm: digitar o e-mail do cliente para habilitar o estorno. */}
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
              <Label className="text-xs">
                Para confirmar, digite o e-mail do cliente:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">
                  {user.email}
                </code>
              </Label>
              <Input
                value={typedEmail}
                onChange={(e) => setTypedEmail(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={user.email}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2 py-2 rounded-md border border-border/60 bg-muted/20 p-3">
            <StepLine label="Estorno no provedor" s={result.refund} />
            <StepLine label="Cancelamento no provedor" s={result.revoke} />
            <StepLine label="Atualização do banco" s={result.dbUpdate} />
            <StepLine label="Registro de auditoria" s={result.audit} />
            <StepLine label="E-mail ao cliente" s={result.email} />
          </div>
        )}
        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={busy || typedEmail.trim().toLowerCase() !== user.email.toLowerCase()}
                variant="destructive"
              >
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Confirmar
                estorno
              </Button>
            </>
          ) : (
            <Button onClick={onDone}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
