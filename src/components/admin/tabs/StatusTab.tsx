// ============================================================================
// StatusTab — saúde dos serviços externos (PostgreSQL, Stripe, e-mail, Asaas, AI).
// ============================================================================
import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getSystemStatus, type ServiceStatus } from "@/lib/admin/status.functions";
import { OpsHealthPanel } from "@/components/admin/OpsHealthPanel";

function Light({ s }: { s: ServiceStatus["status"] }) {
  if (s === "operational") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (s === "degraded") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (s === "down") return <XCircle className="h-4 w-4 text-destructive" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
}

export function StatusTab() {
  const [checks, setChecks] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getSystemStatus();
      setChecks(r.checks);
      setCheckedAt(r.checkedAt);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-6">
      <OpsHealthPanel />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Status dos serviços</h3>
            <p className="text-xs text-muted-foreground">
              Última verificação:{" "}
              {checkedAt ? new Date(checkedAt).toLocaleTimeString("pt-BR") : "—"} · refresh
              automático 60s
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Recheck
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {checks.map((c) => (
            <div key={c.name} className="rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Light s={c.status} />
                  <span className="text-sm font-medium">{c.name}</span>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {c.latencyMs ?? "—"} ms
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
