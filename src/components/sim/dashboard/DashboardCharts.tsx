/**
 * Gráficos do Dashboard (carregados sob demanda pelo DashboardTab) — visão
 * executiva dos principais indicadores. Lê o estado real (sem simulação)
 * e deriva tudo do `useFinanceModel` (SSOT da engine).
 */
import { useMemo } from "react";
import { usePeriodLabels } from "@/components/odoo/usePeriodLabels";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, sum, fmtNum } from "@/engines/finance/format";

import { DashboardExtras, Top5Despesas } from "./DashboardExtras";

const COLORS = [
  "var(--success)",
  "var(--primary)",
  "#F5B85B",
  "#C77DFF",
  "var(--destructive)",
  "#7DD3FC",
  "#FACC15",
];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;
// Recharts aplica cor inline preta nos labels/itens do tooltip; sobrescrevemos para seguir o tema.
const TOOLTIP_LABEL_STYLE = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_ITEM_STYLE = { color: "var(--popover-foreground)" } as const;

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

export function DashboardCharts() {
  const MESES = usePeriodLabels();
  const state = useFinanceState();
  const { dre } = useFinanceModel(state);
  // SSOT — mesma fórmula da aba Capital/Indicadores.

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
    [dre, MESES],
  );

  // Lucro acumulado (área)
  const acumulado = useMemo(() => {
    let acc = 0;
    return MESES.map((m, i) => {
      acc += dre.lucroLiquido[i] ?? 0;
      return { mes: m, Acumulado: acc };
    });
  }, [dre, MESES]);

  // Receitas vs Despesas (12m) — linhas verde/vermelha
  const receitasDespesas = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        Receitas: dre.receitaLiquida[i] ?? 0,
        // Inclui custos financeiros — sem eles, empresa alavancada com prejuízo
        // aparecia com receita > despesa (falso positivo de saúde financeira).
        Despesas:
          (dre.cpv[i] ?? 0) +
          (dre.despesasOperacionais[i] ?? 0) +
          (dre.custosFinanceirosTotal?.[i] ?? 0),
      })),
    [dre, MESES],
  );

  // Composição mensal de custos/despesas por função (stacked) + EBIT (linha)
  const dreMensalFuncao = useMemo(() => {
    const bucket = {
      cpv: new Array(12).fill(0) as number[],
      comerciais: new Array(12).fill(0) as number[],
      administrativas: new Array(12).fill(0) as number[],
      financeiras: new Array(12).fill(0) as number[],
    };
    for (const c of state.costs) {
      const cat = c.category;
      const target =
        cat === "custo_vendas" || cat === "direto_venda"
          ? bucket.cpv
          : cat === "despesa_comercial" || cat === "variavel"
            ? bucket.comerciais
            : cat === "financeiro"
              ? bucket.financeiras
              : bucket.administrativas;
      for (let i = 0; i < 12; i++) target[i] += c.values[i] ?? 0;
    }
    return MESES.map((m, i) => ({
      mes: m,
      "CPV/CMV/CSP": bucket.cpv[i],
      Comerciais: bucket.comerciais[i],
      Administrativas: bucket.administrativas[i],
      Financeiras: bucket.financeiras[i],
      EBIT: dre.ebit[i] ?? 0,
    }));
  }, [state.costs, dre.ebit, MESES]);

  return (
    <div className="space-y-6">
      {/* Elementos visuais para o empresário: runway, semáforos, score e top despesas */}
      <DashboardExtras state={state} />

      {/* Linha 4 — Receitas vs Despesas | Top 5 Despesas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receitas vs Despesas (12m)">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={receitasDespesas}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickFormatter={(v) => `R$${fmtNum(v / 1000, 0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="Receitas"
                stroke="var(--success)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Despesas"
                stroke="var(--destructive)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <Top5Despesas state={state} />
      </div>

      {/* Linha 4b — Receita × Margem | Lucro Acumulado */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receita Mensal × Margem Líquida (%)">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={receitaMargem}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis
                yAxisId="left"
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickFormatter={(v) => `R$${fmtNum(v / 1000, 0)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickFormatter={(v) => `${fmtNum(v, 0)}%`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v: number, n) => (n === "Margem %" ? `${fmtNum(v, 1)}%` : fmtBRL(v))}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="Receita" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Margem %"
                stroke="var(--success)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lucro Líquido Acumulado (12m)">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={acumulado}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--success)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickFormatter={(v) => `R$${fmtNum(v / 1000, 0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Area
                type="monotone"
                dataKey="Acumulado"
                stroke="var(--success)"
                fill="url(#grad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Composição mensal de custos × EBIT (stacked + line) */}
      <ChartCard title="Composição Mensal de Custos × EBIT (12m)">
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={dreMensalFuncao}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis
              yAxisId="left"
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickFormatter={(v) => `R$${fmtNum(v / 1000, 0)}k`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickFormatter={(v) => `R$${fmtNum(v / 1000, 0)}k`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(v: number) => fmtBRL(v)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              yAxisId="left"
              dataKey="CPV/CMV/CSP"
              stackId="custos"
              fill="#1E5BB8"
              radius={[0, 0, 0, 0]}
            />
            <Bar yAxisId="left" dataKey="Administrativas" stackId="custos" fill="#F59E0B" />
            <Bar yAxisId="left" dataKey="Comerciais" stackId="custos" fill="#A855F7" />
            <Bar
              yAxisId="left"
              dataKey="Financeiras"
              stackId="custos"
              fill="#EF4444"
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="EBIT"
              stroke="var(--success)"
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
