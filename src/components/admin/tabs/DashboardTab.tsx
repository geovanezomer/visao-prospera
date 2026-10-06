// ============================================================================
// DashboardTab — visão de negócio com janela comparável (7/30/90d),
// deltas por métrica, sparklines e funil de conversão do período.
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  TrendingUp,
  Users as UsersIcon,
  AlertTriangle,
  Activity,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { ResponsiveContainer, LineChart, Line } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Route as AdminRoute } from "@/routes/admin";
import {
  getDashboardMetrics,
  type DashboardMetrics,
  type Delta,
  type PeriodDays,
  type SeriesPoint,
} from "@/lib/admin/dashboard.functions";
import { CardSkeletonGrid } from "@/components/admin/ui-states";
import { fmtNum } from "@/engines/finance/format";

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}
function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

// ── Delta helpers ────────────────────────────────────────────────────────────
type DeltaDirection = "up" | "down" | "flat" | "new";
function deltaOf(d: Delta): { direction: DeltaDirection; ratio: number } {
  if (d.previous === 0) return { direction: "new", ratio: 0 };
  const diff = d.current - d.previous;
  const ratio = diff / d.previous;
  if (Math.abs(ratio) < 0.001) return { direction: "flat", ratio: 0 };
  return { direction: diff > 0 ? "up" : "down", ratio };
}

/** Cor semântica: `higherIsBetter=false` para churn/pastDue. */
function DeltaBadge({ d, higherIsBetter = true }: { d: Delta; higherIsBetter?: boolean }) {
  const { direction, ratio } = deltaOf(d);
  if (direction === "new") return <span className="text-[10px] text-muted-foreground">novo</span>;
  if (direction === "flat")
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" />
        0%
      </span>
    );
  const good = (direction === "up") === higherIsBetter;
  const cls = good ? "text-emerald-600" : "text-red-600";
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {fmtNum(Math.abs(ratio) * 100, 1)}%
    </span>
  );
}

