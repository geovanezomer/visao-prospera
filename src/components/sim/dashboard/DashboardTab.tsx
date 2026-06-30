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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, fmtPct, MESES, sum } from "@/engines/finance/format";
import { StatCard, renderHint } from "@/components/sim/shared/primitives";
import { buildIndicatorCalcs } from "@/engines/finance/indicatorCalc";


import { DashboardExtras } from "./DashboardExtras";
import { WaccRoicMeter } from "@/components/sim/capital/WaccRoicMeter";
import { KanitzCard } from "@/components/sim/shared/KanitzCard";
import { leverageDisplay } from "@/components/sim/shared/leverageLabel";

const COLORS = ["var(--success)", "var(--primary)", "#F5B85B", "#C77DFF", "var(--destructive)", "#7DD3FC", "#FACC15"];

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

// Gauge semi-circular simples baseado em PieChart (sem libs extras).
function Gauge({
  label,
  value,
  max,
  suffix = "%",
  good = "high",
  hint,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  good?: "high" | "low";
  hint?: { description: string; formula?: string; calc?: string };
}) {
  const clamped = Math.max(0, Math.min(value, max));
  const ratio = max > 0 ? clamped / max : 0;
  const tone = good === "high" ? (ratio > 0.66 ? "var(--success)" : ratio > 0.33 ? "#F5B85B" : "var(--destructive)")
                                : (ratio < 0.33 ? "var(--success)" : ratio < 0.66 ? "#F5B85B" : "var(--destructive)");
  const data = [
    { name: "v", value: clamped, fill: tone },
    { name: "r", value: Math.max(0, max - clamped), fill: "var(--muted)" },
  ];
  return (
    <div className="rounded-lg border border-border/40 bg-card p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && renderHint(hint)}
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
  const { dre, ind, cagrReceitas12m } = useFinanceModel(state);
  const c = buildIndicatorCalcs(state, dre, ind, cagrReceitas12m);
  // SSOT — mesma fórmula da aba Capital/Indicadores.
  const alav = leverageDisplay("pl", ind.dividaLiqPl, ind.dividaLiquida, state.capital.patrimonioLiquido);

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

  // Receitas vs Despesas (12m) — linhas verde/vermelha
  const receitasDespesas = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        Receitas: dre.receitaLiquida[i] ?? 0,
        Despesas: (dre.cpv[i] ?? 0) + (dre.despesasOperacionais[i] ?? 0),
      })),
    [dre],
  );


  return (
    <div className="space-y-6">




      {/* Linha 1 — Cards numéricos resumo (com tooltips, base unificada `useFinanceModel`) */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Receita Líquida (12m)"
          value={fmtBRL(ind.receitaLiquidaAnual)}
          tone="pos"
          sub="Últimos 12 meses"
          hint={{
            description: "Receita bruta dos últimos 12 meses descontados impostos sobre vendas, devoluções e abatimentos.",
            formula: "Receita Bruta − Impostos sobre Vendas − Devoluções",
            calc: c.receitaLiquida12m,
          }}
        />
        <StatCard
          label="EBITDA (12m)"
          value={fmtBRL(ind.ebitdaAnual)}
          tone={ind.ebitdaAnual >= 0 ? "pos" : "neg"}
          sub={ind.receitaLiquidaAnual > 0 ? fmtPct((ind.ebitdaAnual / ind.receitaLiquidaAnual) * 100) + " da receita" : "—"}
          hint={{
            description: "Lucro operacional antes de juros, impostos, depreciação e amortização. Mede a geração operacional de caixa.",
            formula: "Lucro Operacional + Depreciação + Amortização",
            calc: c.ebitda12m,
          }}
        />
        <StatCard
          label="Lucro Líquido (12m)"
          value={fmtBRL(ind.lucroLiquidoAnual)}
          tone={ind.lucroLiquidoAnual >= 0 ? "pos" : "neg"}
          sub={ind.receitaLiquidaAnual > 0 ? fmtPct((ind.lucroLiquidoAnual / ind.receitaLiquidaAnual) * 100) + " da receita" : "—"}
          hint={{
            description: "Resultado final do exercício após todas as despesas, juros e impostos.",
            formula: "Receita Líquida − Custos − Despesas − Juros − IRPJ/CSLL",
            calc: c.lucroLiquido12m,
          }}
        />
        <StatCard
          label="Alavancagem Patrimonial"
          value={ind.dividaLiquida < 0 ? "Caixa > Dívida" : "Caixa < Dívida"}
          tone={ind.dividaLiquida < 0 ? "pos" : "neg"}
          sub={alav.value}
          hint={{
            description:
              "Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio. Quando o caixa supera a dívida onerosa, a Dívida Líquida é negativa (posição cash-rich).",
            formula: "(Dívida Total − Caixa) ÷ Patrimônio Líquido",
            calc: c.dividaLiqPl,
          }}
        />
        <StatCard
          label="DSCR"
          value={ind.dscr >= 99 ? "∞" : `${ind.dscr.toFixed(2)}×`}
          tone={ind.dscr >= 1.25 ? "pos" : ind.dscr >= 1.0 ? "default" : "neg"}
          sub="EBITDA ÷ Serviço da Dívida"
          hint={{
            description:
              "Debt Service Coverage Ratio — capacidade do EBITDA cobrir o serviço da dívida (juros + amortização do principal). ≥1.25× é saudável; <1.0× sinaliza risco real de inadimplência.",
            formula: "EBITDA Anual ÷ (Juros + Amortizações Anuais)",
            calc: c.dscr,
          }}
        />
      </div>



      {/* Linha 2 — KPIs em gauges (logo após os cards principais) */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Gauge
          label="Margem Líquida"
          value={ind.margemLiquida}
          max={30}
          hint={{
            description: "O lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos).",
            formula: "Lucro Líquido ÷ Receita Líquida × 100",
            calc: c.margemLiquida,
          }}
        />
        <Gauge
          label="ROE"
          value={ind.roe}
          max={30}
          hint={{
            description: "Retorno sobre o Patrimônio Líquido. Usa PL MÉDIO quando o PL de abertura é informado em Capital; caso contrário, usa PL fim de período.",
            formula: "Lucro Líquido ÷ PL Médio × 100",
            calc: c.roe,
          }}
        />
        <Gauge
          label="Liquidez Corrente"
          value={ind.liquidezCorrente}
          max={3}
          suffix="x"
          hint={{
            description: "Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. Acima de 1,0 indica folga; abaixo, aperto.",
            formula: "Ativo Circulante ÷ Passivo Circulante",
            calc: c.liquidezCorrente,
          }}
        />
        <Gauge
          label="Endividamento Geral"
          value={ind.endividamentoGeral}
          max={100}
          good="low"
          hint={{
            description: "Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro.",
            formula: "Passivo Total ÷ Ativo Total × 100",
            calc: c.endividamentoGeral,
          }}
        />
      </div>






      {/* Elementos visuais para o empresário: runway, semáforos, score e top despesas */}
      <DashboardExtras state={state} />


      {/* Linha 3 — Combo Receita + Margem (largura total) */}
      <ChartCard title="Receita Mensal × Margem Líquida (%)">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={receitaMargem}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis
              yAxisId="left"
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v: number, n) => n === "Margem %" ? `${v.toFixed(1)}%` : fmtBRL(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="Receita" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="Margem %" stroke="var(--success)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>


      {/* Linha 4 — Receitas vs Despesas | Lucro Acumulado (12m) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receitas vs Despesas (12m)">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={receitasDespesas}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Receitas" stroke="var(--success)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Despesas" stroke="var(--destructive)" strokeWidth={2} dot={false} />
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
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Area type="monotone" dataKey="Acumulado" stroke="var(--success)" fill="url(#grad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>


      {/* Linha 5 — Despesas | Estrutura de Capital */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Composição de Despesas">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={despesasPie} dataKey="value" nameKey="name" cx="35%" outerRadius="85%">
                {despesasPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                iconType="circle"
                wrapperStyle={{ fontSize: 11, lineHeight: "18px", paddingLeft: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Estrutura de Capital">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={capitalPie} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                {capitalPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} formatter={(v: number) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>


      {/* Termômetro de Valor — WACC × ROIC */}
      <WaccRoicMeter wacc={ind.wacc} roic={ind.roic} />

      {/* Termômetro de Insolvência (Kanitz) — alerta precoce de descontinuidade */}
      <KanitzCard />

    </div>
  );
}


