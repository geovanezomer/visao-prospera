/**
 * DashboardTab — Visão executiva com gráficos resumidos dos principais
 * indicadores financeiros da empresa. Lê o estado real (sem simulação)
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
import { DSCR_THRESHOLDS } from "@/engines/finance/indicators";
import { fmtBRL, fmtPct, sum } from "@/engines/finance/format";
import { StatCard, HintTip } from "@/components/sim/shared/primitives";
import { buildIndicatorCalcs } from "@/engines/finance/indicatorCalc";

import { DashboardExtras, Top5Despesas } from "./DashboardExtras";
import { WaccRoicMeter } from "@/components/sim/capital/WaccRoicMeter";
import { KanitzCard } from "@/components/sim/shared/KanitzCard";
import { leverageDisplay } from "@/components/sim/shared/leverageLabel";

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
  /** Aceita `null` para exibir "N/A" quando o indicador não é aplicável (ex.: ROE com PL ≤ 0). */
  value: number | null;
  max: number;
  suffix?: string;
  good?: "high" | "low";
  hint?: { description: string; formula?: string; calc?: string };
}) {
  const isNA = value === null || !Number.isFinite(value);
  const numeric = isNA ? 0 : (value as number);
  const clamped = Math.max(0, Math.min(numeric, max));
  const ratio = max > 0 ? clamped / max : 0;
  const tone = isNA
    ? "var(--muted)"
    : good === "high"
      ? ratio > 0.66
        ? "var(--success)"
        : ratio > 0.33
          ? "#F5B85B"
          : "var(--destructive)"
      : ratio < 0.33
        ? "var(--success)"
        : ratio < 0.66
          ? "#F5B85B"
          : "var(--destructive)";
  const data = [
    { name: "v", value: clamped, fill: tone },
    { name: "r", value: Math.max(0, max - clamped), fill: "var(--muted)" },
  ];
  return (
    <div className="rounded-lg border border-border/40 bg-card p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && <HintTip hint={hint} />}
      </div>
      <div className="relative h-32">
        {/* Gauge decorativo: o valor já aparece em texto logo abaixo. */}
        <div className="h-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                rootTabIndex={-1}
                startAngle={180}
                endAngle={0}
                innerRadius="65%"
                outerRadius="95%"
                stroke="none"
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="absolute inset-0 flex items-end justify-center pb-2">
          <span className="mono text-2xl font-bold text-foreground">
            {isNA ? (
              <span title="Indicador não aplicável — verifique o denominador (ex.: PL ≤ 0).">
                N/A
              </span>
            ) : (
              <>
                {numeric.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                <span className="text-sm text-muted-foreground">{suffix}</span>
              </>
            )}
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
  const MESES = usePeriodLabels();
  const state = useFinanceState();
  const { dre, ind, cagrReceitas12m } = useFinanceModel(state);
  const c = buildIndicatorCalcs(state, dre, ind, cagrReceitas12m);
  // SSOT — mesma fórmula da aba Capital/Indicadores.
  const alav = leverageDisplay(
    "pl",
    ind.dividaLiqPl,
    ind.dividaLiquida,
    state.capital.patrimonioLiquido,
  );

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
      {/* Linha 1 — Cards numéricos resumo (com tooltips, base unificada `useFinanceModel`) */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Receita Líquida (12m)"
          value={fmtBRL(ind.receitaLiquidaAnual)}
          tone="pos"
          sub="Últimos 12 meses"
          hint={{
            description:
              "Receita bruta dos últimos 12 meses descontados impostos sobre vendas, devoluções e abatimentos.",
            formula: "Receita Bruta − Impostos sobre Vendas − Devoluções",
            calc: c.receitaLiquida12m,
          }}
        />
        <StatCard
          label="EBITDA (12m)"
          value={fmtBRL(ind.ebitdaAnual)}
          tone={ind.ebitdaAnual >= 0 ? "pos" : "neg"}
          sub={
            ind.receitaLiquidaAnual > 0
              ? fmtPct(ind.ebitdaAnual / ind.receitaLiquidaAnual) + " da receita"
              : "—"
          }
          hint={{
            description:
              "Lucro operacional antes de juros, impostos, depreciação e amortização. Mede a geração operacional de caixa.",
            formula: "Lucro Operacional + Depreciação + Amortização",
            calc: c.ebitda12m,
          }}
        />
        <StatCard
          label="Lucro Líquido (12m)"
          value={fmtBRL(ind.lucroLiquidoAnual)}
          tone={ind.lucroLiquidoAnual >= 0 ? "pos" : "neg"}
          sub={
            ind.receitaLiquidaAnual > 0
              ? fmtPct(ind.lucroLiquidoAnual / ind.receitaLiquidaAnual) + " da receita"
              : "—"
          }
          hint={{
            description: "Resultado final do exercício após todas as despesas, juros e impostos.",
            formula: "Receita Líquida − Custos − Despesas − Juros − IRPJ/CSLL",
            calc: c.lucroLiquido12m,
          }}
        />
        <StatCard
          label="Alavancagem Patrimonial"
          value={
            ind.dividaLiquida < 0
              ? "Caixa > Dívida"
              : ind.dividaLiquida > 0
                ? "Caixa < Dívida"
                : "Sem dívida líquida"
          }
          tone={ind.dividaLiquida < 0 ? "pos" : ind.dividaLiquida > 0 ? "neg" : undefined}
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
          value={ind.dscr == null ? "N/A" : ind.dscr >= 99 ? "∞" : `${ind.dscr.toFixed(2)}×`}
          tone={
            ind.dscr == null
              ? "default"
              : ind.dscr >= DSCR_THRESHOLDS.warn
                ? "pos"
                : ind.dscr >= DSCR_THRESHOLDS.danger
                  ? "default"
                  : "neg"
          }
          sub={ind.dscr == null ? "Sem dívida a servir" : "EBITDA ÷ Serviço da Dívida"}
          hint={{
            description:
              ind.dscr == null
                ? "N/A — a empresa não tem dívida onerosa (contratos + amortizações). O indicador não se aplica."
                : "Debt Service Coverage Ratio — capacidade do EBITDA cobrir o serviço da dívida (juros de contratos + amortização do principal). ≥1.25× é saudável; <1.0× sinaliza risco real de inadimplência.",
            formula: "EBITDA Anual ÷ (Juros de contratos + Amortizações Anuais)",
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
            description:
              "O lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos).",
            formula: "Lucro Líquido ÷ Receita Líquida × 100",
            calc: c.margemLiquida,
          }}
        />
        <Gauge
          label="ROE"
          value={ind.roe}
          max={30}
          hint={{
            description:
              "Retorno sobre o Patrimônio Líquido. Usa PL MÉDIO quando o PL de abertura é informado em Capital; caso contrário, usa PL fim de período.",
            formula: "Lucro Líquido ÷ PL Médio × 100",
            calc: c.roe,
          }}
        />
        <Gauge
          label="Liquidez Corrente"
          // Sem ativo nem passivo circulante (empresa sem dados), a razão não existe.
          value={
            ind.ativoCirculante <= 1 && ind.passivoCirculante <= 1 ? null : ind.liquidezCorrente
          }
          max={3}
          suffix="x"
          hint={{
            description:
              "Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. Acima de 1,0 indica folga; abaixo, aperto.",
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
            description:
              "Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro.",
            formula: "Passivo Total ÷ Ativo Total × 100",
            calc: c.endividamentoGeral,
          }}
        />
      </div>

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
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
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
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v: number, n) => (n === "Margem %" ? `${v.toFixed(1)}%` : fmtBRL(v))}
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
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
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
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--muted-foreground)"
              fontSize={10}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
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

      {/* Termômetro de Valor — WACC × ROIC */}
      <WaccRoicMeter wacc={ind.wacc} roic={ind.roic} />

      {/* Termômetro de Insolvência (Kanitz) — alerta precoce de descontinuidade */}
      <KanitzCard />
    </div>
  );
}
