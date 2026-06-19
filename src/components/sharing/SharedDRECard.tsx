// DRE read-only para a página compartilhada.
import { useState } from "react";
import type { ShareSnapshot } from "@/engines/sharing/types";
import {
  aggregateByPeriod,
  periodLabelsFor,
  type PeriodView,
} from "@/engines/sharing/periodAggregation";
import { fmtBRL, sum } from "@/engines/finance/format";
import { PeriodToggle } from "./PeriodToggle";

interface Row {
  label: string;
  values: number[];
  bold?: boolean;
  muted?: boolean;
}

export function SharedDRECard({ snapshot }: { snapshot: ShareSnapshot }) {
  const [view, setView] = useState<PeriodView>("trimestral");
  const labels = periodLabelsFor(view);
  const d = snapshot.dre;
  const agg = (a: number[]) => aggregateByPeriod(a, view);

  const rows: Row[] = [
    { label: "Receita Bruta", values: agg(d.receitaBruta), bold: true },
    { label: "(–) Impostos sobre Vendas", values: agg(d.impostosVendas).map((v) => -v), muted: true },
    { label: "Receita Líquida", values: agg(d.receitaLiquida), bold: true },
    { label: "(–) CPV/CMV/CSP", values: agg(d.cpv).map((v) => -v), muted: true },
    { label: "Lucro Bruto", values: agg(d.lucroBruto), bold: true },
    { label: "(–) Custos Fixos", values: agg(d.custosFixos).map((v) => -v), muted: true },
    { label: "(–) Custos Variáveis", values: agg(d.custosVariaveis).map((v) => -v), muted: true },
    { label: "EBITDA", values: agg(d.ebitda), bold: true },
    { label: "(–) Depreciação", values: agg(d.depreciacao).map((v) => -v), muted: true },
    { label: "EBIT", values: agg(d.ebit), bold: true },
    { label: "Resultado Financeiro", values: agg(d.resultadoFinanceiro), muted: true },
    { label: "LAIR", values: agg(d.lair), bold: true },
    { label: "(–) Impostos sobre o Lucro", values: agg(d.impostos).map((v) => -v), muted: true },
    { label: "Lucro Líquido", values: agg(d.lucroLiquido), bold: true },
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Demonstração do Resultado</h2>
        <PeriodToggle view={view} onChange={setView} />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Conta</th>
              {labels.map((l) => (
                <th key={l} className="px-3 py-2 text-right font-medium">
                  {l}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t">
                <td className={`px-3 py-1.5 ${r.bold ? "font-semibold" : ""} ${r.muted ? "text-muted-foreground" : ""}`}>
                  {r.label}
                </td>
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
          </tbody>
        </table>
      </div>
    </section>
  );
}
