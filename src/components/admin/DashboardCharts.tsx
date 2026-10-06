// ============================================================================
// Gráficos do Dashboard Admin com:
//  - Seletor de período (6 / 12 / 24 meses)
//  - Tooltips informativos (delta vs mês anterior)
//  - Legendas clicáveis (esconder/mostrar séries)
//  - Destaques automáticos: maior alta e maior queda no período
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ArrowUp, ArrowDown } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  PieChart,
  Pie,
  Cell,
  ReferenceDot,
} from "recharts";
import {
  getDashboardCharts,
  type DashboardCharts as ChartsData,
  type MonthlyPoint,
} from "@/lib/admin/dashboardCharts.functions";

const PIE_COLORS = [
  "#10b981",
  "var(--primary)",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
];
const PERIODS = [6, 12, 24] as const;
type Period = (typeof PERIODS)[number];

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}
function fmtNum(v: number): string {
  return v.toLocaleString("pt-BR");
}
function fmtDelta(v: number, isCurrency: boolean): { txt: string; positive: boolean | null } {
  if (!Number.isFinite(v) || v === 0) return { txt: "—", positive: null };
  const sign = v > 0 ? "+" : "";
  return { txt: `${sign}${isCurrency ? brl(v) : fmtNum(v)}`, positive: v > 0 };
}

// Calcula maior alta e maior queda mês-a-mês para uma série.
function pickExtremes(points: MonthlyPoint[], key: keyof MonthlyPoint) {
  let maxUp = { idx: -1, delta: 0 };
  let maxDown = { idx: -1, delta: 0 };
  for (let i = 1; i < points.length; i++) {
    const prev = Number(points[i - 1][key] ?? 0);
    const cur = Number(points[i][key] ?? 0);
    const d = cur - prev;
    if (d > maxUp.delta) maxUp = { idx: i, delta: d };
    if (d < maxDown.delta) maxDown = { idx: i, delta: d };
  }
  return { maxUp, maxDown };
}

// Tooltip customizado com delta vs mês anterior.
// Shapes locais para callbacks do Recharts (impedância da lib: typings
// genéricos com `any` no upstream). Tipamos só o que efetivamente lemos.
type TooltipPayloadItem = {
  dataKey: string;
  value: number | string;
  name?: string;
  color?: string;
  payload?: Record<string, unknown>;
};
type LegendClickArg = { dataKey?: unknown; value?: string };
type FunnelTooltipItem = { payload?: { stage?: string } };
type PieLabelArg = { plan: string; value: number };

