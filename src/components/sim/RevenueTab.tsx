import { AppState, RevenueDeducao } from "@/lib/finance/types";
import { fmtBRL, fmtPct, MESES, sum, avg, zeros12 } from "@/lib/finance/format";
import { MoneyInput, NumInput, PctInput, StatCard, SectionTitle } from "./primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

function uid(): string {
  return `ded_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function RevenueTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const r = state.revenue;
  const deducoes: RevenueDeducao[] = r.deducoes ?? [];

  // Soma mensal das linhas customizadas
  const outras = MESES.map((_, i) =>
    deducoes.reduce((acc, d) => acc + Math.max(0, d.valores?.[i] || 0), 0),
  );

  const liquidas = r.bruta.map((b, i) =>
    Math.max(0, b * (1 - r.inadimplencia[i] / 100) - outras[i]),
  );
  const brutaAnual = sum(r.bruta);
  const liqAnual = sum(liquidas);
  const outrasAnual = sum(outras);
  const ciclo = r.pmr - r.pmp;

  const setBruta = (i: number, v: number) =>
    update((s) => ({ ...s, revenue: { ...s.revenue, bruta: s.revenue.bruta.map((x, j) => (j === i ? v : x)) } }));
  const setInad = (i: number, v: number) =>
    update((s) => ({ ...s, revenue: { ...s.revenue, inadimplencia: s.revenue.inadimplencia.map((x, j) => (j === i ? v : x)) } }));

  const addDeducao = () =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: [...(s.revenue.deducoes ?? []), { id: uid(), label: "", valores: zeros12() }],
      },
    }));

  const removeDeducao = (id: string) =>
    update((s) => ({
      ...s,
      revenue: { ...s.revenue, deducoes: (s.revenue.deducoes ?? []).filter((d) => d.id !== id) },
    }));

  const setDeducaoLabel = (id: string, label: string) =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: (s.revenue.deducoes ?? []).map((d) => (d.id === id ? { ...d, label } : d)),
      },
    }));

  const setDeducaoValor = (id: string, mesIdx: number, v: number) =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: (s.revenue.deducoes ?? []).map((d) =>
          d.id === id ? { ...d, valores: d.valores.map((x, j) => (j === mesIdx ? v : x)) } : d,
        ),
      },
    }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard label="Receita Bruta Anual" value={fmtBRL(brutaAnual)} tone="pos" hint={{ description: "Total faturado no ano antes de qualquer dedução (impostos, devoluções, inadimplência).", formula: "Σ Receita Bruta dos 12 meses" }} />
        <StatCard label="Receita Líquida Anual" value={fmtBRL(liqAnual)} sub={`Média mensal ${fmtBRL(avg(liquidas))}`} hint={{ description: "Receita após descontar inadimplência e as deduções customizadas que você adicionou. Os impostos sobre venda são abatidos depois, na DRE.", formula: "Receita Bruta − Inadimplência − Σ Deduções customizadas" }} />
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-4">
          <div>
            <SectionTitle>Receita mensal — 12 meses</SectionTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Inclua linhas livres de dedução (devoluções, perdas, furtos, descontos comerciais, abatimentos...). Elas abatem a Receita Líquida e a base dos impostos sobre venda na DRE.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addDeducao} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Incluir linha
          </Button>
        </div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2">Métrica</th>
                {MESES.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
                <th className="px-4 py-2 text-right">Total</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/40">
                <td className="px-4 py-2 text-xs text-muted-foreground">Receita Bruta</td>
                {r.bruta.map((v, i) => (
                  <td key={i} className="px-1 py-1"><MoneyInput value={v} onChange={(n) => setBruta(i, n)} /></td>
                ))}
                <td className="num px-4 py-2 text-right text-pos">{fmtBRL(brutaAnual)}</td>
                <td />
              </tr>
              <tr className="border-t border-border/40">
                <td className="px-4 py-2 text-xs text-muted-foreground">Inadimplência</td>
                {r.inadimplencia.map((v, i) => (
                  <td key={i} className="px-1 py-1"><PctInput value={v} onChange={(n) => setInad(i, n)} /></td>
                ))}
                <td className="num px-4 py-2 text-right text-muted-foreground">{fmtPct(avg(r.inadimplencia) / 100)}</td>
                <td />
              </tr>

              {deducoes.map((d) => {
                const totalD = sum(d.valores);
                return (
                  <tr key={d.id} className="border-t border-border/40">
                    <td className="px-2 py-1">
                      <Input
                        value={d.label}
                        onChange={(e) => setDeducaoLabel(d.id, e.target.value)}
                        placeholder="Ex: Devoluções"
                        className="h-8 w-full text-xs"
                      />
                    </td>
                    {d.valores.map((v, i) => (
                      <td key={i} className="px-1 py-1">
                        <MoneyInput value={v} onChange={(n) => setDeducaoValor(d.id, i, n)} />
                      </td>
                    ))}
                    <td className={`num px-4 py-2 text-right ${totalD > 0 ? "text-neg" : "text-muted-foreground"}`}>
                      {totalD > 0 ? `− ${fmtBRL(totalD)}` : fmtBRL(0)}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeDeducao(d.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-neg"
                        aria-label="Remover linha"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {deducoes.length > 0 && (
                <tr className="border-t border-border/40">
                  <td className="px-4 py-2 text-xs italic text-muted-foreground">Total deduções customizadas</td>
                  {outras.map((v, i) => (
                    <td key={i} className={`num px-2 py-2 text-right text-xs ${v > 0 ? "text-neg" : "text-muted-foreground"}`}>
                      {v > 0 ? `− ${fmtBRL(v)}` : "—"}
                    </td>
                  ))}
                  <td className={`num px-4 py-2 text-right text-xs ${outrasAnual > 0 ? "text-neg" : "text-muted-foreground"}`}>
                    {outrasAnual > 0 ? `− ${fmtBRL(outrasAnual)}` : fmtBRL(0)}
                  </td>
                  <td />
                </tr>
              )}

              <tr className="border-t border-border/40 bg-accent/20">
                <td className="px-4 py-2 text-xs font-semibold">Receita Líquida</td>
                {liquidas.map((v, i) => (
                  <td key={i} className="num px-2 py-2 text-right text-pos">{fmtBRL(v)}</td>
                ))}
                <td className="num px-4 py-2 text-right font-semibold text-pos">{fmtBRL(liqAnual)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
