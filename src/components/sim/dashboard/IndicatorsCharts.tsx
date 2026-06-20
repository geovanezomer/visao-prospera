/**
 * IndicatorsCharts — 4 gráficos antes localizados na aba Indicadores
 * (Receita×Custos×Lucro mensal, Lucro acumulado, Composição de despesas,
 * Waterfall até o lucro líquido). Movidos para a Dashboard.
 */
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, MESES, sum } from "@/engines/finance/format";

const CHART_COLORS = [
  "#00E5A0", "#5BA8F5", "#F5B85B", "#C77DFF", "#FF6B6B",
  "#7DD3FC", "#FACC15", "#F472B6", "#34D399", "#A78BFA", "#FB923C",
];

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;
const TOOLTIP_ITEM = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--popover-foreground)", fontWeight: 600 } as const;

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

export function IndicatorsCharts({ state }: { state: AppState }) {
  const { dre } = useFinanceModel(state);

  const monthlyChart = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        Receita: dre.receitaLiquida[i],
        Operacionais: dre.cpv[i] + dre.despesasOperacionais[i],
        "D&A": dre.depreciacao[i],
        Financeiros: dre.custosFinanceirosTotal[i],
        Lucro: dre.lucroLiquido[i],
      })),
    [dre],
  );

  const acumulado = useMemo(
    () =>
      dre.lucroLiquido.reduce<{ mes: string; valor: number }[]>((acc, v, i) => {
        const last = i === 0 ? 0 : acc[i - 1].valor;
        acc.push({ mes: MESES[i], valor: last + v });
        return acc;
      }, []),
    [dre.lucroLiquido],
  );

  const costPie = useMemo(
    () =>
      Object.entries(dre.despesasPorCategoria)
        .map(([k, v]) => ({ name: k, value: sum(v) }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value),
    [dre.despesasPorCategoria],
  );

  const cvLabel =
    state.businessType === "industria" ? "CPV" : state.businessType === "comercio" ? "CMV" : "CSP";
  const ll = sum(dre.lucroLiquido);

  const waterfall = useMemo(
    () => [
      { name: "Receita Bruta", value: sum(dre.receitaBruta) },
      { name: "− Imp. Vendas", value: -sum(dre.impostosVendas) },
      { name: `− ${cvLabel}`, value: -sum(dre.cpv) },
      { name: "− Desp. Op.", value: -sum(dre.despesasOperacionais) },
      { name: "− D&A", value: -sum(dre.depreciacao) },
      { name: "± Financ.", value: sum(dre.resultadoFinanceiro) },
      { name: "− IRPJ/CSLL", value: -sum(dre.impostos) },
      { name: "Lucro Líq.", value: ll },
    ],
    [dre, cvLabel, ll],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">

      <ChartCard title="Resultado acumulado (lucro líquido)">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={acumulado}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} labelStyle={TOOLTIP_LABEL} formatter={(v: number) => fmtBRL(v)} />
            <Line type="monotone" dataKey="valor" stroke="#00E5A0" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Composição de despesas operacionais (anual)">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={costPie} dataKey="value" nameKey="name" outerRadius="80%" innerRadius="45%">
              {costPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} labelStyle={TOOLTIP_LABEL} formatter={(v: number) => fmtBRL(v)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Da receita ao lucro líquido (waterfall)">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={waterfall}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
            <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} labelStyle={TOOLTIP_LABEL} formatter={(v: number) => fmtBRL(v)} />
            <Bar dataKey="value">
              {waterfall.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "#00E5A0" : "#FF6B6B"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
