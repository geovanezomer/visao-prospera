import { useState, Fragment, useEffect } from "react";
import { AppState, TaxRegime, COST_VENDAS_LABEL, TAX_ERA_SHORT, CostCategory } from "@/lib/finance/types";
type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

import { fmtBRL, fmtBRLCompact, fmtPct, MESES, sum } from "@/lib/finance/format";
import { buildDRE, calcIndicators, monthValues } from "@/lib/finance/calculations";
import { buildCashFlow } from "@/lib/finance/cashflow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { SectionTitle } from "./primitives";

export function DRETab({ state, update }: { state: AppState; update: Updater }) {
  const [view, setView] = useState<"mensal" | "anual">("anual");

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) setView("anual");
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const regime = state.tax.regime;
  const { dre, tax } = buildDRE(state, regime);
  const ind = calcIndicators(state, dre);
  const cf = buildCashFlow(state, regime);
  const limiar = state.cashflow.limiarAlerta ?? -10000;
  const mesesCriticosIdx = new Set(
    cf.saldoFinal.map((s, i) => (s <= limiar ? i : -1)).filter((i) => i >= 0)
  );

  const cvLabel = COST_VENDAS_LABEL[state.businessType];

  const rb = sum(dre.receitaBruta);
  const ll = sum(dre.lucroLiquido);

  const dedById = (id: string) => state.revenue.deducoes?.find((d) => d.id === id);
  const descIncond = dedById("desc_incond")?.valores ?? Array(12).fill(0);
  const abatimentos = dedById("abatimentos")?.valores ?? Array(12).fill(0);

  const totalCustos = dre.cpv.map((c, i) => c + dre.despesasOperacionais[i] + dre.custosFinanceirosTotal[i]);

  const linhasPreenchidas = state.costs
    .map((c) => ({ label: c.label, category: c.category, values: monthValues(c, state.tax.regime) }))
    .filter((x) => sum(x.values) > 0);
  const grupos: { id: CostCategory; titulo: string }[] = [
    { id: "fixo", titulo: "Custos e Despesas Fixas" },
    { id: "variavel", titulo: "Custos e Despesas Variáveis" },
    { id: "financeiro", titulo: "Custos Financeiros" },
  ];

  const [openCustos, setOpenCustos] = useState(false);

  const rows: Array<
    | { kind: "linha"; k: string; v: number[]; strong?: boolean; tone?: "pos" | "neg"; margin?: number; highlight?: boolean }
    | { kind: "custos" }
  > = [
    { kind: "linha", k: "(+) Receita Operacional Bruta", v: dre.receitaBruta, strong: true, tone: "pos" },
    { kind: "linha", k: "(−) Devoluções e Cancelamentos", v: dre.deducoesInadimplencia.map((x) => -x), tone: "neg" },
    { kind: "linha", k: "(−) Descontos Incondicionais", v: descIncond.map((x) => -x), tone: "neg" },
    { kind: "linha", k: "(−) Abatimentos", v: abatimentos.map((x) => -x), tone: "neg" },
    { kind: "linha", k: regime === "simples" ? "(−) DAS Simples Nacional" : "(−) Impostos sobre Vendas (PIS/COFINS/ICMS/ISS/CBS/IBS)", v: dre.impostosVendas.map((x) => -x), tone: "neg" },
    { kind: "linha", k: "(=) Receita Operacional Líquida", v: dre.receitaLiquida, strong: true },
    { kind: "custos" },
    { kind: "linha", k: "(−) Depreciação & Amortização", v: dre.depreciacao.map((x) => -x), tone: "neg" },
    { kind: "linha", k: "(=) LAIR — Lucro Antes do IR", v: dre.lair, strong: true },
    { kind: "linha", k: "(−) IRPJ + CSLL", v: dre.impostos.map((x) => -x), tone: "neg" },
    { kind: "linha", k: "(=) LUCRO LÍQUIDO", v: dre.lucroLiquido, strong: true, tone: ll >= 0 ? "pos" : "neg", margin: ind.margemLiquida, highlight: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border border-border/60 bg-card/40 p-1">
            {(["anual", "mensal"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded px-3 py-1 text-xs transition-all ${view === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"} ${v === "mensal" ? "hidden lg:block" : ""}`}>
                {v === "anual" ? "Anual" : "Mensal"}
              </button>
            ))}
          </div>
          <Select value={regime} onValueChange={(r) => update((s) => ({ ...s, tax: { ...s.tax, regime: r as TaxRegime } }))}>
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
          <span className="ml-2">· Era:</span>
          <Badge variant="outline" className={`ml-1 ${(state.tax.era ?? "atual") !== "atual" ? "border-primary/50 text-primary" : ""}`}>
            {TAX_ERA_SHORT[state.tax.era ?? "atual"]}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        <StatCard label="Faturamento" value={fmtBRL(rb)} tone="pos" />
        <StatCard label="EBITDA" value={fmtBRL(sum(dre.ebitda))} sub={`${ind.margemEbitda.toFixed(1)}%`} tone={sum(dre.ebitda) >= 0 ? "pos" : "neg"} />
        <StatCard label="Lucro Líq." value={fmtBRL(ll)} sub={`${ind.margemLiquida.toFixed(1)}%`} tone={ll >= 0 ? "pos" : "neg"} />
        <StatCard label="Impostos" value={fmtPct(tax.effective / 100)} tone="warn" sub={`${fmtBRLCompact(tax.annual)}`} />
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden shadow-sm">
        <div className="border-b border-border/60 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-foreground">D.R.E. — Demonstração do Resultado do Exercício</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Regime de Competência</p>
          </div>
        </div>
        <div className="scrollbar-none w-full overflow-x-auto overflow-y-hidden touch-pan-x">
          <table className="w-full min-w-[600px] md:min-w-full text-[clamp(0.65rem,1vw+0.3rem,0.875rem)] table-fixed md:table-auto">
            <colgroup>
              <col className="w-[120px] sm:w-auto" />
              {view === "mensal" && MESES.map((_, i) => (
                <col key={i} className="w-[70px]" />
              ))}
              <col className="w-[90px] md:w-auto" />
              <col className="w-[50px] md:w-auto" />
            </colgroup>

            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left">Descrição</th>
                {view === "mensal" && MESES.map((m, i) => (
                  <th key={m} className={`px-2 py-2 text-right ${mesesCriticosIdx.has(i) ? "border-l-2 border-r-2 border-destructive/60 text-destructive" : ""}`}>
                    {m}
                  </th>
                ))}
                <th className="px-4 py-2 text-right">Anual</th>
                <th className="px-3 py-2 text-right">% Rec</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.kind === "custos") {
                  const total = sum(totalCustos);
                  const pct = rb > 0 ? total / rb : 0;
                  return (
                    <Fragment key={idx}>
                      <tr className="border-t border-border/30 bg-accent/10 cursor-pointer hover:bg-accent/20" onClick={() => setOpenCustos((v) => !v)}>
                        <td className="px-3 py-2 text-[10px] sm:text-xs font-semibold truncate">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${openCustos ? "rotate-90" : ""}`} />
                            (−) Custos
                          </span>
                        </td>
                        {view === "mensal" && totalCustos.map((v, i) => (
                          <td key={i} className={`num px-2 py-2 text-right text-xs ${mesesCriticosIdx.has(i) ? "border-l-2 border-r-2 border-destructive/60" : ""} text-neg`}>
                            {v === 0 ? "—" : `− ${fmtBRLCompact(v)}`}
                          </td>
                        ))}
                        <td className="num px-4 py-2 text-right font-semibold text-neg">− {fmtBRL(total)}</td>
                        <td className="num px-3 py-2 text-right text-xs text-muted-foreground">{fmtPct(pct)}</td>
                      </tr>
                      {openCustos && grupos.map((g) => {
                        const linhas = linhasPreenchidas.filter((l) => l.category === g.id);
                        if (linhas.length === 0) return null;
                        const grupoTotal = sum(linhas.flatMap((l) => l.values));
                        return (
                          <Fragment key={g.id}>
                            <tr className="border-t border-border/20 bg-muted/10">
                              <td className="px-4 py-1.5 pl-8 text-[10px] uppercase tracking-wider text-primary/80">{g.titulo}</td>
                              {view === "mensal" && MESES.map((_, i) => <td key={i} className="px-2 py-1.5" />)}
                              <td className="num px-4 py-1.5 text-right text-[11px] text-muted-foreground">{fmtBRL(grupoTotal)}</td>
                              <td className="num px-3 py-1.5 text-right text-[10px] text-muted-foreground">{fmtPct(rb > 0 ? grupoTotal / rb : 0)}</td>
                            </tr>
                            {linhas.map((l, li) => {
                              const lTotal = sum(l.values);
                              return (
                                <tr key={`${g.id}_${li}`} className="border-t border-border/20">
                                  <td className="px-4 py-1.5 pl-12 text-xs text-muted-foreground">{l.label}</td>
                                  {view === "mensal" && l.values.map((v, i) => (
                                    <td key={i} className="num px-2 py-1.5 text-right text-xs text-muted-foreground">
                                      {v === 0 ? "—" : `− ${fmtBRLCompact(v)}`}
                                    </td>
                                  ))}
                                  <td className="num px-4 py-1.5 text-right text-xs text-neg">− {fmtBRL(lTotal)}</td>
                                  <td className="num px-3 py-1.5 text-right text-[10px] text-muted-foreground">{fmtPct(rb > 0 ? lTotal / rb : 0)}</td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                }
                const total = sum(row.v);
                const pct = rb > 0 ? total / rb : 0;
                const toneCls = row.tone === "pos" ? "text-pos" : row.tone === "neg" ? "text-neg" : "";
                return (
                  <tr key={idx} className={`border-t border-border/30 ${row.highlight ? "bg-primary/10" : row.strong ? "bg-accent/20" : ""}`}>
                    <td className={`px-3 py-2 ${row.strong ? "font-semibold" : "text-muted-foreground"} text-[10px] sm:text-xs truncate`}>{row.k}</td>
                    {view === "mensal" && row.v.map((v, i) => (
                      <td key={i} className={`num px-2 py-2 text-right text-xs ${mesesCriticosIdx.has(i) ? "border-l-2 border-r-2 border-destructive/60" : ""} ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-pos" : "text-muted-foreground"}`}>
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
    </div>
  );
}

function StatCard({ label, value, tone = "default", sub }: { label: string; value: React.ReactNode; tone?: "default" | "pos" | "neg" | "warn"; sub?: React.ReactNode }) {
  const toneClass = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card/60 p-3 shadow-sm transition-colors hover:border-border/80 sm:p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-[11px]">{label}</div>
      <div className={`mono mt-1 text-base font-semibold leading-tight sm:mt-2 sm:text-xl md:text-2xl ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-muted-foreground sm:text-xs">{sub}</div>}
    </div>
  );
}
