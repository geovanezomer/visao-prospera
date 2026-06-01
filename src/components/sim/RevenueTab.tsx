import { AppState } from "@/lib/finance/types";
import { fmtBRL, fmtPct, MESES, sum, avg } from "@/lib/finance/format";
import { MoneyInput, NumInput, PctInput, StatCard, SectionTitle, HelpTip } from "./primitives";

export function RevenueTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const r = state.revenue;
  const liquidas = r.bruta.map((b, i) => b * (1 - r.inadimplencia[i] / 100));
  const brutaAnual = sum(r.bruta);
  const liqAnual = sum(liquidas);
  const ciclo = r.pmr - r.pmp;

  const setBruta = (i: number, v: number) =>
    update((s) => ({ ...s, revenue: { ...s.revenue, bruta: s.revenue.bruta.map((x, j) => (j === i ? v : x)) } }));
  const setInad = (i: number, v: number) =>
    update((s) => ({ ...s, revenue: { ...s.revenue, inadimplencia: s.revenue.inadimplencia.map((x, j) => (j === i ? v : x)) } }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard label="Receita Bruta Anual" value={fmtBRL(brutaAnual)} tone="pos" hint={{ description: "Total faturado no ano antes de qualquer dedução (impostos, devoluções, inadimplência).", formula: "Σ Receita Bruta dos 12 meses" }} />
        <StatCard label="Receita Líquida Anual" value={fmtBRL(liqAnual)} sub={`Média mensal ${fmtBRL(avg(liquidas))}`} hint={{ description: "Receita após descontar inadimplência e deduções. É a base de cálculo das margens (bruta, EBITDA, líquida).", formula: "Receita Bruta − Inadimplência − Deduções" }} />
        <StatCard label="Inadimplência média" value={fmtPct(avg(r.inadimplencia) / 100)} hint="Percentual médio esperado de não recebimento sobre a receita bruta." />
        <StatCard
          label="Ciclo Financeiro"
          value={`${ciclo} dias`}
          tone={ciclo > 30 ? "warn" : ciclo > 0 ? "default" : "pos"}
          hint="PMR - PMP. Quanto maior, mais capital de giro a empresa precisa para sustentar o ciclo."
          sub={ciclo > 0 ? "Empresa financia o cliente" : "Fornecedor financia a empresa"}
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <SectionTitle hint="Prazo Médio de Recebimento e de Pagamento, em dias.">Prazos médios</SectionTitle>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground">PMR — Recebimento (dias)</label>
            <NumInput integer min={0} value={r.pmr} onChange={(n) => update((s) => ({ ...s, revenue: { ...s.revenue, pmr: n } }))} className="mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">PMP — Pagamento (dias)</label>
            <NumInput integer min={0} value={r.pmp} onChange={(n) => update((s) => ({ ...s, revenue: { ...s.revenue, pmp: n } }))} className="mt-1" />
          </div>

          <div className="rounded-md bg-accent/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Impacto:</span> cada dia de ciclo financeiro positivo amplia a necessidade de capital de giro proporcionalmente ao custo operacional mensal.
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <SectionTitle>Receita mensal — 12 meses</SectionTitle>
        </div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Métrica</th>
                {MESES.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/40">
                <td className="px-4 py-2 text-xs text-muted-foreground">Receita Bruta</td>
                {r.bruta.map((v, i) => (
                  <td key={i} className="px-1 py-1"><MoneyInput value={v} onChange={(n) => setBruta(i, n)} /></td>
                ))}
                <td className="num px-4 py-2 text-right text-pos">{fmtBRL(brutaAnual)}</td>
              </tr>
              <tr className="border-t border-border/40">
                <td className="px-4 py-2 text-xs text-muted-foreground">Inadimplência</td>
                {r.inadimplencia.map((v, i) => (
                  <td key={i} className="px-1 py-1"><PctInput value={v} onChange={(n) => setInad(i, n)} /></td>
                ))}
                <td className="num px-4 py-2 text-right text-muted-foreground">{fmtPct(avg(r.inadimplencia) / 100)}</td>
              </tr>
              <tr className="border-t border-border/40 bg-accent/20">
                <td className="px-4 py-2 text-xs font-semibold">Receita Líquida</td>
                {liquidas.map((v, i) => (
                  <td key={i} className="num px-2 py-2 text-right text-pos">{fmtBRL(v)}</td>
                ))}
                <td className="num px-4 py-2 text-right font-semibold text-pos">{fmtBRL(liqAnual)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
