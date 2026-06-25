// ============================================================================
// Gráficos do Dashboard Admin:
//  1. MRR + Churn (área + barras)
//  2. Funil de conversão (barras horizontais)
//  3. Novos usuários vs Ativos (linha dupla)
//  4. Distribuição por plano (donut)
// ============================================================================
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
} from "recharts";
import {
  getDashboardCharts,
  type DashboardCharts as ChartsData,
} from "@/lib/admin/dashboardCharts.functions";

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

export function DashboardCharts() {
  const [data, setData] = useState<ChartsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await getDashboardCharts();
        setData(r);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao carregar gráficos.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando gráficos…
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 1. MRR + Churn */}
      <Panel title="MRR e Churn (12 meses)" subtitle="Receita mensal recorrente e cancelamentos">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => brl(v)} width={80} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(value: any, name: string) => name === "MRR" ? [brl(Number(value)), name] : [value, name]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area yAxisId="left" type="monotone" dataKey="mrr" name="MRR" stroke="#10b981" fill="url(#mrrFill)" />
            <Bar yAxisId="right" dataKey="churned" name="Churn" fill="#ef4444" />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* 2. Funil de Conversão */}
      <Panel title="Funil de Conversão" subtitle="Do signup até a ativação paga">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.funnel} layout="vertical" margin={{ top: 8, right: 24, left: 32, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={140} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="value" name="Usuários" fill="#3b82f6" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* 3. Novos vs Ativos */}
      <Panel title="Novos usuários vs Ativos" subtitle="Crescimento da base nos últimos 12 meses">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="newUsers" name="Novos" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="activeUsers" name="Ativos" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      {/* 4. Distribuição por plano */}
      <Panel title="Distribuição por plano" subtitle="Mix de assinaturas ativas">
        {data.byPlan.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem dados.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Pie
                data={data.byPlan}
                dataKey="value"
                nameKey="plan"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={2}
                label={(e: any) => `${e.plan}: ${e.value}`}
              >
                {data.byPlan.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}
