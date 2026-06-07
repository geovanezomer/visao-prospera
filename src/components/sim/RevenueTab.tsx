import { AppState, RevenueDeducao } from "@/lib/finance/types";
import { fmtBRL, fmtPct, MESES, sum, avg, zeros12, fill12 } from "@/lib/finance/format";
import { MoneyInput, NumInput, StatCard, SectionTitle } from "./primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";

function uid(): string {
  return `ded_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Base do "modo fixo": usa o primeiro valor não-zero ou o primeiro da série.
function fixedBase(values: number[]): number {
  if (!values?.length) return 0;
  const nonZero = values.find((v) => Number(v) !== 0);
  return Number.isFinite(nonZero as number) ? (nonZero as number) : (values[0] || 0);
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
  const setBrutaAll = (v: number) =>
    update((s) => ({ ...s, revenue: { ...s.revenue, bruta: fill12(v) } }));
  const setBrutaFixa = (fixed: boolean) =>
    update((s) => {
      const base = fixed ? fixedBase(s.revenue.bruta) : s.revenue.bruta[0] || 0;
      return {
        ...s,
        revenue: {
          ...s.revenue,
          brutaFixa: fixed,
          bruta: fixed ? fill12(base) : s.revenue.bruta,
        },
      };
    });

  // Inadimplência é armazenada em % internamente. A UI exibe em R$.
  // Converte R$ <-> % usando a Receita Bruta do mês (ou média anual no modo fixo).
  const setInadBRL = (i: number, brl: number) =>
    update((s) => {
      const base = s.revenue.bruta[i] || 0;
      const pct = base > 0 ? (brl / base) * 100 : 0;
      return { ...s, revenue: { ...s.revenue, inadimplencia: s.revenue.inadimplencia.map((x, j) => (j === i ? pct : x)) } };
    });
  const setInadAllBRL = (brl: number) =>
    update((s) => {
      const base = fixedBase(s.revenue.bruta) || (sum(s.revenue.bruta) / 12) || 0;
      const pct = base > 0 ? (brl / base) * 100 : 0;
      return { ...s, revenue: { ...s.revenue, inadimplencia: fill12(pct) } };
    });
  const setInadFixa = (fixed: boolean) =>
    update((s) => {
      const base = fixed ? fixedBase(s.revenue.inadimplencia) : s.revenue.inadimplencia[0] || 0;
      return {
        ...s,
        revenue: {
          ...s.revenue,
          inadimplenciaFixa: fixed,
          inadimplencia: fixed ? fill12(base) : s.revenue.inadimplencia,
        },
      };
    });

  // Valores em R$ derivados a partir do % armazenado
  const inadimpBRL = r.bruta.map((b, i) => b * (r.inadimplencia[i] / 100));
  const inadimpBRLAnual = sum(inadimpBRL);

  const addDeducao = () =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: [...(s.revenue.deducoes ?? []), { id: uid(), label: "", valores: zeros12(), fixed: false }],
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

  const setDeducaoValorAll = (id: string, v: number) =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: (s.revenue.deducoes ?? []).map((d) =>
          d.id === id ? { ...d, valores: fill12(v) } : d,
        ),
      },
    }));

  const setDeducaoFixed = (id: string, fixed: boolean) =>
    update((s) => ({
      ...s,
      revenue: {
        ...s.revenue,
        deducoes: (s.revenue.deducoes ?? []).map((d) => {
          if (d.id !== id) return d;
          const base = fixed ? fixedBase(d.valores) : d.valores[0] || 0;
          return { ...d, fixed, valores: fixed ? fill12(base) : d.valores };
        }),
      },
    }));

  const pctRec = (v: number) => (brutaAnual > 0 ? v / brutaAnual : 0);

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

      {/* Receita mensal — visualmente alinhado com a aba Custos */}
      <div className="rounded-lg border border-border/60 border-l-4 border-l-[color:var(--success)] bg-card/40">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <SectionTitle hint="Receita Bruta, inadimplência (em R$) e deduções customizadas (devoluções, perdas, furtos, descontos comerciais, abatimentos...). Use o toggle de Modo para aplicar o mesmo valor em todos os meses.">
            Receita mensal — 12 meses
          </SectionTitle>
          <Button size="sm" variant="outline" onClick={addDeducao} className="h-7 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
          </Button>
        </div>
        <div className="space-y-4 p-2">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="w-56 px-3 py-2">Rubrica</th>
                <th className="w-24 px-2 py-2 text-center">Modo</th>
                {MESES.map((m) => (
                  <th key={m} className="px-1 py-2 text-right">{m}</th>
                ))}
                <th className="px-3 py-2 text-right">Anual</th>
                <th className="w-14 px-2 py-2 text-right">% Rec</th>
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {/* Receita Bruta */}
              <tr className="border-t border-border/40 align-middle">
                <td className="px-3 py-2 text-xs">Receita Bruta</td>
                <td className="px-2 py-2">
                  <ModeToggle fixed={!!r.brutaFixa} onChange={setBrutaFixa} />
                </td>
                {r.brutaFixa ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                      <div className="w-36">
                        <MoneyInput value={fixedBase(r.bruta)} onChange={setBrutaAll} />
                      </div>
                    </div>
                  </td>
                ) : (
                  r.bruta.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => setBruta(i, n)} />
                    </td>
                  ))
                )}
                <td className="num px-3 py-2 text-right text-pos">{fmtBRL(brutaAnual)}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(1)}</td>
                <td />
              </tr>

              {/* Inadimplência R$ */}
              <tr className="border-t border-border/40 align-middle">
                <td className="px-3 py-2 text-xs">Inadimplência (R$)</td>
                <td className="px-2 py-2">
                  <ModeToggle fixed={!!r.inadimplenciaFixa} onChange={setInadFixa} />
                </td>
                {r.inadimplenciaFixa ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                      <div className="w-36">
                        <MoneyInput value={fixedBase(inadimpBRL)} onChange={setInadAllBRL} />
                      </div>
                    </div>
                  </td>
                ) : (
                  inadimpBRL.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => setInadBRL(i, n)} />
                    </td>
                  ))
                )}
                <td className={`num px-3 py-2 text-right ${inadimpBRLAnual > 0 ? "text-neg" : "text-muted-foreground"}`}>
                  {inadimpBRLAnual > 0 ? `− ${fmtBRL(inadimpBRLAnual)}` : fmtBRL(0)}
                </td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pctRec(inadimpBRLAnual))}</td>
                <td />
              </tr>


              {/* Deduções customizadas */}
              {deducoes.map((d) => {
                const totalD = sum(d.valores);
                return (
                  <tr key={d.id} className="border-t border-border/40 align-middle">
                    <td className="px-2 py-2">
                      <Input
                        value={d.label}
                        onChange={(e) => setDeducaoLabel(d.id, e.target.value)}
                        placeholder="Ex: Devoluções"
                        className="h-8 w-full text-xs"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <ModeToggle fixed={!!d.fixed} onChange={(f) => setDeducaoFixed(d.id, f)} />
                    </td>
                    {d.fixed ? (
                      <td className="px-1 py-1" colSpan={12}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                          <div className="w-36">
                            <MoneyInput value={fixedBase(d.valores)} onChange={(n) => setDeducaoValorAll(d.id, n)} />
                          </div>
                        </div>
                      </td>
                    ) : (
                      d.valores.map((v, i) => (
                        <td key={i} className="px-1 py-1">
                          <MoneyInput value={v} onChange={(n) => setDeducaoValor(d.id, i, n)} />
                        </td>
                      ))
                    )}
                    <td className={`num px-3 py-2 text-right ${totalD > 0 ? "text-neg" : "text-muted-foreground"}`}>
                      {totalD > 0 ? `− ${fmtBRL(totalD)}` : fmtBRL(0)}
                    </td>
                    <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                      {totalD > 0 ? fmtPct(pctRec(totalD)) : "—"}
                    </td>
                    <td className="px-1 py-2 text-center">
                      <button
                        onClick={() => removeDeducao(d.id)}
                        title="Remover linha"
                        className="text-muted-foreground transition hover:text-neg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {deducoes.length > 0 && (
                <tr className="border-t border-border/40 bg-card/20">
                  <td className="px-3 py-2 text-xs italic text-muted-foreground" colSpan={2}>
                    Total deduções customizadas
                  </td>
                  {outras.map((v, i) => (
                    <td key={i} className={`num px-1 py-2 text-right text-xs ${v > 0 ? "text-neg" : "text-muted-foreground"}`}>
                      {v > 0 ? `− ${fmtBRL(v)}` : "—"}
                    </td>
                  ))}
                  <td className={`num px-3 py-2 text-right text-xs ${outrasAnual > 0 ? "text-neg" : "text-muted-foreground"}`}>
                    {outrasAnual > 0 ? `− ${fmtBRL(outrasAnual)}` : fmtBRL(0)}
                  </td>
                  <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                    {outrasAnual > 0 ? fmtPct(pctRec(outrasAnual)) : "—"}
                  </td>
                  <td />
                </tr>
              )}

              {/* Receita Líquida */}
              <tr className="border-t border-border/40 bg-accent/20 align-middle">
                <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>Receita Líquida</td>
                {liquidas.map((v, i) => (
                  <td key={i} className="num px-1 py-2 text-right text-pos">{fmtBRL(v)}</td>
                ))}
                <td className="num px-3 py-2 text-right font-semibold text-pos">{fmtBRL(liqAnual)}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pctRec(liqAnual))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  );
}


function ModeToggle({ fixed, onChange }: { fixed: boolean; onChange: (fixed: boolean) => void }) {
  return (
    <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
      <span>Fixo</span>
      <Switch checked={!fixed} onCheckedChange={(v) => onChange(!v)} />
      <span>Mensal</span>
    </div>
  );
}
