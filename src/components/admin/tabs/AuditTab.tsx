// ============================================================================
// AuditTab — registro de ações administrativas.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, ScrollText } from "lucide-react";
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
import { listAuditLog } from "@/lib/admin/audit.functions";
import { TableSkeleton, EmptyState } from "@/components/admin/ui-states";

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

const ACTIONS = [
  { v: "", label: "Todas" },
  { v: "user.activate", label: "Ativar usuário" },
  { v: "user.deactivate", label: "Desativar usuário" },
  { v: "user.password_reset", label: "Reset de senha" },
  { v: "payment.refund", label: "Estorno" },
  { v: "webhook.replay", label: "Replay webhook" },
];

const RESOURCES = [
  { v: "", label: "Todos" },
  { v: "user", label: "user" },
  { v: "subscription", label: "subscription" },
  { v: "webhook_event", label: "webhook_event" },
];

export function AuditTab() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listAuditLog>>["rows"]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await listAuditLog({
        data: {
          page,
          perPage,
          search,
          action: action || undefined,
          resource: resource || undefined,
        },
      });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [page, action, resource]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      void load();
    }, 350);
    return () => clearTimeout(t); /* eslint-disable-next-line */
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="relative w-full sm:max-w-xs">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e-mail, target_id…"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Ação</Label>
          <Select value={action || "all"} onValueChange={(v) => setAction(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => (
                <SelectItem key={a.v || "all"} value={a.v || "all"}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Recurso</Label>
          <Select
            value={resource || "all"}
            onValueChange={(v) => setResource(v === "all" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOURCES.map((a) => (
                <SelectItem key={a.v || "all"} value={a.v || "all"}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-9">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Data</th>
              <th className="px-3 py-2 text-left font-medium">Ator</th>
              <th className="px-3 py-2 text-left font-medium">Ação</th>
              <th className="px-3 py-2 text-left font-medium">Recurso</th>
              <th className="px-3 py-2 text-left font-medium">Alvo</th>
              <th className="px-3 py-2 text-left font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-0">
                  <TableSkeleton rows={6} cols={6} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-0">
                  <EmptyState
                    icon={ScrollText}
                    title="Sem registros de auditoria"
                    description="Nenhuma ação administrativa foi registrada para os filtros atuais."
                  />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="px-3 py-2">{r.actor_email ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {r.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.resource}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.target_label ?? r.target_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.ip ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total} registros</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="h-7"
          >
            Anterior
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="h-7"
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
