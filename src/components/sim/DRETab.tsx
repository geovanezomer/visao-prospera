import { useState } from "react";
import { AppState, TaxRegime } from "@/lib/finance/types";
type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;
import { fmtBRL, fmtBRLCompact, fmtPct, MESES, sum } from "@/lib/finance/format";
import { buildDRE, calcIndicators, diagnose } from "@/lib/finance/calculations";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HelpTip, SectionTitle, StatCard } from "./primitives";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, TriangleAlert } from "lucide-react";

const CHART_COLORS = ["#00E5A0", "#5BA8F5", "#F5B85B", "#C77DFF", "#FF6B6B", "#7DD3FC", "#FACC15", "#F472B6", "#34D399", "#A78BFA", "#FB923C"];

export function DRETab({ state, update }: { state: AppState; update: Updater }) {
  const [view, setView] = useState<"mensal" | "anual">("anual");
  const regime = state.tax.regime;
  const { dre, tax } = buildDRE(state, regime);
  const ind = calcIndicators(state, dre);
  const diagnostics = diagnose(state, dre, ind);

  const rb = sum(dre.receitaBruta);
  const ll = sum(dre.lucroLiquido);

  const rows = [
    { k: "(+) Receita Operacional Bruta", v: dre.receitaBruta, strong: true, tone: "pos" as const },
    { k: "(−) Inadimplência / Deduções", v: dre.deducoesInadimplencia.map((x) => -x), tone: "neg" as const },
    { k: "(=) Receita Operacional Líquida", v: dre.receitaLiquida, strong: true },
    { k: "(−) CPV / CSV", v: dre.cpv.map((x) => -x), tone: "neg" as const },
    { k: "(=) Lucro Bruto", v: dre.lucroBruto, strong: true, tone: "pos" as const, margin: ind.margemBruta },
    { k: "(−) Despesas Operacionais", v: dre.despesasOperacionais.map((x) => -x), tone: "neg" as const },
    { k: "(=) EBITDA", v: dre.ebitda, strong: true, margin: ind.margemEbitda },
    { k: "(−) Depreciação & Amortização", v: dre.depreciacao.map((x) => -x), tone: "neg" as const },
    { k: "(=) EBIT — Lucro Operacional", v: dre.ebit, strong: true, margin: ind.margemEbit },
    { k: "(+/−) Resultado Financeiro", v: dre.resultadoFinanceiro },
    { k: "(=) LAIR — Lucro Antes do IR", v: dre.lair, strong: true },
    { k: "(−) Impostos s/ Lucro", v: dre.impostos.map((x) => -x), tone: "neg" as const },
    { k: "(=) LUCRO LÍQUIDO", v: dre.lucroLiquido, strong: true, tone: ll >= 0 ? ("pos" as const) : ("neg" as const), margin: ind.margemLiquida, highlight: true },
  ];

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

  const waterfall = [
    { name: "Receita Líq.", value: sum(dre.receitaLiquida) },
    { name: "− CPV", value: -sum(dre.cpv) },
    { name: "− Desp. Op.", value: -sum(dre.despesasOperacionais) },
    { name: "− D&A", value: -sum(dre.depreciacao) },
    { name: "± Financ.", value: sum(dre.resultadoFinanceiro) },
    { name: "− Impostos", value: -sum(dre.impostos) },
    { name: "Lucro Líq.", value: ll },
  ];

  const diagIcon = (l: string) =>
    l === "ok" ? <CheckCircle2 className="h-4 w-4 text-pos" /> :
    l === "warn" ? <TriangleAlert className="h-4 w-4 text-[var(--warning)]" /> :
    <AlertTriangle className="h-4 w-4 text-neg" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-border/60 bg-card/40 p-1">
            {(["anual", "mensal"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded px-3 py-1 text-xs ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {v === "anual" ? "Visão Anual" : "Visão Mensal"}
              </button>
            ))}
          </div>
          <Select value={regime} onValueChange={(r) => (window.dispatchEvent(new CustomEvent("set-regime", { detail: r })))}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="simples">Simples Nacional</SelectItem>
              <SelectItem value="presumido">Lucro Presumido</SelectItem>
              <SelectItem value="real">Lucro Real</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-muted-foreground">
          Período: <span className="num">Jan</span> a <span className="num">Dez</span> · Regime ativo:{" "}
          <Badge variant="outline" className="ml-1">{regime === "simples" ? "Simples" : regime === "presumido" ? "Presumido" : "Real"}</Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard label="Receita Bruta" value={fmtBRL(rb)} tone="pos" />
        <StatCard label="EBITDA" value={fmtBRL(sum(dre.ebitda))} sub={`Margem ${ind.margemEbitda.toFixed(1)}%`} tone={sum(dre.ebitda) >= 0 ? "pos" : "neg"} />
        <StatCard label="Lucro Líquido" value={fmtBRL(ll)} sub={`Margem ${ind.margemLiquida.toFixed(1)}%`} tone={ll >= 0 ? "pos" : "neg"} />
        <StatCard label="Tributos / Receita" value={fmtPct(tax.effective / 100)} tone="warn" sub={`${fmtBRL(tax.annual)} no ano`} />
      </div>

      {/* Diagnostics */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle hint="Diagnóstico automático baseado nos indicadores do plano atual.">Diagnóstico CFO</SectionTitle>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {diagnostics.map((d, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-md border p-3 text-xs leading-relaxed ${
              d.level === "ok" ? "border-[var(--success)]/40 bg-[var(--success)]/5" :
              d.level === "warn" ? "border-[var(--warning)]/40 bg-[var(--warning)]/5" :
              "border-[var(--destructive)]/40 bg-[var(--destructive)]/5"
            }`}>
              <div className="mt-0.5">{diagIcon(d.level)}</div>
              <div>
                <div className="font-semibold text-foreground">{d.title}</div>
                <div className="text-muted-foreground">{d.message}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DRE Table */}
      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <h3 className="text-base font-semibold">D.R.E. — Demonstração do Resultado do Exercício</h3>
          <p className="text-xs text-muted-foreground">Visão gerencial conforme IFRS 18 / CPC 51 — regime de competência.</p>
        </div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left">Descrição</th>
                {view === "mensal" && MESES.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
                <th className="px-4 py-2 text-right">Anual</th>
                <th className="px-3 py-2 text-right">% Rec</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const total = sum(row.v);
                const pct = rb > 0 ? total / rb : 0;
                const toneCls = row.tone === "pos" ? "text-pos" : row.tone === "neg" ? "text-neg" : "";
                return (
                  <tr key={idx} className={`border-t border-border/30 ${row.highlight ? "bg-primary/10" : row.strong ? "bg-accent/20" : ""}`}>
                    <td className={`px-4 py-2 ${row.strong ? "font-semibold" : "text-muted-foreground"} text-xs`}>{row.k}</td>
                    {view === "mensal" && row.v.map((v, i) => (
                      <td key={i} className={`num px-2 py-2 text-right text-xs ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-pos" : "text-muted-foreground"}`}>
                        {v === 0 ? "—" : fmtBRLCompact(v)}
                      </td>
                    ))}
                    <td className={`num px-4 py-2 text-right ${row.strong ? "font-semibold" : ""} ${total < 0 ? "text-neg" : total > 0 ? toneCls || "text-foreground" : ""}`}>
                      {fmtBRL(total)}
                      {row.margin !== undefined && <div className="text-[10px] font-normal text-muted-foreground">Margem {row.margin.toFixed(1)}%</div>}
                    </td>
                    <td className="num px-3 py-2 text-right text-xs text-muted-foreground">{fmtPct(pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receita × Custos × Lucro (mensal)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #ffffff20", fontSize: 12 }} formatter={(v: number) => fmtBRL(v)} />
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
              <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #ffffff20", fontSize: 12 }} formatter={(v: number) => fmtBRL(v)} />
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
              <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #ffffff20", fontSize: 12 }} formatter={(v: number) => fmtBRL(v)} />
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
              <Tooltip contentStyle={{ background: "#161B22", border: "1px solid #ffffff20", fontSize: 12 }} formatter={(v: number) => fmtBRL(v)} />
              <Bar dataKey="value">
                {waterfall.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "#00E5A0" : "#FF6B6B"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Financial Indicators */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle>Indicadores financeiros</SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Ind label="Margem Bruta" v={fmtPct(ind.margemBruta / 100)} hint="Lucro Bruto / Receita Líquida" />
          <Ind label="Margem EBITDA" v={fmtPct(ind.margemEbitda / 100)} hint="EBITDA / Receita Líquida" />
          <Ind label="Margem Líquida" v={fmtPct(ind.margemLiquida / 100)} hint="Lucro Líquido / Receita Líquida" />
          <Ind label="Margem de Contribuição" v={fmtPct(ind.margemContribuicao / 100)} hint="(Receita − Custos Variáveis) / Receita" />
          <Ind label="Ponto de Equilíbrio" v={fmtBRL(ind.pontoEquilibrio)} hint="Receita necessária para cobrir custos fixos." />
          <Ind label="Ponto de Eq. Financeiro" v={fmtBRL(ind.pontoEquilibrioFinanceiro)} hint="Desconsidera depreciação." />
          <Ind label="ROE" v={fmtPct(ind.roe / 100)} hint="Lucro Líq. / Patrimônio Líq." />
          <Ind label="ROA" v={fmtPct(ind.roa / 100)} hint="Lucro Líq. / Ativo Total" />
          <Ind label="ROIC" v={fmtPct(ind.roic / 100)} tone={ind.roic >= ind.wacc ? "pos" : "neg"} hint="NOPAT / Capital Investido. Comparar com WACC." />
          <Ind label="WACC" v={fmtPct(ind.wacc / 100)} />
          <Ind label="Liquidez Corrente" v={ind.liquidezCorrente.toFixed(2)} tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"} hint="Ativo Circulante / Passivo Circulante" />
          <Ind label="Liquidez Seca" v={ind.liquidezSeca.toFixed(2)} hint="(AC − Estoques) / PC" />
          <Ind label="Liquidez Imediata" v={ind.liquidezImediata.toFixed(2)} hint="Disponibilidades / PC" />
          <Ind label="Endividamento Geral" v={fmtPct(ind.endividamentoGeral / 100)} hint="Passivo Total / Ativo Total" />
          <Ind label="Cobertura de Juros" v={Number.isFinite(ind.coberturaJuros) ? `${ind.coberturaJuros.toFixed(1)}×` : "∞"} tone={ind.coberturaJuros >= 2 ? "pos" : "neg"} hint="EBIT / Despesas Financeiras" />
          <Ind label="Giro do Ativo" v={`${ind.giroAtivo.toFixed(2)}×`} hint="Receita Líq. / Ativo Total" />
          <Ind label="Dívida Líq. / EBITDA" v={Number.isFinite(ind.dividaLiqEbitda) ? `${ind.dividaLiqEbitda.toFixed(1)}×` : "∞"} tone={ind.dividaLiqEbitda <= 3 ? "pos" : "neg"} />
          <Ind label="Ciclo Financeiro" v={`${ind.cicloFinanceiro} d`} />
          <Ind label="NCG" v={fmtBRL(ind.ncg)} tone="warn" hint="Necessidade de Capital de Giro" />
          <Ind label="Payback (anos)" v={Number.isFinite(ind.payback) ? ind.payback.toFixed(1) : "—"} hint="Patrimônio / Lucro Líquido anual" />
          <Ind label="FCF estimado" v={fmtBRL(ind.fcf)} tone={ind.fcf >= 0 ? "pos" : "neg"} hint="EBITDA − Impostos − ΔNCG" />
        </div>
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

function Ind({ label, v, hint, tone }: { label: string; v: string; hint?: string; tone?: "pos" | "neg" | "warn" }) {
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label} {hint && <HelpTip text={hint} />}
      </div>
      <div className={`mono mt-1 text-lg font-semibold ${cls}`}>{v}</div>
    </div>
  );
}
