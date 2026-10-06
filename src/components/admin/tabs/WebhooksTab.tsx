// ============================================================================
// WebhooksTab — histórico + replay + retry com backoff.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Inbox,
} from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  listWebhookEvents,
  getWebhookEvent,
  replayWebhookEvent,
  runWebhookRetryNow,
} from "@/lib/admin/webhooks.functions";
import { TableSkeleton, EmptyState } from "@/components/admin/ui-states";

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}
function statusClass(s: string) {
  if (s === "processed") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
  if (s === "replayed") return "bg-blue-500/10 text-blue-600 border-blue-500/30";
  if (s === "failed") return "bg-red-500/10 text-red-600 border-red-500/30";
  if (s === "pending_retry") return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  if (s === "dead_letter") return "bg-rose-700/10 text-rose-700 border-rose-700/30";
  return "bg-muted text-muted-foreground border-border";
}

export function WebhooksTab() {
  type ProviderFilter = "all" | "stripe" | "asaas" | "admin";
  type StatusFilter =
    | "all"
    | "processed"
    | "failed"
    | "skipped"
    | "replayed"
    | "pending_retry"
    | "dead_letter";
  type ListedRow = Awaited<ReturnType<typeof listWebhookEvents>>["rows"][number];
  type Kpi = Awaited<ReturnType<typeof listWebhookEvents>>["kpi24h"];
  type SelectedRow = Awaited<ReturnType<typeof getWebhookEvent>>["event"];

  const [rows, setRows] = useState<ListedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [kpi, setKpi] = useState<{
    total: number;
    ok: number;
    failed: number;
    pending: number;
    dead: number;
  }>({
    total: 0,
    ok: 0,
    failed: 0,
    pending: 0,
    dead: 0,
  });
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [busyReplay, setBusyReplay] = useState(false);
  const [busyBatch, setBusyBatch] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listWebhookEvents({ data: { page, perPage, search, provider, status } });
      setRows(r.rows);
      setTotal(r.total);
      setKpi(r.kpi24h as Kpi);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [page, provider, status]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void load();
    }, 350);
    return () => clearTimeout(t); /* eslint-disable-next-line */
  }, [search]);

  const openDetail = async (id: string) => {
    try {
      const r = await getWebhookEvent({ data: { id } });
      setSelected(r.event);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    }
  };
  const replay = async (id: string, force = false) => {
    setBusyReplay(true);
    try {
      const r = await replayWebhookEvent({ data: { id, force } });
      toast.success(`Reprocessado (${r.status}).`);
      void load();
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyReplay(false);
    }
  };
  const runBatch = async () => {
    setBusyBatch(true);
    try {
      const r = await runWebhookRetryNow({ data: { limit: 25 } });
      toast.success(
        `Lote processado: ${r.ok} ok · ${r.failed} pendentes · ${r.deadLetter} dead-letter (${r.picked} eventos)`,
      );
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyBatch(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Últimas 24h</div>
          <div className="mt-1 text-2xl font-bold">{kpi.total}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Sucesso</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{kpi.ok}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Pendentes</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{kpi.pending}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Falhas</div>
          <div className="mt-1 text-2xl font-bold text-red-600">{kpi.failed}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="text-xs uppercase text-muted-foreground">Dead-letter</div>
          <div className="mt-1 text-2xl font-bold text-rose-700">{kpi.dead}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative w-full sm:max-w-xs">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e-mail, subscription_id, event_type…"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderFilter)}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="stripe">Stripe</SelectItem>
              <SelectItem value="asaas">Asaas</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="pending_retry">Pending retry</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="dead_letter">Dead-letter</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              <SelectItem value="replayed">Replayed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 self-end">
          <Button onClick={load} disabled={loading} size="sm" variant="outline">
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Atualizar
          </Button>
          <Button
            onClick={runBatch}
            disabled={busyBatch}
            size="sm"
            variant="outline"
            title="Processar lote de pending_retry maduros agora"
          >
            {busyBatch ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Rodar retry agora
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Data</th>
                <th className="p-2 text-left">Provider</th>
                <th className="p-2 text-left">Evento</th>
                <th className="p-2 text-left">E-mail</th>
                <th className="p-2 text-left">Sub ID</th>
                <th className="p-2 text-left">Tent.</th>
                <th className="p-2 text-left">Próx. retry</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableSkeleton rows={6} cols={8} />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    {status === "failed" ||
                    status === "dead_letter" ||
                    status === "pending_retry" ? (
                      <EmptyState
                        icon={CheckCircle2}
                        title="Nenhum webhook com problema 🎉"
                        description="Tudo processado."
                      />
                    ) : (
                      <EmptyState
                        icon={Inbox}
                        title="Nenhum evento encontrado"
                        description="Ajuste os filtros ou aguarde o próximo webhook."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openDetail(r.id)}
                    className="cursor-pointer border-t border-border/40 hover:bg-muted/20"
                  >
                    <td className="p-2 text-muted-foreground">{fmt(r.received_at)}</td>
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px]">
                        {r.provider}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{r.event_type}</td>
                    <td className="p-2 text-muted-foreground">{r.customer_email ?? "—"}</td>
                    <td className="p-2 font-mono text-[11px] text-muted-foreground">
                      {r.subscription_id ?? "—"}
                    </td>
                    <td className="p-2 text-center text-xs">{r.attempts ?? 0}</td>
                    <td className="p-2 text-[11px] text-muted-foreground">
                      {r.next_attempt_at ? fmt(r.next_attempt_at) : "—"}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={statusClass(r.status)}>
                        {r.status}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          <div>
            {total} eventos · página {page}/{totalPages}
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

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.event_type}</SheetTitle>
                <SheetDescription>
                  {selected.provider} · {fmt(selected.received_at)} ·{" "}
                  <Badge variant="outline" className={statusClass(selected.status)}>
                    {selected.status}
                  </Badge>
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <strong>E-mail:</strong> {selected.customer_email ?? "—"}
                  </div>
                  <div>
                    <strong>Subscription ID:</strong> <code>{selected.subscription_id ?? "—"}</code>
                  </div>
                  <div>
                    <strong>Tentativas:</strong> {selected.attempts ?? 0}
                  </div>
                  <div>
                    <strong>Última tentativa:</strong> {fmt(selected.last_attempt_at)}
                  </div>
                  <div>
                    <strong>Próximo retry:</strong> {fmt(selected.next_attempt_at)}
                  </div>
                  <div>
                    <strong>Reprocessado em:</strong> {fmt(selected.replayed_at)}
                  </div>
                </div>

                {selected.error && (
                  <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600">
                    <strong>Erro:</strong> {selected.error}
                  </div>
                )}

                {Array.isArray(selected.attempt_history) && selected.attempt_history.length > 0 && (
                  <div>
                    <strong className="mb-1 block">Histórico de tentativas</strong>
                    <div className="space-y-1 rounded border border-border/40 bg-muted/10 p-2 text-[11px]">
                      {(
                        selected.attempt_history as Array<{
                          attempt: number;
                          status: string;
                          at: string;
                          manual?: boolean;
                          error?: string;
                        }>
                      ).map((h, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 border-b border-border/20 pb-1 last:border-0"
                        >
                          <Badge
                            variant="outline"
                            className={`${statusClass(h.status)} shrink-0 text-[10px]`}
                          >
                            #{h.attempt} {h.status}
                          </Badge>
                          <div className="flex-1">
                            <div className="text-muted-foreground">
                              {fmt(h.at)}
                              {h.manual ? " · manual" : ""}
                            </div>
                            {h.error && <div className="text-red-600">{h.error}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <strong className="mb-1 block">Payload</strong>
                  <pre className="max-h-72 overflow-auto rounded border border-border/40 bg-muted/20 p-2 text-[11px]">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={() => replay(selected.id, false)}
                    disabled={busyReplay}
                    className="flex-1"
                  >
                    {busyReplay ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Reprocessar
                  </Button>
                  {(selected.status === "dead_letter" ||
                    selected.status === "failed" ||
                    selected.status === "pending_retry") && (
                    <Button
                      onClick={() => replay(selected.id, true)}
                      disabled={busyReplay}
                      variant="destructive"
                      className="flex-1"
                      title="Destrava lock e força reentrada imediata mesmo em dead-letter"
                    >
                      <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                      Forçar reprocessamento
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
