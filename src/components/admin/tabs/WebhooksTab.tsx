// ============================================================================
// WebhooksTab — histórico + replay.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  listWebhookEvents, getWebhookEvent, replayWebhookEvent,
} from "@/lib/admin/webhooks.functions";

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}
function statusClass(s: string) {
  if (s === "processed") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
  if (s === "replayed") return "bg-blue-500/10 text-blue-600 border-blue-500/30";
  if (s === "failed") return "bg-red-500/10 text-red-600 border-red-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export function WebhooksTab() {
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [kpi, setKpi] = useState({ total: 0, ok: 0, failed: 0 });
  const [page, setPage] = useState(1); const [perPage] = useState(50);
  const [search, setSearch] = useState(""); const [provider, setProvider] = useState<any>("all"); const [status, setStatus] = useState<any>("all");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null); const [busyReplay, setBusyReplay] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listWebhookEvents({ data: { page, perPage, search, provider, status } });
      setRows(r.rows); setTotal(r.total); setKpi(r.kpi24h);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [page, provider, status]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); void load(); }, 350); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search]);

  const openDetail = async (id: string) => {
    try { const r = await getWebhookEvent({ data: { id } }); setSelected(r.event); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
  };
  const replay = async (id: string) => {
    setBusyReplay(true);
    try { await replayWebhookEvent({ data: { id } }); toast.success("Reprocessado."); void load(); setSelected(null); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha."); }
    finally { setBusyReplay(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Últimas 24h</div><div className="mt-1 text-2xl font-bold">{kpi.total}</div></div>
        <div className="rounded-lg border border-border/60 bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Sucesso</div><div className="mt-1 text-2xl font-bold text-emerald-600">{kpi.ok}</div></div>
        <div className="rounded-lg border border-border/60 bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Falhas</div><div className="mt-1 text-2xl font-bold text-red-600">{kpi.failed}</div></div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative w-full sm:max-w-xs">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e-mail, subscription_id, event_type…" className="h-9 pl-8" />
          </div>
        </div>
        <div><Label className="text-xs">Provider</Label>
          <Select value={provider} onValueChange={setProvider}><SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="stripe">Stripe</SelectItem><SelectItem value="asaas">Asaas</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem><SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem><SelectItem value="skipped">Skipped</SelectItem><SelectItem value="replayed">Replayed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={load} disabled={loading} size="sm" variant="outline" className="self-end">
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Atualizar
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Provider</th><th className="p-2 text-left">Evento</th><th className="p-2 text-left">E-mail</th><th className="p-2 text-left">Sub ID</th><th className="p-2 text-left">Status</th></tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum evento.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} onClick={() => openDetail(r.id)} className="cursor-pointer border-t border-border/40 hover:bg-muted/20">
                  <td className="p-2 text-muted-foreground">{fmt(r.received_at)}</td>
                  <td className="p-2"><Badge variant="outline" className="text-[10px]">{r.provider}</Badge></td>
                  <td className="p-2 font-mono text-xs">{r.event_type}</td>
                  <td className="p-2 text-muted-foreground">{r.customer_email ?? "—"}</td>
                  <td className="p-2 font-mono text-[11px] text-muted-foreground">{r.subscription_id ?? "—"}</td>
                  <td className="p-2"><Badge variant="outline" className={statusClass(r.status)}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
          <div>{total} eventos · página {page}/{totalPages}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.event_type}</SheetTitle>
                <SheetDescription>{selected.provider} · {fmt(selected.received_at)} · <Badge variant="outline" className={statusClass(selected.status)}>{selected.status}</Badge></SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <div><strong>E-mail:</strong> {selected.customer_email ?? "—"}</div>
                <div><strong>Subscription ID:</strong> <code className="text-xs">{selected.subscription_id ?? "—"}</code></div>
                {selected.error && <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-600"><strong>Erro:</strong> {selected.error}</div>}
                <div>
                  <strong className="mb-1 block">Payload</strong>
                  <pre className="max-h-96 overflow-auto rounded border border-border/40 bg-muted/20 p-2 text-[11px]">{JSON.stringify(selected.payload, null, 2)}</pre>
                </div>
                <Button onClick={() => replay(selected.id)} disabled={busyReplay} className="w-full">
                  {busyReplay ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1.5 h-3.5 w-3.5" />}Reprocessar evento
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