function MonthlyTooltip({
  active,
  payload,
  label,
  data,
  formatters,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  data: MonthlyPoint[];
  formatters: Record<string, (v: number) => string>;
}) {
  if (!active || !payload?.length) return null;
  const idx = data.findIndex((d) => d.label === label);
  const prev = idx > 0 ? data[idx - 1] : null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold">{label}</div>
      {payload.map((p) => {
        const fmt = formatters[p.dataKey] ?? fmtNum;
        const cur = Number(p.value ?? 0);
        const prevVal = prev
          ? Number((prev as unknown as Record<string, number>)[p.dataKey] ?? 0)
          : 0;
        const d = fmtDelta(cur - prevVal, p.dataKey === "mrr");
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: p.color }}
              />
              {p.name}
            </span>
            <span className="tabular-nums">
              <strong>{fmt(cur)}</strong>
              {prev ? (
                <span
                  className={
                    d.positive === true
                      ? "ml-2 text-emerald-600"
                      : d.positive === false
                        ? "ml-2 text-red-600"
                        : "ml-2 text-muted-foreground"
                  }
                >
                  {d.txt}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  headerExtra,
  children,
}: {
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        {headerExtra}
      </div>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

function ExtremesBadges({
  data,
  series,
}: {
  data: MonthlyPoint[];
  series: { key: keyof MonthlyPoint; label: string; isCurrency?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {series.map((s) => {
        const { maxUp, maxDown } = pickExtremes(data, s.key);
        const fmt = (v: number) => (s.isCurrency ? brl(v) : fmtNum(v));
        return (
          <div key={String(s.key)} className="flex items-center gap-1">
            {maxUp.idx >= 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                title={`${s.label}: maior alta em ${data[maxUp.idx].label}`}
              >
                <ArrowUp className="h-3 w-3" />
                {fmt(maxUp.delta)} ({data[maxUp.idx].label})
              </span>
            )}
            {maxDown.idx >= 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400"
                title={`${s.label}: maior queda em ${data[maxDown.idx].label}`}
              >
                <ArrowDown className="h-3 w-3" />
                {fmt(maxDown.delta)} ({data[maxDown.idx].label})
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DashboardCharts() {
  const [period, setPeriod] = useState<Period>(12);
  const [data, setData] = useState<ChartsData | null>(null);
  const [loading, setLoading] = useState(false);
  // visibilidade por série (legendas clicáveis)
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const r = await getDashboardCharts({ data: { months: period } });
        if (!cancel) setData(r);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar gráficos.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [period]);

  const toggle = (key: string) => setHidden((h) => ({ ...h, [key]: !h[key] }));

  const mrrExtremes = useMemo(() => (data ? pickExtremes(data.monthly, "mrr") : null), [data]);

  if (loading && !data) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando gráficos…
      </div>
    );
  }
  if (!data) return null;

  const monthly = data.monthly;

  return (
    <div className="space-y-4">
      {/* Seletor de período */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Período: últimos <strong>{period}</strong> meses
          {loading ? <Loader2 className="ml-2 inline h-3 w-3 animate-spin" /> : null}
        </div>
        <div className="inline-flex rounded-md border border-border/60 bg-card p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {p} meses
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1. MRR + Churn */}
        <Panel
          title="MRR e Churn"
          subtitle="Receita mensal recorrente e cancelamentos"
          headerExtra={
            <ExtremesBadges
              data={monthly}
              series={[
                { key: "mrr", label: "MRR", isCurrency: true },
                { key: "churned", label: "Churn" },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => brl(v)}
                width={80}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                allowDecimals={false}
              />
              <Tooltip
                content={
                  <MonthlyTooltip
                    data={monthly}
                    formatters={{ mrr: (v) => brl(v), churned: (v) => fmtNum(v) }}
                  />
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                onClick={(e: LegendClickArg) => toggle(String(e.dataKey ?? ""))}
              />
              {!hidden.mrr && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="mrr"
                  name="MRR"
                  stroke="#10b981"
                  fill="url(#mrrFill)"
                />
              )}
              {!hidden.churned && (
                <Bar yAxisId="right" dataKey="churned" name="Churn" fill="#ef4444" />
              )}
              {/* Destaques: maior alta/queda de MRR */}
              {!hidden.mrr && mrrExtremes && mrrExtremes.maxUp.idx >= 0 && (
                <ReferenceDot
                  yAxisId="left"
                  x={monthly[mrrExtremes.maxUp.idx].label}
                  y={monthly[mrrExtremes.maxUp.idx].mrr}
                  r={6}
                  fill="#10b981"
                  stroke="#fff"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              )}
              {!hidden.mrr && mrrExtremes && mrrExtremes.maxDown.idx >= 0 && (
                <ReferenceDot
                  yAxisId="left"
                  x={monthly[mrrExtremes.maxDown.idx].label}
                  y={monthly[mrrExtremes.maxDown.idx].mrr}
                  r={6}
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        {/* 2. Funil */}
        <Panel title="Funil de Conversão" subtitle="Do signup até a ativação paga">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.funnel}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 32, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={140} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(v: number | string, _n: string, item: FunnelTooltipItem) => {
                  const idx = data.funnel.findIndex((f) => f.stage === item.payload?.stage);
                  const top = data.funnel[0]?.value || 0;
                  const prev = idx > 0 ? data.funnel[idx - 1].value : top;
                  const ratioTop = top > 0 ? ((Number(v) / top) * 100).toFixed(1) : "0";
                  const ratioPrev = prev > 0 ? ((Number(v) / prev) * 100).toFixed(1) : "0";
                  return [
                    `${fmtNum(Number(v))} (${ratioPrev}% etapa anterior · ${ratioTop}% do topo)`,
                    "Usuários",
                  ];
                }}
              />
              <Bar dataKey="value" name="Usuários" fill="var(--primary)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* 3. Novos vs Ativos */}
        <Panel
          title="Novos usuários vs Ativos"
          subtitle="Crescimento da base"
          headerExtra={
            <ExtremesBadges
              data={monthly}
              series={[
                { key: "newUsers", label: "Novos" },
                { key: "activeUsers", label: "Ativos" },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                content={
                  <MonthlyTooltip
                    data={monthly}
                    formatters={{ newUsers: fmtNum, activeUsers: fmtNum }}
                  />
                }
              />
              <Legend
                wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                onClick={(e: LegendClickArg) => toggle(String(e.dataKey ?? ""))}
              />
              {!hidden.newUsers && (
                <Line
                  type="monotone"
                  dataKey="newUsers"
                  name="Novos"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              )}
              {!hidden.activeUsers && (
                <Line
                  type="monotone"
                  dataKey="activeUsers"
                  name="Ativos"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        {/* 4. Por plano */}
        <Panel title="Distribuição por plano" subtitle="Mix de assinaturas ativas">
          {data.byPlan.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sem dados.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v: number | string, n: string) => {
                    const total = data.byPlan.reduce((acc, x) => acc + x.value, 0);
                    const pct = total > 0 ? ((Number(v) / total) * 100).toFixed(1) : "0";
                    return [`${fmtNum(Number(v))} (${pct}%)`, n];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                  onClick={(e: LegendClickArg) => toggle(`plan:${e.value ?? ""}`)}
                />
                <Pie
                  data={data.byPlan.filter((p) => !hidden[`plan:${p.plan}`])}
                  dataKey="value"
                  nameKey="plan"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  label={(e: PieLabelArg) => `${e.plan}: ${e.value}`}
                >
                  {data.byPlan
                    .filter((p) => !hidden[`plan:${p.plan}`])
                    .map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>
    </div>
  );
}
