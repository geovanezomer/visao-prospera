// ============================================================================
// DashboardTab — visão de negócio (MRR, ARR, churn, signups, conversão).
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, TrendingUp, Users as UsersIcon, AlertTriangle, Activity, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDashboardMetrics, type DashboardMetrics } from "@/lib/admin/dashboard.functions";
import { DashboardCharts } from "@/components/admin/DashboardCharts";

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" | "info" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-600"
    : tone === "warn" ? "text-amber-600"
    : tone === "bad" ? "text-red-600"
    : tone === "info" ? "text-blue-600"
    : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneCls}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function DashboardTab() {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await getDashboardMetrics();
      setM(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar métricas.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  if (!m) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…</> : "Sem dados."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Visão geral</h2>
          <p className="text-xs text-muted-foreground">
            Atualizado às {new Date(m.generatedAt).toLocaleTimeString("pt-BR")}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Receita */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" /> Receita
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="MRR" value={brl(m.mrr)} sub="Receita mensal recorrente" tone="ok" />
          <Card label="ARR" value={brl(m.arr)} sub="Receita anualizada" tone="ok" />
          <Card label="Ativos" value={String(m.activeSubs)} sub="Assinaturas pagantes" />
          <Card label="Lifetime" value={String(m.lifetime)} sub="Acessos vitalícios" />
        </div>
      </div>

      {/* Funil */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <UsersIcon className="h-3.5 w-3.5" /> Aquisição & funil
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Signups 7d" value={String(m.signups7d)} />
          <Card label="Signups 30d" value={String(m.signups30d)} />
          <Card label="Em trial" value={String(m.trialing)} tone="info" />
          <Card label="Conversão trial→pago" value={pct(m.conversionTrialToPaid)} tone="info" />
        </div>
      </div>

      {/* Saúde */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Saúde da carteira
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Past due" value={String(m.pastDue)} sub="Inadimplência ativa" tone={m.pastDue > 0 ? "warn" : "ok"} />
          <Card label="Churn 30d" value={`${m.churnedLast30d}`} sub={`Taxa ${pct(m.churnRate30d)}`} tone={m.churnRate30d > 0.05 ? "bad" : "ok"} />
          <Card label="Cancelados (total)" value={String(m.canceled)} />
          <Card label="Webhooks 24h" value={`${m.webhook24h.ok}/${m.webhook24h.total}`} sub={m.webhook24h.failed > 0 ? `${m.webhook24h.failed} falhas` : "sem falhas"} tone={m.webhook24h.failed > 0 ? "warn" : "ok"} />
        </div>
      </div>

      {/* Distribuição */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Distribuição
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground">Por provider</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">Stripe: {m.byProvider.stripe}</Badge>
              <Badge variant="outline">Asaas: {m.byProvider.asaas}</Badge>
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground">Por plano</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(m.byPlan).length === 0
                ? <span className="text-xs text-muted-foreground">—</span>
                : Object.entries(m.byPlan).map(([p, n]) => (
                    <Badge key={p} variant="outline">{p}: {n}</Badge>
                  ))}
            </div>
          </div>
        </div>
      </div>

      {/* Funil de Trial */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Funil de Trial (Landing → Magic Link → Pago)
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Solicitações" value={String(m.trialFunnel.requested)} sub={`${m.trialFunnel.last30dRequested} nos últimos 30d`} tone="info" />
          <Card label="Ativados" value={String(m.trialFunnel.activated)} sub={`Taxa: ${pct(m.trialFunnel.activationRate)}`} />
          <Card label="Convertidos" value={String(m.trialFunnel.converted)} sub={`${m.trialFunnel.last30dConverted} nos últimos 30d`} tone={m.trialFunnel.converted > 0 ? "ok" : undefined} />
          <Card label="Conversão" value={pct(m.trialFunnel.conversionRate)} sub={m.trialFunnel.avgTimeToConvertHours > 0 ? `Tempo médio: ${m.trialFunnel.avgTimeToConvertHours.toFixed(1)}h` : "—"} tone="ok" />
        </div>
      </div>

      {/* Gráficos */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" /> Gráficos
        </div>
        <DashboardCharts />
      </div>
    </div>
  );
}

