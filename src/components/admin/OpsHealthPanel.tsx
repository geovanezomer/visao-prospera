// ============================================================================
// Painel de operação: luzes de banco, backup, restauração, Odoo e erros, e a
// lista dos erros capturados (servidor, navegador e rotinas).
// ============================================================================
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleSlash,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getOpsHealth, runOpsAlertsNow } from "@/lib/admin/ops.functions";

type Health = Awaited<ReturnType<typeof getOpsHealth>>;
type Level = Health["checks"][number]["level"];

function Light({ level }: { level: Level }) {
  if (level === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (level === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (level === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
  return <CircleSlash className="h-4 w-4 text-muted-foreground" />;
}

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null;

export function OpsHealthPanel() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getOpsHealth());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler a saúde do sistema");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const alertNow = async () => {
    try {
      const r = await runOpsAlertsNow();
      toast.success(
        r.alerts
          ? `${r.alerts} aviso(s) gerado(s), ${r.sent} e-mail(s) enviado(s)`
          : "Nada a avisar",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao verificar alertas");
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {data && <Light level={data.level} />} Operação
          </h3>
          <p className="text-xs text-muted-foreground">
            Banco, backup diário, teste de restauração, sincronização do Odoo e erros. Falhas geram
            e-mail para o destinatário de notificações (verificação a cada 15 min).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void alertNow()}>
            <BellRing className="mr-1.5 h-3.5 w-3.5" /> Verificar alertas agora
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data?.checks.map((c) => (
          <div key={c.key} className="rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <Light level={c.level} />
              <span className="text-sm font-medium">{c.label}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{c.message}</p>
            {c.at && <p className="mt-0.5 text-[10px] text-muted-foreground">{when(c.at)}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-md border border-border/60">
        <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold">
          Erros capturados (últimos 30 tipos)
        </div>
        {!data?.errors.length ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">Nenhum erro registrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/40">
                  <th className="px-3 py-1.5 text-left font-medium">Erro</th>
                  <th className="px-2 py-1.5 text-left font-medium">Origem</th>
                  <th className="px-2 py-1.5 text-right font-medium">Vezes</th>
                  <th className="px-3 py-1.5 text-right font-medium">Último</th>
                </tr>
              </thead>
              <tbody>
                {data.errors.map((e) => (
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer border-b border-border/20 hover:bg-muted/40"
                      onClick={() => setOpen(open === e.id ? null : e.id)}
                    >
                      <td className="max-w-[420px] px-3 py-1.5">
                        <div className="truncate font-mono">{e.message}</div>
                        {e.path && (
                          <div className="truncate text-[10px] text-muted-foreground">{e.path}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {e.source === "server"
                            ? "servidor"
                            : e.source === "client"
                              ? "navegador"
                              : "rotina"}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{e.count}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {when(e.lastSeen)}
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr className="border-b border-border/20 bg-muted/20">
                        <td colSpan={4} className="px-3 py-2">
                          <p className="mb-1 text-[10px] text-muted-foreground">
                            Primeira ocorrência: {when(e.firstSeen)}
                          </p>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
                            {e.stack ?? "sem pilha"}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
