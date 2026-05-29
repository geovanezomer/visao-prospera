import { AppState, CostLine } from "@/lib/finance/types";
import { fmtBRL, fmtPct, MESES, sum } from "@/lib/finance/format";
import { monthValues } from "@/lib/finance/calculations";
import { MoneyInput, SectionTitle, StatCard } from "./primitives";
import { Switch } from "@/components/ui/switch";

export function CostsTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const receitaBrutaAnual = sum(state.revenue.bruta);
  const op = state.costs.filter((c) => c.group === "operacional");
  const fin = state.costs.filter((c) => c.group === "financeiro");

  const updateLine = (id: string, patch: Partial<CostLine>) =>
    update((s) => ({ ...s, costs: s.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const setMonth = (id: string, i: number, v: number) =>
    updateLine(id, { values: state.costs.find((c) => c.id === id)!.values.map((x, j) => (j === i ? v : x)) });

  const setFixed = (id: string, fixed: boolean) => updateLine(id, { fixed });

  const totOp = sum(op.flatMap((c) => monthValues(c)));
  const totFin = sum(fin.flatMap((c) => monthValues(c)));

  const renderTable = (lines: CostLine[], title: string, hint?: string) => (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={hint}>{title}</SectionTitle>
      </div>
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="w-56 px-4 py-2">Categoria</th>
              <th className="w-28 px-2 py-2 text-center">Modo</th>
              {MESES.map((m) => <th key={m} className="px-1 py-2 text-right">{m}</th>)}
              <th className="px-3 py-2 text-right">Anual</th>
              <th className="w-16 px-3 py-2 text-right">% Rec</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((c) => {
              const vals = monthValues(c);
              const anual = sum(vals);
              const pct = receitaBrutaAnual > 0 ? anual / receitaBrutaAnual : 0;
              return (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="px-4 py-2 text-xs">{c.label}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                      <span>Fixo</span>
                      <Switch checked={!c.fixed} onCheckedChange={(v) => setFixed(c.id, !v)} />
                      <span>Mensal</span>
                    </div>
                  </td>
                  {c.fixed ? (
                    <>
                      <td className="px-1 py-1" colSpan={12}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase text-muted-foreground">Aplicado em todos os meses:</span>
                          <div className="w-32"><MoneyInput value={c.values[0]} onChange={(n) => updateLine(c.id, { values: Array(12).fill(n) })} /></div>
                        </div>
                      </td>
                    </>
                  ) : (
                    vals.map((v, i) => (
                      <td key={i} className="px-1 py-1"><MoneyInput value={v} onChange={(n) => setMonth(c.id, i, n)} /></td>
                    ))
                  )}
                  <td className="num px-3 py-2 text-right text-neg">{fmtBRL(anual)}</td>
                  <td className="num px-3 py-2 text-right text-xs text-muted-foreground">{fmtPct(pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Custos operacionais (ano)" value={fmtBRL(totOp)} tone="neg" sub={fmtPct(totOp / Math.max(1, receitaBrutaAnual)) + " da receita"} />
        <StatCard label="Custos financeiros (ano)" value={fmtBRL(totFin)} tone="neg" sub={fmtPct(totFin / Math.max(1, receitaBrutaAnual)) + " da receita"} />
        <StatCard label="Total custos" value={fmtBRL(totOp + totFin)} tone="neg" />
      </div>
      {renderTable(op, "Custos e despesas operacionais", "Custos diretamente relacionados à operação. Salários CLT já consideram encargos (~72%).")}
      {renderTable(fin, "Custos financeiros", "Juros, IOF, tarifas bancárias e antecipação de recebíveis.")}
    </div>
  );
}
