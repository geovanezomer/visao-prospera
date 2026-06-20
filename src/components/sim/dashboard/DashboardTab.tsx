/**
 * DashboardTab — Visão executiva com gráficos resumidos dos principais
 * indicadores financeiros da empresa. Lê o estado real (sem simulação)
 * e deriva tudo do `useFinanceModel` (SSOT da engine).
 */
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, fmtPct, MESES, sum } from "@/engines/finance/format";
import { StatCard } from "@/components/sim/shared/primitives";
import { HistoricalYearPills } from "@/components/sim/shared/HistoricalYearPills";
import { IndicatorsCharts } from "./IndicatorsCharts";
import { DashboardExtras } from "./DashboardExtras";

const COLORS = ["#00E5A0", "#5BA8F5", "#F5B85B", "#C77DFF", "#FF6B6B", "#7DD3FC", "#FACC15"];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

// Gauge semi-circular simples baseado em PieChart (sem libs extras).
function Gauge({
  label,
  value,
  max,
  suffix = "%",
  good = "high",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  good?: "high" | "low";
}) {
  const clamped = Math.max(0, Math.min(value, max));
  const ratio = max > 0 ? clamped / max : 0;
  const tone = good === "high" ? (ratio > 0.66 ? "#00E5A0" : ratio > 0.33 ? "#F5B85B" : "#FF6B6B")
                                : (ratio < 0.33 ? "#00E5A0" : ratio < 0.66 ? "#F5B85B" : "#FF6B6B");
  const data = [
    { name: "v", value: clamped, fill: tone },
    { name: "r", value: Math.max(0, max - clamped), fill: "var(--muted)" },
  ];
  return (
    <div className="rounded-lg border border-border/40 bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="relative h-32">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              innerRadius="65%"
              outerRadius="95%"
              stroke="none"
            >
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-end justify-center pb-2">
          <span className="mono text-2xl font-bold text-foreground">
            {value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            <span className="text-sm text-muted-foreground">{suffix}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

export function DashboardTab() {
  const state = useFinanceState();
  const { dre, ind } = useFinanceModel(state);

  // Receita mensal + margem líquida acumulada
  const receitaMargem = useMemo(
    () =>
      MESES.map((m, i) => {
        const rec = dre.receitaLiquida[i] ?? 0;
        const ll = dre.lucroLiquido[i] ?? 0;
        return {
          mes: m,
          Receita: rec,
          "Margem %": rec > 0 ? (ll / rec) * 100 : 0,
        };
      }),
    [dre],
  );

  // Estrutura de capital (PL vs Dívida onerosa)
  const capitalPie = useMemo(() => {
    const pl = Math.max(0, ind.capitalInvestido - ind.dividaOnerosa);
    return [
      { name: "Patrimônio Líquido", value: pl },
      { name: "Dívida Onerosa", value: ind.dividaOnerosa },
    ].filter((d) => d.value > 0);
  }, [ind]);

  // Composição de despesas
  const despesasPie = useMemo(
    () =>
      Object.entries(dre.despesasPorCategoria)
        .map(([k, v]) => ({ name: k, value: sum(v) }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [dre],
  );

  // Lucro acumulado (área)
  const acumulado = useMemo(() => {
    let acc = 0;
    return MESES.map((m, i) => {
      acc += dre.lucroLiquido[i] ?? 0;
      return { mes: m, Acumulado: acc };
    });
  }, [dre]);

  // Radar do perfil financeiro (normalizado 0–100)
  const radar = useMemo(
    () => [
      { eixo: "Margem Líq.", valor: Math.max(0, Math.min(100, ind.margemLiquida * 5)) },
      { eixo: "ROE", valor: Math.max(0, Math.min(100, ind.roe * 4)) },
      { eixo: "ROIC", valor: Math.max(0, Math.min(100, ind.roic * 4)) },
      { eixo: "Liquidez", valor: Math.max(0, Math.min(100, ind.liquidezCorrente * 33)) },
      { eixo: "Cob. Juros", valor: Math.max(0, Math.min(100, ind.coberturaJuros * 20)) },
      { eixo: "Cap. Próprio", valor: Math.max(0, Math.min(100, ind.proprioPercent)) },
    ],
    [ind],
  );

  return (
    <div className="space-y-6">
      <HistoricalYearPills />

      <div>
        <h2 className="text-xl font-bold text-foreground">Dashboard Executivo</h2>
        <p className="text-sm text-muted-foreground">
          Visão consolidada dos principais indicadores financeiros da empresa.
        </p>
      </div>

      {/* Elementos visuais para o empresário: runway, semáforos, score,
          cronograma de dívidas e top 5 despesas */}
      <DashboardExtras state={state} />



      {/* Linha 1 — KPIs em gauges */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Gauge label="Margem Líquida" value={ind.margemLiquida} max={30} />
        <Gauge label="ROE" value={ind.roe} max={30} />
        <Gauge label="Liquidez Corrente" value={ind.liquidezCorrente} max={3} suffix="x" />
        <Gauge label="Endividamento Geral" value={ind.endividamentoGeral} max={100} good="low" />
      </div>

      {/* Linha 2 — Cards numéricos resumo */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Receita Líquida (12m)" value={fmtBRL(ind.receitaLiquidaAnual)} />
        <StatCard label="EBITDA (12m)" value={fmtBRL(ind.ebitdaAnual)} />
        <StatCard label="Lucro Líquido (12m)" value={fmtBRL(ind.lucroLiquidoAnual)} />
        <StatCard label="FCF após Capex" value={fmtBRL(ind.fcfAposCapex)} />
      </div>

      {/* Linha 3 — Combo Receita + Margem  |  Estrutura de Capital */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Receita Mensal × Margem Líquida (%)">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={receitaMargem}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
                <YAxis
                  yAxisId="left"
                  stroke="#9ca3af"
                  fontSize={10}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#9ca3af"
                  fontSize={10}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n) => n === "Margem %" ? `${v.toFixed(1)}%` : fmtBRL(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="Receita" fill="#5BA8F5" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="Margem %" stroke="#00E5A0" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="Estrutura de Capital">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={capitalPie} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                {capitalPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Linha 4 — Lucro acumulado | Despesas | Radar */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Lucro Líquido Acumulado (12m)">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={acumulado}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00E5A0" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#00E5A0" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Area type="monotone" dataKey="Acumulado" stroke="#00E5A0" fill="url(#grad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Composição de Despesas">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={despesasPie} dataKey="value" nameKey="name" outerRadius="85%">
                {despesasPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Perfil Financeiro (Radar)">
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radar}>
              <PolarGrid stroke="#ffffff20" />
              <PolarAngleAxis dataKey="eixo" tick={{ fill: "#9ca3af", fontSize: 10 }} />
              <Radar dataKey="valor" stroke="#5BA8F5" fill="#5BA8F5" fillOpacity={0.4} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v.toFixed(0)}/100`} />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Gráficos detalhados (movidos da aba Indicadores) */}
      <IndicatorsCharts state={state} />
    </div>
  );
}

