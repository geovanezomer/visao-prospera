// Fluxo de Caixa read-only.
import { useState } from "react";
import type { ShareSnapshot } from "@/engines/sharing/types";
import {
  aggregateByPeriod,
  periodLabelsFor,
  type PeriodView,
} from "@/engines/sharing/periodAggregation";
import { fmtBRL, sum } from "@/engines/finance/format";
import { PeriodToggle } from "./PeriodToggle";

export function SharedCashflowCard({ snapshot }: { snapshot: ShareSnapshot }) {
  const [view, setView] = useState<PeriodView>("trimestral");
  const labels = periodLabelsFor(view);
  const cf = snapshot.cashflow;
  const agg = (a: number[]) => aggregateByPeriod(a, view);

  const rows = [
    { label: "Fluxo Operacional", values: agg(cf.fluxoOperacional), bold: true },
    { label: "Fluxo de Investimento", values: agg(cf.fluxoInvestimento) },
    { label: "Fluxo de Financiamento", values: agg(cf.fluxoFinanciamento) },
    { label: "Variação de Caixa", values: agg(cf.variacaoCaixa), bold: true },
  ];

  // Saldo final por período: usa o último mês de cada bucket (não soma).
  const saldoFinalAgg =
    view === "mensal"
      ? cf.saldoFinal.slice(0, 12)
      : view === "trimestral"
        ? [0, 1, 2, 3].map((q) => cf.saldoFinal[q * 3 + 2] ?? 0)
        : [cf.saldoFinal[11] ?? 0];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Fluxo de Caixa</h2>
        <PeriodToggle view={view} onChange={setView} />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Conta</th>
              {labels.map((l) => (
                <th key={l} className="px-3 py-2 text-right font-medium">{l}</th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t">
                <td className={`px-3 py-1.5 ${r.bold ? "font-semibold" : ""}`}>{r.label}</td>
                {r.values.map((v, i) => (
                  <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${r.bold ? "font-semibold" : ""}`}>
                    {fmtBRL(v)}
                  </td>
                ))}
                <td className={`px-3 py-1.5 text-right tabular-nums ${r.bold ? "font-semibold" : ""}`}>
                  {fmtBRL(sum(r.values))}
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/20">
              <td className="px-3 py-1.5 font-semibold">Saldo Final</td>
              {saldoFinalAgg.map((v, i) => {
                const critical = v <= cf.limiarAlerta;
                return (
                  <td
                    key={i}
                    className={`px-3 py-1.5 text-right font-semibold tabular-nums ${critical ? "text-destructive" : ""}`}
                  >
                    {fmtBRL(v)}
                  </td>
                );
              })}
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                {fmtBRL(cf.saldoFinal[11] ?? 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Saldo inicial do ano: {fmtBRL(cf.saldoInicial[0] ?? 0)} · Limiar de alerta:{" "}
        {fmtBRL(cf.limiarAlerta)}
      </p>
    </section>
  );
}
