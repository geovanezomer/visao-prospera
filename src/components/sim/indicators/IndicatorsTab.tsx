import { useMemo } from "react";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { fmtBRL, fmtPct, MESES, sum } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
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
import { HelpTip, StatCard } from "@/components/sim/shared/primitives";
import { TrendingUp, TrendingDown } from "lucide-react";
import { HistoricalYearPills } from "@/components/sim/shared/HistoricalYearPills";
import { IndicatorsGrid } from "./IndicatorsGrid";

const CHART_COLORS = [
  "#00E5A0",
  "#5BA8F5",
  "#F5B85B",
  "#C77DFF",
  "#FF6B6B",
  "#7DD3FC",
  "#FACC15",
  "#F472B6",
  "#34D399",
  "#A78BFA",
  "#FB923C",
];

// Estilo padrão de tooltip dos charts (DRY — antes repetido 4×)
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;
const TOOLTIP_ITEM = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--popover-foreground)", fontWeight: 600 } as const;



export function IndicatorsTab() {
  const state = useFinanceState();
  // (I1+I9) Modelo central: regime efetivo + DRE + indicadores + CAGR memoizados.
  const { dre, ind } = useFinanceModel(state);

  // (I7) D&A é linha própria nos dois charts — padroniza classificação com o waterfall.
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

  // B10: memoizar acumulado
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

  // EBIT/EBITDA anuais e demais indicadores agora ficam encapsulados em
  // <IndicatorsGrid /> (SSOT visual). Aqui só sobra o que é usado nos charts.

  return (
    <div className="space-y-6">
      <HistoricalYearPills />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Ciclo Financeiro"
          value={`${(ind.cicloFinanceiro ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`}
          hint={{
            description:
              "Dias entre pagar fornecedores e receber dos clientes. Quanto MAIOR, mais capital de giro a empresa precisa imobilizar.",
            formula: "PMR + PME − PMP",
          }}
          sub={
            ind.cicloFinanceiro > 60
              ? "Ciclo longo — pressiona o caixa"
              : ind.cicloFinanceiro > 30
                ? "Ciclo moderado"
                : "Ciclo curto — bom para o caixa"
          }
        />
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm ring-1 ring-primary/10">
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <span>Necessidade de Capital de Giro (NCG)</span>
            <HelpTip
              text="Dinheiro consumido pela operação. Reflete a defasagem entre recebimento de clientes e pagamento de fornecedores/estoque."
              formula="Contas a Receber + Estoques − Fornecedores"
            />
          </div>
          <div className="mono mt-2 text-2xl font-bold text-foreground">{fmtBRL(ind.ncg)}</div>
        </div>
        <StatCard
          label="Gap de Capital de Giro"
          value={fmtBRL(ind.gapCapitalGiro)}
          tone={ind.gapCapitalGiro > 0 ? "neg" : "pos"}
          sub={
            ind.gapCapitalGiro > 0
              ? "Falta caixa: negocie prazos, antecipe recebíveis ou capte giro"
              : "Folga: sobra para investir ou amortizar dívidas"
          }
          hint={{
            description:
              "Diferença entre o que a operação precisa (NCG) e o que a empresa tem (CGD). Positivo = precisa de empréstimo de giro; Negativo = sobra caixa.",
            formula: "NCG − CGD",
          }}
        />
        <CashConversionSmall conversao={ind.conversaoEbitdaCaixa} />
      </div>

      <IndicatorsGrid state={state} />


      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receita × Custos × Lucro (mensal)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Receita" fill="#00E5A0" />
              <Bar dataKey="Operacionais" fill="#FF6B6B" />
              <Bar dataKey="D&A" fill="#C77DFF" />
              <Bar dataKey="Financeiros" fill="#F5B85B" />
              <Bar dataKey="Lucro" fill="#5BA8F5" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Resultado acumulado (lucro líquido)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={acumulado}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Line
                type="monotone"
                dataKey="valor"
                stroke="#00E5A0"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Composição de despesas operacionais (anual)">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={costPie} dataKey="value" nameKey="name" outerRadius="80%" innerRadius="45%">
                {costPie.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Da receita ao lucro líquido (waterfall)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={waterfall}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Bar dataKey="value">
                {waterfall.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0 ? "#00E5A0" : "#FF6B6B"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

// `Ind` foi extraído para IndicatorsGrid.tsx (SSOT visual dos indicadores).


// (I2) Consome ind.conversaoEbitdaCaixa — não recalcula localmente.
function CashConversionSmall({ conversao }: { conversao: number }) {
  const conversaoEbitda = conversao;
  const tone = conversaoEbitda >= 70 ? "pos" : conversaoEbitda >= 40 ? "default" : "neg";

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Conversão de Caixa</span>
        <HelpTip
          text="Mede quanto do EBITDA efetivamente vira caixa livre (FCF)."
          formula="FCF ÷ EBITDA × 100"
        />
      </div>
      <div
        className={`mono mt-2 text-2xl font-bold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-foreground"}`}
      >
        {fmtPct(conversaoEbitda / 100)}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        {conversaoEbitda >= 70 ? (
          <TrendingUp className="h-3 w-3 text-pos" />
        ) : (
          <TrendingDown className="h-3 w-3 text-neg" />
        )}
        EBITDA → Caixa
      </div>
    </div>
  );
}
