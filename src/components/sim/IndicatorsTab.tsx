import { useMemo } from "react";
import { AppState } from "@/lib/finance/types";
import { buildDRE, calcIndicators, monthValues } from "@/lib/finance/calculations";
import { buildCashFlow } from "@/lib/finance/cashflow";
import { fmtBRL, fmtPct, MESES, sum } from "@/lib/finance/format";
import { 
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, 
  ResponsiveContainer, Tooltip, XAxis, YAxis 
} from "recharts";
import { HelpTip, SectionTitle } from "./primitives";

const CHART_COLORS = ["#00E5A0", "#5BA8F5", "#F5B85B", "#C77DFF", "#FF6B6B", "#7DD3FC", "#FACC15", "#F472B6", "#34D399", "#A78BFA", "#FB923C"];

export function IndicatorsTab({ state }: { state: AppState }) {
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const rb = sum(dre.receitaBruta);

  // chart data
  const monthlyChart = MESES.map((m, i) => ({
    mes: m,
    Receita: dre.receitaLiquida[i],
    Custos: dre.cpv[i] + dre.despesasOperacionais[i] + dre.custosFinanceirosTotal[i] + dre.depreciacao[i],
    Lucro: dre.lucroLiquido[i],
  }));

  const acumulado = dre.lucroLiquido.reduce<{ mes: string; valor: number }[]>((acc, v, i) => {
    const last = i === 0 ? 0 : acc[i - 1].valor;
    acc.push({ mes: MESES[i], valor: last + v });
    return acc;
  }, []);

  const costPie = Object.entries(dre.despesasPorCategoria)
    .map(([k, v]) => ({ name: k, value: sum(v) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const cvLabel = "CPV/CMV/CSP"; // Simplificado para tab dedicada
  const ll = sum(dre.lucroLiquido);
  const waterfall = [
    { name: "Receita Bruta", value: sum(dre.receitaBruta) },
    { name: "− Imp. Vendas", value: -sum(dre.impostosVendas) },
    { name: `− Custos`, value: -sum(dre.cpv) },
    { name: "− Desp. Op.", value: -sum(dre.despesasOperacionais) },
    { name: "− D&A", value: -sum(dre.depreciacao) },
    { name: "± Financ.", value: sum(dre.resultadoFinanceiro) },
    { name: "− IRPJ/CSLL", value: -sum(dre.impostos) },
    { name: "Lucro Líq.", value: ll },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Receita × Custos × Lucro (mensal)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Receita" fill="#00E5A0" />
              <Bar dataKey="Custos" fill="#FF6B6B" />
              <Bar dataKey="Lucro" fill="#5BA8F5" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Resultado acumulado (lucro líquido)">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={acumulado}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
              <Line type="monotone" dataKey="valor" stroke="#00E5A0" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Composição de custos (anual)">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={costPie} dataKey="value" nameKey="name" outerRadius={110} innerRadius={60}>
                {costPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Da receita ao lucro líquido (waterfall)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={waterfall}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
              <Bar dataKey="value">
                {waterfall.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "#00E5A0" : "#FF6B6B"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Financial Indicators */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-5 shadow-sm">
        <SectionTitle hint={{ description: "Métricas-chave que sintetizam a saúde financeira da empresa. Cada card traz a definição e a fórmula usada no cálculo." }}>
          Indicadores financeiros detalhados
        </SectionTitle>
        <div className="mt-6 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Ind label="Margem Bruta" v={fmtPct(ind.margemBruta / 100)} desc="Quanto sobra da receita após pagar o custo direto do produto/serviço." formula="Lucro Bruto ÷ Receita Líquida × 100" />
          <Ind label="Margem EBITDA" v={fmtPct(ind.margemEbitda / 100)} desc="Quanto a operação gera de caixa antes de juros, impostos e depreciação." formula="EBITDA ÷ Receita Líquida × 100" />
          <Ind label="Conversão" v={`${ind.conversaoEbitdaCaixa.toFixed(1)}%`} tone={ind.conversaoEbitdaCaixa >= 70 ? "pos" : ind.conversaoEbitdaCaixa >= 40 ? undefined : "neg"} desc="Qualidade do Caixa: mede quanto do EBITDA efetivamente vira caixa livre (FCF)." formula="FCF ÷ EBITDA × 100" />
          <Ind label="Margem Líquida" v={fmtPct(ind.margemLiquida / 100)} desc="O lucro que efetivamente sobra para os sócios, após tudo pago." formula="Lucro Líquido ÷ Receita Líquida × 100" />
          <Ind label="Margem de Contribuição" v={fmtPct(ind.margemContribuicao / 100)} desc="Quanto cada R$ vendido contribui para pagar os custos fixos." formula="(Receita − Custos Variáveis) ÷ Receita × 100" />
          <Ind label="Ponto de Equilíbrio" v={fmtBRL(ind.pontoEquilibrio)} desc="Receita mínima necessária para a empresa não ter prejuízo." formula="Custos Fixos ÷ Margem de Contribuição" />
          <Ind label="ROE" v={fmtPct(ind.roe / 100)} desc="Retorno sobre o Patrimônio Líquido." formula="Lucro Líquido ÷ Patrimônio Líquido × 100" />
          <Ind label="ROIC" v={fmtPct(ind.roic / 100)} tone={ind.roic >= ind.wacc ? "pos" : "neg"} desc="Retorno sobre o Capital Investido." formula="NOPAT ÷ Capital Investido × 100" />
          <Ind label="Liquidez Corrente" v={ind.liquidezCorrente.toFixed(2)} tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"} desc="Capacidade de pagar dívidas de curto prazo." formula="Ativo Circulante ÷ Passivo Circulante" />
          <Ind label="Endividamento Geral" v={fmtPct(ind.endividamentoGeral / 100)} desc="Percentual do ativo financiado por dívidas." formula="Passivo Total ÷ Ativo Total × 100" />
          <Ind label="Dívida Líq. / EBITDA" v={Number.isFinite(ind.dividaLiqEbitda) ? `${ind.dividaLiqEbitda.toFixed(1)}×` : "∞"} tone={ind.dividaLiqEbitda <= 3 ? "pos" : "neg"} desc="Anos de EBITDA para quitar dívida líquida." formula="(Dívida Total − Caixa) ÷ EBITDA" />
          <Ind label="Ciclo Financeiro" v={`${ind.cicloFinanceiro} d`} desc="Dias entre pagar fornecedores e receber dos clientes." formula="PMR + PME − PMP (dias)" />
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 shadow-sm">
      <h4 className="mb-4 text-sm font-semibold text-foreground/90">{title}</h4>
      {children}
    </div>
  );
}

function Ind({ label, v, desc, formula, tone }: { label: string; v: string; desc?: string; formula?: string; tone?: "pos" | "neg" | "warn" }) {
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-4 transition-all hover:bg-background/60">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
        {label} {desc && <HelpTip text={desc} formula={formula} />}
      </div>
      <div className={`mono mt-2 text-xl font-bold ${cls}`}>{v}</div>
    </div>
  );
}
