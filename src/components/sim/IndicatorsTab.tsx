import { AppState } from "@/lib/finance/types";
import { fmtBRL, fmtBRLCompact, fmtPct, MESES, sum } from "@/lib/finance/format";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HelpTip, SectionTitle, StatCard } from "./primitives";
import { TrendingUp, TrendingDown } from "lucide-react";

const CHART_COLORS = ["#00E5A0", "#5BA8F5", "#F5B85B", "#C77DFF", "#FF6B6B", "#7DD3FC", "#FACC15", "#F472B6", "#34D399", "#A78BFA", "#FB923C"];

export function IndicatorsTab({ state }: { state: AppState }) {
  const regime = state.tax.regime;
  const { dre } = buildDRE(state, regime);
  const ind = calcIndicators(state, dre);

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

  const cvLabel = state.businessType === "industria" ? "CPV" : state.businessType === "comercio" ? "CMV" : "CSP";
  const ll = sum(dre.lucroLiquido);
  const waterfall = [
    { name: "Receita Bruta", value: sum(dre.receitaBruta) },
    { name: "− Imp. Vendas", value: -sum(dre.impostosVendas) },
    { name: `− ${cvLabel}`, value: -sum(dre.cpv) },
    { name: "− Desp. Op.", value: -sum(dre.despesasOperacionais) },
    { name: "− D&A", value: -sum(dre.depreciacao) },
    { name: "± Financ.", value: sum(dre.resultadoFinanceiro) },
    { name: "− IRPJ/CSLL", value: -sum(dre.impostos) },
    { name: "Lucro Líq.", value: ll },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Ciclo Financeiro"
          value={`${ind.cicloFinanceiro} dias`}
          hint={{ description: "Dias entre pagar fornecedores e receber dos clientes. Quanto MAIOR, mais capital de giro a empresa precisa imobilizar.", formula: "PMR + PME − PMP" }}
          sub={ind.cicloFinanceiro > 60 ? "Ciclo longo — pressiona o caixa" : ind.cicloFinanceiro > 30 ? "Ciclo moderado" : "Ciclo curto — bom para o caixa"}
        />
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm ring-1 ring-primary/10">
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <span>Necessidade de Capital de Giro (NCG)</span>
            <HelpTip text="Dinheiro consumido pela operação. Reflete a defasagem entre recebimento de clientes e pagamento de fornecedores/estoque." formula="Contas a Receber + Estoques − Fornecedores" />
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
          hint={{ description: "Diferença entre o que a operação precisa (NCG) e o que a empresa tem (CGD). Positivo = precisa de empréstimo de giro; Negativo = sobra caixa.", formula: "NCG − CGD" }}
        />
        <CashConversionSmall ebitda={sum(dre.ebitda)} fcf={ind.fcf} />
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle hint={{ description: "Métricas-chave que sintetizam a saúde financeira da empresa. Cada card traz a definição e a fórmula usada no cálculo." }}>
          Indicadores financeiros
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Ind label="Margem Bruta" v={fmtPct(ind.margemBruta / 100)} desc="Quanto sobra da receita após pagar o custo direto do produto/serviço. Mede a eficiência da operação antes das despesas." formula="Lucro Bruto ÷ Receita Líquida × 100" />
          <Ind label="Margem EBITDA" v={fmtPct(ind.margemEbitda / 100)} desc="Quanto a operação gera de caixa antes de juros, impostos e depreciação. Mede a geração operacional 'pura'." formula="EBITDA ÷ Receita Líquida × 100" />
          <Ind label="Margem EBIT" v={fmtPct(ind.margemEbit / 100)} desc="Lucro operacional (após depreciação, antes de juros e impostos) sobre receita. Mede a rentabilidade da operação considerando o desgaste dos ativos." formula="EBIT ÷ Receita Líquida × 100" />
          <Ind label="Margem Líquida" v={fmtPct(ind.margemLiquida / 100)} desc="O lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos)." formula="Lucro Líquido ÷ Receita Líquida × 100" />
          <Ind label="Margem de Contribuição" v={fmtPct(ind.margemContribuicao / 100)} desc="Quanto cada R$ vendido contribui para pagar os custos fixos e gerar lucro. Quanto maior, mais resiliente é o negócio." formula="(Receita − Custos Variáveis) ÷ Receita × 100" />
          <Ind label="Ponto de Equilíbrio" v={fmtBRL(ind.pontoEquilibrio)} desc="Receita mínima necessária para a empresa não ter prejuízo (cobrir todos os custos fixos)." formula="Custos Fixos ÷ Margem de Contribuição" />
          <Ind label="ROE" v={fmtPct(ind.roe / 100)} desc="Retorno sobre o Patrimônio Líquido. Mostra quanto a empresa gera de lucro para cada R$ investido pelos sócios. Compare com a Selic." formula="Lucro Líquido ÷ Patrimônio Líquido × 100" />
          <Ind label="ROA" v={fmtPct(ind.roa / 100)} desc="Retorno sobre o Ativo Total. Mostra a eficiência da empresa em gerar lucro com todos os seus recursos (próprios + terceiros)." formula="Lucro Líquido ÷ Ativo Total × 100" />
          <Ind label="ROIC" v={fmtPct(ind.roic / 100)} tone={ind.roic >= ind.wacc ? "pos" : "neg"} desc="Retorno sobre o Capital Investido na operação. Se ROIC > WACC, a empresa CRIA valor; se ROIC < WACC, DESTRÓI valor." formula="NOPAT ÷ Capital Investido × 100  (NOPAT = EBIT × (1 − IR))" />
          <Ind label="WACC" v={fmtPct(ind.wacc / 100)} desc="Custo Médio Ponderado de Capital. É o retorno mínimo que a empresa precisa entregar para remunerar sócios e credores. Funciona como 'meta' do ROIC." formula="(E/V × Ke) + (D/V × Kd × (1 − IR))" />
          <Ind label="Liquidez Corrente" v={ind.liquidezCorrente.toFixed(2)} tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"} desc="Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. Acima de 1,0 indica folga; abaixo, aperto." formula="Ativo Circulante ÷ Passivo Circulante" />
          <Ind label="Liquidez Seca" v={ind.liquidezSeca.toFixed(2)} desc="Versão mais rigorosa da liquidez corrente: exclui estoques (que podem demorar a virar caixa). Ideal acima de 1,0." formula="(Ativo Circulante − Estoques) ÷ Passivo Circulante" />
          <Ind label="Liquidez Imediata" v={ind.liquidezImediata.toFixed(2)} desc="Capacidade de pagar dívidas de curto prazo IMEDIATAMENTE, só com dinheiro em caixa e aplicações." formula="Disponibilidades ÷ Passivo Circulante" />
          <Ind label="Endividamento Geral" v={fmtPct(ind.endividamentoGeral / 100)} desc="Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro." formula="Passivo Total ÷ Ativo Total × 100" />
          <Ind label="Cobertura de Juros" v={Number.isFinite(ind.coberturaJuros) ? `${ind.coberturaJuros.toFixed(1)}×` : "∞"} tone={ind.coberturaJuros >= 2 ? "pos" : "neg"} desc="Quantas vezes o lucro operacional cobre as despesas de juros. Abaixo de 2× é zona de risco." formula="EBIT ÷ Despesas Financeiras" />
          <Ind label="Giro do Ativo" v={`${ind.giroAtivo.toFixed(2)}×`} desc="Quantas vezes o ativo total 'gira' em vendas no ano. Mede eficiência: quanto maior, mais a empresa produz com o que tem." formula="Receita Líquida ÷ Ativo Total" />
          <Ind label="Dívida Líq. / EBITDA" v={Number.isFinite(ind.dividaLiqEbitda) ? `${ind.dividaLiqEbitda.toFixed(1)}×` : "∞"} tone={ind.dividaLiqEbitda <= 3 ? "pos" : "neg"} desc="Em quantos anos de geração de caixa (EBITDA) a empresa quitaria sua dívida líquida. Acima de 3× preocupa bancos." formula="(Dívida Total − Caixa) ÷ EBITDA" />
          <Ind label="Dívida Líq. / EBIT" v={Number.isFinite(ind.dividaLiqEbit) ? `${ind.dividaLiqEbit.toFixed(1)}×` : "∞"} tone={ind.dividaLiqEbit <= 4 ? "pos" : "neg"} desc="Quantos anos de lucro operacional (já líquido da depreciação) seriam necessários para quitar a dívida líquida. Mais conservador que Dívida/EBITDA." formula="(Dívida Total − Caixa) ÷ EBIT" />
          <Ind label="Dívida Líq. / PL" v={Number.isFinite(ind.dividaLiqPl) ? `${ind.dividaLiqPl.toFixed(2)}×` : "∞"} tone={ind.dividaLiqPl <= 1 ? "pos" : "neg"} desc="Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio." formula="(Dívida Total − Caixa) ÷ Patrimônio Líquido" />
          <Ind label="Passivos / Ativos" v={fmtPct(ind.endividamentoGeral / 100)} tone={ind.endividamentoGeral <= 60 ? "pos" : "neg"} desc="Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro." formula="Passivo Total ÷ Ativo Total × 100" />
          <Ind label="Necessidade de Capital de Giro" v={fmtBRL(ind.ncg)} tone="warn" desc="Necessidade de Capital de Giro — quanto de dinheiro a operação 'consome' permanentemente para girar (estoques + clientes − fornecedores)." formula="(Ciclo Financeiro ÷ 30) × Custos Mensais" />
          <Ind label="Payback (anos)" v={Number.isFinite(ind.payback) ? ind.payback.toFixed(1) : "—"} desc="Tempo estimado para o lucro acumulado recuperar todo o capital investido pelos sócios." formula="Patrimônio Líquido ÷ Lucro Líquido Anual" />
          <Ind label="FCF estimado" v={fmtBRL(ind.fcf)} tone={ind.fcf >= 0 ? "pos" : "neg"} desc="Free Cash Flow — geração de caixa livre após impostos e investimento em capital de giro. É o que sobra para sócios e dívida." formula="EBITDA − Impostos − Δ NCG" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receita × Custos × Lucro (mensal)">
          <ResponsiveContainer width="100%" height={280}>
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
          <ResponsiveContainer width="100%" height={280}>
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
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={costPie} dataKey="value" nameKey="name" outerRadius={100} innerRadius={50}>
                {costPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
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
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }} formatter={(v: number) => fmtBRL(v)} />
              <Bar dataKey="value">
                {waterfall.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "#00E5A0" : "#FF6B6B"} />)}
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

function Ind({ label, v, desc, formula, tone }: { label: string; v: string; desc?: string; formula?: string; tone?: "pos" | "neg" | "warn" }) {
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label} {desc && <HelpTip text={desc} formula={formula} />}
      </div>
      <div className={`mono mt-1 text-lg font-semibold ${cls}`}>{v}</div>
    </div>
  );
}

function CashConversionSmall({ ebitda, fcf }: { ebitda: number; fcf: number }) {
  const conversaoEbitda = ebitda > 0 ? (fcf / ebitda) * 100 : 0;
  const tone = conversaoEbitda >= 70 ? "pos" : conversaoEbitda >= 40 ? "default" : "neg";
  
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Conversão de Caixa</span>
        <HelpTip text="Mede quanto do EBITDA efetivamente vira caixa livre (FCF)." formula="FCF ÷ EBITDA × 100" />
      </div>
      <div className={`mono mt-2 text-2xl font-bold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-foreground"}`}>
        {conversaoEbitda.toFixed(1)}%
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        {conversaoEbitda >= 70 ? <TrendingUp className="h-3 w-3 text-pos" /> : <TrendingDown className="h-3 w-3 text-neg" />}
        EBITDA → Caixa
      </div>
    </div>
  );
}