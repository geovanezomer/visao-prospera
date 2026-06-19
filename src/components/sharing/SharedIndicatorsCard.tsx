// Indicadores read-only — escalares anuais, sem toggle de período.
import type { ShareSnapshot } from "@/engines/sharing/types";
import { fmtBRL, fmtPct } from "@/engines/finance/format";

interface Item {
  label: string;
  value: string;
  group: string;
}

export function SharedIndicatorsCard({ snapshot }: { snapshot: ShareSnapshot }) {
  const i = snapshot.indicators;

  const items: Item[] = [
    { group: "Rentabilidade", label: "Margem Bruta", value: fmtPct(i.margemBruta) },
    { group: "Rentabilidade", label: "Margem EBITDA", value: fmtPct(i.margemEbitda) },
    { group: "Rentabilidade", label: "Margem Líquida", value: fmtPct(i.margemLiquida) },
    { group: "Rentabilidade", label: "ROE", value: fmtPct(i.roe) },
    { group: "Rentabilidade", label: "ROA", value: fmtPct(i.roa) },
    { group: "Rentabilidade", label: "ROIC", value: fmtPct(i.roic) },
    { group: "Rentabilidade", label: "WACC", value: fmtPct(i.wacc) },

    { group: "Liquidez", label: "Liquidez Corrente", value: i.liquidezCorrente.toFixed(2) },
    { group: "Liquidez", label: "Liquidez Seca", value: i.liquidezSeca.toFixed(2) },
    { group: "Liquidez", label: "Liquidez Imediata", value: i.liquidezImediata.toFixed(2) },

    { group: "Endividamento", label: "Endividamento Geral", value: fmtPct(i.endividamentoGeral) },
    { group: "Endividamento", label: "Dívida Líq./EBITDA", value: i.dividaLiqEbitda.toFixed(2) + "x" },
    { group: "Endividamento", label: "Cobertura de Juros", value: i.coberturaJuros.toFixed(2) + "x" },

    { group: "Caixa", label: "FCF", value: fmtBRL(i.fcf) },
    { group: "Caixa", label: "Ciclo Financeiro", value: i.cicloFinanceiro.toFixed(0) + " dias" },
  ];

  const groups = ["Rentabilidade", "Liquidez", "Endividamento", "Caixa"];

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">Indicadores Anuais</h2>
      {groups.map((g) => (
        <div key={g}>
          <h3 className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">{g}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {items
              .filter((it) => it.group === g)
              .map((it) => (
                <div key={it.label} className="rounded-md border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground">{it.label}</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">{it.value}</p>
                </div>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