// ── Card com delta e sparkline opcional ──────────────────────────────────────
type CardTone = "ok" | "warn" | "bad" | "info" | undefined;
function Card({
  label,
  value,
  sub,
  tone,
  delta,
  higherIsBetter = true,
  sparkKey,
  series,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: CardTone;
  delta?: Delta;
  higherIsBetter?: boolean;
  sparkKey?: keyof SeriesPoint;
  series?: SeriesPoint[];
}) {
  const toneCls =
    tone === "ok"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-red-600"
          : tone === "info"
            ? "text-blue-600"
            : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        {delta ? <DeltaBadge d={delta} higherIsBetter={higherIsBetter} /> : null}
      </div>
      <div className={`mt-1 text-2xl font-bold ${toneCls}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      {sparkKey && series && series.length > 1 ? (
        <div className="mt-2 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
              <Line
                type="monotone"
                dataKey={sparkKey as string}
                stroke="currentColor"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                className={toneCls}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

// ── Funil horizontal ────────────────────────────────────────────────────────
function FunnelStep({ label, value, rate }: { label: string; value: number; rate?: string }) {
  return (
    <div className="flex-1 rounded-md border border-border/60 bg-card px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-bold">{value}</span>
        {rate ? <span className="text-[11px] text-muted-foreground">{rate}</span> : null}
      </div>
    </div>
  );
}

export function DashboardTab() {
  const { period } = AdminRoute.useSearch();
  const navigate = useNavigate();
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  const setPeriod = (p: PeriodDays) => {
    navigate({
      to: "/admin",
      search: (prev: Record<string, unknown>) => ({ ...prev, period: p }),
      replace: true,
    });
  };

  const load = async (p: PeriodDays) => {
    setLoading(true);
    try {
      const r = await getDashboardMetrics({ data: { periodDays: p } });
      setM(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar métricas.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(period as PeriodDays);
  }, [period]);

  if (!m) {
    return (
      <div className="space-y-6" aria-busy={loading}>
        <CardSkeletonGrid count={4} />
        <CardSkeletonGrid count={4} />
        <CardSkeletonGrid count={4} />
      </div>
    );
  }

  // Taxas do funil (cada etapa em relação à anterior).
  const f = m.funnel;
  const rate = (num: number, den: number) => (den > 0 ? `${fmtNum((num / den) * 100, 0)}%` : "—");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Visão geral</h2>
          <p className="text-xs text-muted-foreground">
            Janela: {m.periodDays}d atuais vs. {m.periodDays}d anteriores · atualizado às{" "}
            {new Date(m.generatedAt).toLocaleTimeString("pt-BR")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={String(m.periodDays)}
            onValueChange={(v) => v && setPeriod(Number(v) as PeriodDays)}
          >
            <ToggleGroupItem value="7">7d</ToggleGroupItem>
            <ToggleGroupItem value="30">30d</ToggleGroupItem>
            <ToggleGroupItem value="90">90d</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" variant="outline" onClick={() => load(m.periodDays)} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Receita */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" /> Receita
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card
            label="MRR"
            value={brl(m.mrr.current)}
            sub="Receita mensal recorrente"
            tone="ok"
            delta={m.mrr}
            sparkKey="mrrCents"
            series={m.series}
          />
          <Card
            label="ARR"
            value={brl(m.arr.current)}
            sub="Receita anualizada"
            tone="ok"
            delta={m.arr}
          />
          <Card
            label="Ativos"
            value={String(m.activeSubs.current)}
            sub="Assinaturas pagantes"
            delta={m.activeSubs}
          />
          <Card label="Lifetime" value={String(m.snapshot.lifetime)} sub="Acessos vitalícios" />
        </div>
      </div>

      {/* Aquisição */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <UsersIcon className="h-3.5 w-3.5" /> Aquisição
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card
            label={`Signups (${m.periodDays}d)`}
            value={String(m.signups.current)}
            delta={m.signups}
            sparkKey="signups"
            series={m.series}
          />
          <Card
            label={`Trials (${m.periodDays}d)`}
            value={String(m.trials.current)}
            tone="info"
            delta={m.trials}
          />
          <Card label="Em trial (agora)" value={String(m.snapshot.trialing)} tone="info" />
          <Card
            label="Conversão trial→pago"
            value={pct(m.conversion.current)}
            tone="info"
            delta={m.conversion}
          />
        </div>
      </div>

      {/* Saúde */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Saúde da carteira
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card
            label="Past due (agora)"
            value={String(m.snapshot.pastDue)}
            sub="Inadimplência ativa"
            tone={m.snapshot.pastDue > 0 ? "warn" : "ok"}
          />
          <Card
            label={`Churn (${m.periodDays}d)`}
            value={String(m.churn.current)}
            tone={m.churn.current > m.churn.previous ? "bad" : "ok"}
            delta={m.churn}
            higherIsBetter={false}
            sparkKey="churn"
            series={m.series}
          />
          <Card label="Cancelados (total)" value={String(m.snapshot.canceled)} />
          <Card
            label="Webhooks 24h"
            value={`${m.snapshot.webhook24h.ok}/${m.snapshot.webhook24h.total}`}
            sub={
              m.snapshot.webhook24h.failed > 0
                ? `${m.snapshot.webhook24h.failed} falhas`
                : "sem falhas"
            }
            tone={m.snapshot.webhook24h.failed > 0 ? "warn" : "ok"}
          />
        </div>
      </div>

      {/* Funil do período */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Funil do período ({m.periodDays}d)
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
          <FunnelStep label="Trials solicitados" value={f.trialsRequested} />
          <div className="hidden md:flex items-center px-1 text-muted-foreground">→</div>
          <FunnelStep
            label="Trials ativados"
            value={f.trialsActivated}
            rate={rate(f.trialsActivated, f.trialsRequested)}
          />
          <div className="hidden md:flex items-center px-1 text-muted-foreground">→</div>
          <FunnelStep
            label="Checkouts iniciados"
            value={f.checkoutsStarted}
            rate={rate(f.checkoutsStarted, f.trialsActivated)}
          />
          <div className="hidden md:flex items-center px-1 text-muted-foreground">→</div>
          <FunnelStep label="Pagos" value={f.paid} rate={rate(f.paid, f.checkoutsStarted)} />
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
              <Badge variant="outline">Stripe: {m.snapshot.byProvider.stripe}</Badge>
              <Badge variant="outline">Asaas: {m.snapshot.byProvider.asaas}</Badge>
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground">Por plano</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(m.snapshot.byPlan).length === 0 ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : (
                Object.entries(m.snapshot.byPlan).map(([p, n]) => (
                  <Badge key={p} variant="outline">
                    {p}: {String(n)}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
