import { useState, useEffect } from "react";
import { AppState } from "@/engines/finance/types";
import { buildCashFlow } from "@/engines/finance/cashflow";
import { fmtBRL, fmtBRLCompact, sum } from "@/engines/finance/format";
import { SectionTitle } from "../primitives";
import { aggregate, periodLabels, Period } from "./tableHelpers";

// Tabela DFC pelo método direto, com agregação mensal/trimestral/anual.
export function DFCTable({ state, cf }: { state: AppState; cf: ReturnType<typeof buildCashFlow> }) {
  const [period, setPeriod] = useState<Period>("trimestral");
  // Mobile defaults: <sm vira "anual"; <lg vira "trimestral" se estava em "mensal".
  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth;
      if (w < 640 && period !== "anual") setPeriod("anual");
      else if (w >= 640 && w < 1024 && period === "mensal") setPeriod("trimestral");
    };
    window.addEventListener("resize", handler);
    handler();
    return () => window.removeEventListener("resize", handler);
  }, [period]);
  const cols = periodLabels(period);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4">
        <SectionTitle hint="Caixa pelo método direto. Receitas e CPV usam PMR/PMP da aba Receitas. Impostos pagos no mês seguinte ao da competência.">
          Demonstração do Fluxo de Caixa — método direto
        </SectionTitle>
        <div className="inline-flex rounded-md border border-border/60 bg-card p-0.5 text-xs">
          {(["mensal", "trimestral", "anual"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 capitalize transition-colors ${
                period === p
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin relative isolate overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 z-20 w-[320px] min-w-[320px] bg-card px-4 py-2 shadow-[1px_0_0_0_var(--border)]">
                Linha
              </th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-2 text-right">
                  {c}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Saldo inicial"
              values={aggregate(cf.saldoInicial, period, "first")}
              muted
              rawTotal={cf.saldoInicial[0]}
            />
            <SectionRow label="ATIVIDADES OPERACIONAIS" cols={cols.length} />
            <Row
              label="(+) Recebimentos de clientes"
              values={aggregate(cf.recebimentos, period, "sum")}
              tone="pos"
            />
            <Row
              label="(+) Receitas financeiras (aplicações)"
              values={aggregate(cf.receitasFinanceiras, period, "sum")}
              tone="pos"
              rawTotal={sum(cf.receitasFinanceiras)}
            />
            <Row
              label="(−) Pagamentos a fornecedores (CPV)"
              values={aggregate(
                cf.pagamentosFornecedores.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(cf.pagamentosFornecedores)}
            />
            <Row
              label="(−) Pagamentos de custos fixos"
              values={aggregate(
                cf.pagamentosFixos.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(cf.pagamentosFixos)}
            />
            <Row
              label="(−) Pagamentos de custos variáveis"
              values={aggregate(
                cf.pagamentosVariaveis.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(cf.pagamentosVariaveis)}
            />
            <Row
              label="(−) Despesas financeiras"
              values={aggregate(
                cf.pagamentosFinanceiros.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(cf.pagamentosFinanceiros)}
            />
            <Row
              label="(−) Impostos pagos"
              values={aggregate(
                cf.pagamentosImpostos.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(cf.pagamentosImpostos)}
            />
            <Row
              label="(=) Fluxo das Operações"
              values={aggregate(cf.fluxoOperacional, period, "sum")}
              strong
              rawTotal={sum(cf.fluxoOperacional)}
            />

            <SectionRow label="ATIVIDADES DE INVESTIMENTO" cols={cols.length} />
            <Row
              label="(−) CapEx — aportes em ativo fixo"
              values={aggregate(
                state.cashflow.capex.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(state.cashflow.capex)}
            />
            <Row
              label="(=) Fluxo de Investimento"
              values={aggregate(cf.fluxoInvestimento, period, "sum")}
              strong
              rawTotal={sum(cf.fluxoInvestimento)}
            />

            <SectionRow label="ATIVIDADES DE FINANCIAMENTO" cols={cols.length} />
            <Row
              label="(+) Aportes de sócios"
              values={aggregate(state.cashflow.aportes, period, "sum")}
              tone="pos"
              rawTotal={sum(state.cashflow.aportes)}
            />
            <Row
              label="(+) Captação de empréstimos"
              values={aggregate(state.cashflow.emprestimosCaptados, period, "sum")}
              tone="pos"
              rawTotal={sum(state.cashflow.emprestimosCaptados)}
            />
            <Row
              label="(−) Amortização de principal"
              values={aggregate(
                state.cashflow.amortizacoes.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(state.cashflow.amortizacoes)}
            />
            <Row
              label="(−) Distribuição de dividendos"
              values={aggregate(
                state.cashflow.dividendos.map((v) => -v),
                period,
                "sum",
              )}
              tone="neg"
              rawTotal={-sum(state.cashflow.dividendos)}
            />
            <Row
              label="(=) Fluxo de Financiamento"
              values={aggregate(cf.fluxoFinanciamento, period, "sum")}
              strong
              rawTotal={sum(cf.fluxoFinanciamento)}
            />

            <Row
              label="(=) VARIAÇÃO DE CAIXA"
              values={aggregate(cf.variacaoCaixa, period, "sum")}
              strong
              highlight
              rawTotal={sum(cf.variacaoCaixa)}
            />
            <Row
              label="(=) SALDO FINAL"
              values={aggregate(cf.saldoFinal, period, "last")}
              strong
              highlight
              rawTotal={cf.saldoFinal[11]}
            />
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
        Modelo simplificado: ignora variações de estoque e ajustes de capital de giro contábil mais
        finos. Para diagnóstico operacional é suficiente.
      </div>
    </div>
  );
}

function Row({
  label,
  values,
  tone,
  strong,
  highlight,
  muted,
  rawTotal,
}: {
  label: string;
  values: number[];
  tone?: "pos" | "neg";
  strong?: boolean;
  highlight?: boolean;
  muted?: boolean;
  /** Total a exibir (sobrepõe a soma de `values`). Útil ao agregar por período. */
  rawTotal?: number;
}) {
  const total = rawTotal ?? sum(values);
  const toneCls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "";
  const rowBg = highlight ? "bg-primary/10" : strong ? "bg-accent/20" : "bg-card";
  return (
    <tr className={`${highlight ? "bg-primary/10" : strong ? "bg-accent/20" : ""}`}>
      <td
        className={`sticky left-0 z-10 w-[320px] min-w-[320px] ${rowBg} border-t border-border/30 px-4 py-1.5 text-xs shadow-[1px_0_0_0_var(--border)] ${strong ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`num border-t border-border/30 px-2 py-1.5 text-right text-[11px] ${v < 0 ? "text-neg" : v > 0 ? toneCls || "text-foreground" : "text-muted-foreground"}`}
        >
          {v === 0 ? "—" : fmtBRLCompact(v)}
        </td>
      ))}
      <td
        className={`num border-t border-border/30 px-3 py-1.5 text-right text-xs ${strong ? "font-semibold" : ""} ${total < 0 ? "text-neg" : total > 0 ? toneCls || "" : "text-muted-foreground"}`}
      >
        {fmtBRL(total)}
      </td>
    </tr>
  );
}

function SectionRow({ label, cols = 12 }: { label: string; cols?: number }) {
  return (
    <tr className="bg-card/60">
      <td className="sticky left-0 z-10 w-[320px] min-w-[320px] border-t border-border/40 bg-card/80 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary/80 shadow-[1px_0_0_0_var(--border)]">
        {label}
      </td>
      <td colSpan={cols + 1} className="border-t border-border/40 px-4 py-1.5" />
    </tr>
  );
}
