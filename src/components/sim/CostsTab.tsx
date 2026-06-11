import { useEffect, useState } from "react";
import { AppState, CostCategory, CostLine, TaxRegime } from "@/lib/finance/types";
import { fill12, fmtBRL, fmtPct, MESES, sum } from "@/lib/finance/format";
import { fixedCostBase, monthValues } from "@/lib/finance/calculations";
import { MoneyInput, SectionTitle, StatCard } from "./primitives";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { PrazoTable } from "./PrazoTable";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

export function CostsTab({ state, update }: { state: AppState; update: Updater }) {
  const receitaBrutaAnual = sum(state.revenue.bruta);


  // Aviso inline quando o usuário tenta digitar valor negativo (revertido para 0)
  const [negWarn, setNegWarn] = useState<string | null>(null);
  useEffect(() => {
    if (!negWarn) return;
    const t = setTimeout(() => setNegWarn(null), 4000);
    return () => clearTimeout(t);
  }, [negWarn]);

  const byCat = (cat: CostCategory) => state.costs.filter((c) => c.category === cat);

  const updateLine = (id: string, patch: Partial<CostLine>) =>
    update((s) => ({ ...s, costs: s.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const safeCostValue = (id: string, i: number | null, v: number) => {
    const cur = state.costs.find((c) => c.id === id);
    let safe = Number.isFinite(v) ? v : 0;
    if (!Number.isFinite(v) || v < 0) {
      safe = 0;
      const label = cur?.label ?? "Rubrica";
      const suffix = i === null ? "valor fixo" : MESES[i];
      setNegWarn(`"${label}" — ${suffix}: valores negativos não são permitidos. Use uma linha dedicada para recuperações/créditos. Revertido para R$ 0.`);
    }
    return safe;
  };

  const setMonth = (id: string, i: number, v: number) => {
    const safe = safeCostValue(id, i, v);
    update((s) => ({
      ...s,
      costs: s.costs.map((c) =>
        c.id === id
          ? { ...c, values: (c.values.length === 12 ? c.values : fill12(c.values[0] || 0)).map((x, j) => (j === i ? safe : x)) }
          : c,
      ),
    }));
  };

  const setAllMonths = (id: string, v: number) => {
    const safe = safeCostValue(id, null, v);
    updateLine(id, { values: fill12(safe) });
  };

  const setFixed = (id: string, fixed: boolean) =>
    update((s) => ({
      ...s,
      costs: s.costs.map((c) => {
        if (c.id !== id) return c;
        const values = c.values.length === 12 ? c.values : fill12(c.values[0] || 0);
        const base = c.fixed ? fixedCostBase(values) : values[0] || 0;
        return { ...c, fixed, values: fixed || c.fixed ? fill12(base) : values };
      }),
    }));

  const addLine = (category: CostCategory, subcategory?: string) => {
    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newLine: CostLine = {
      id,
      label: "Nova rubrica",
      category,
      subcategory,
      values: Array(12).fill(0),
      fixed: true,
      custom: true,
    };
    update((s) => ({ ...s, costs: [...s.costs, newLine] }));
  };

  const removeLine = (id: string) =>
    update((s) => ({ ...s, costs: s.costs.filter((c) => c.id !== id) }));

  const setLabel = (id: string, label: string) => updateLine(id, { label });





  // totais
  const totCV = sum(byCat("custo_vendas").flatMap((c) => monthValues(c, state.tax.regime)));
  const totFix = sum(byCat("fixo").flatMap((c) => monthValues(c, state.tax.regime)));
  const totVar = sum(byCat("variavel").flatMap((c) => monthValues(c, state.tax.regime)));
  const totFin = sum(byCat("financeiro").flatMap((c) => monthValues(c, state.tax.regime)));
  const totGeral = totCV + totFix + totVar + totFin;

  const pctRec = (v: number) => (receitaBrutaAnual > 0 ? v / receitaBrutaAnual : 0);

  return (
    <div className="space-y-6">
      {negWarn && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-foreground/90">{negWarn}</span>
        </div>
      )}
      {/* Sumário */}
      <div className="grid gap-3 md:grid-cols-4">
        <StatCard
          label="Custos Fixos"
          value={fmtBRL(totFix)}
          tone="neg"
          sub={fmtPct(pctRec(totFix)) + " da receita"}
          hint="Não variam com o volume vendido (aluguel, pró-labore, contabilidade…)."
        />
        <StatCard
          label="Custos Variáveis"
          value={fmtBRL(totVar)}
          tone="neg"
          sub={fmtPct(pctRec(totVar)) + " da receita"}
          hint="Variam com vendas (marketing, comissões, insumos, terceirização…)."
        />
        <StatCard
          label="Custos Financeiros"
          value={fmtBRL(totFin)}
          tone="neg"
          sub={fmtPct(pctRec(totFin)) + " da receita"}
          hint="Juros, IOF, antecipação de recebíveis, tarifas bancárias, maquininha."
        />
        <StatCard label="Total de Custos" value={fmtBRL(totGeral)} tone="neg" sub={fmtPct(pctRec(totGeral)) + " da receita"} hint={{ description: "Soma de todos os custos. Quanto menor o % sobre a receita, mais saudável a operação.", formula: "Custos Fixos + Variáveis + Financeiros" }} />
      </div>






      {/* Custos Fixos */}
      <SectionBlock
        title="Custos e Despesas Fixas"
        hint="Não variam com o volume vendido. Compõem a estrutura mínima de operação."
        accentClass="border-l-[color:var(--warning)]"
        onAdd={() => addLine("fixo")}
      >
        <CostTable
          lines={byCat("fixo")}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={state.tax.regime}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Custos Variáveis */}
      <SectionBlock
        title="Custos e Despesas Variáveis"
        hint="Variam proporcionalmente às vendas — comissões, marketing, frete sobre vendas etc."
        accentClass="border-l-[#5BA8F5]"
        onAdd={() => addLine("variavel")}
      >
        <CostTable
          lines={byCat("variavel")}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={state.tax.regime}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Custos Financeiros */}
      <SectionBlock
        title="Custos Financeiros"
        hint="Juros, IOF, tarifas bancárias e antecipação de recebíveis."
        accentClass="border-l-neg"
        onAdd={() => addLine("financeiro")}
      >
        <CostTable
          lines={byCat("financeiro")}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={state.tax.regime}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* PMP — Prazo Médio de Pagamento (mês a mês) */}
      <PrazoTable
        title="Prazo Médio de Pagamento (PMP) — 12 meses"
        hint="Dias entre receber a nota do fornecedor e efetivamente pagar. Quanto maior, mais o fornecedor financia o ciclo da empresa."
        accentClass="border-l-neg"
        rubrica="PMP — Pagamento (dias)"
        summaryLabel="PMP"
        values={state.revenue.pmpMensal ?? fill12(state.revenue.pmp || 0)}
        fixed={!!state.revenue.pmpFixo}
        onMonth={(i, v) =>
          update((s) => {
            const base = s.revenue.pmpMensal ?? fill12(s.revenue.pmp || 0);
            const next = base.map((x, j) => (j === i ? v : x));
            const media = Math.round(next.reduce((a, b) => a + (b || 0), 0) / 12);
            return { ...s, revenue: { ...s.revenue, pmpMensal: next, pmp: media } };
          })
        }
        onAllMonths={(v) =>
          update((s) => ({
            ...s,
            revenue: { ...s.revenue, pmpMensal: fill12(v), pmp: v },
          }))
        }
        onFixed={(fixed) =>
          update((s) => {
            const base = s.revenue.pmpMensal ?? fill12(s.revenue.pmp || 0);
            if (fixed) {
              const ref = base.find((x) => x !== 0) ?? base[0] ?? 0;
              return { ...s, revenue: { ...s.revenue, pmpFixo: true, pmpMensal: fill12(ref), pmp: ref } };
            }
            return { ...s, revenue: { ...s.revenue, pmpFixo: false } };
          })
        }
      />
    </div>
  );
}


function SectionBlock({
  title,
  hint,
  accentClass,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  accentClass: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border/60 border-l-4 bg-card/40 ${accentClass}`}>
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint={hint}>{title}</SectionTitle>
        <Button size="sm" variant="outline" onClick={onAdd} className="h-7 text-xs">
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar linha
        </Button>
      </div>
      <div className="space-y-4 p-2">{children}</div>
    </div>
  );
}




function CostTable({
  lines,
  receitaBrutaAnual,
  regime,
  onMonth,
  onAllMonths,
  onFixed,
  onLabel,
  onRemove,
}: {
  lines: CostLine[];
  receitaBrutaAnual: number;
  regime?: TaxRegime;
  onMonth: (id: string, i: number, v: number) => void;
  onAllMonths: (id: string, v: number) => void;
  onFixed: (id: string, fixed: boolean) => void;
  onLabel: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}) {

  if (lines.length === 0) {
    return <div className="px-4 py-3 text-xs text-muted-foreground">Nenhuma rubrica nesta categoria. Use “+ Adicionar linha”.</div>;
  }
  return (
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
          {lines.map((c) => {
            const vals = monthValues(c, regime);
            const anual = sum(vals);
            const pct = receitaBrutaAnual > 0 ? anual / receitaBrutaAnual : 0;
            return (
              <tr key={c.id} className="border-t border-border/40 align-middle">
                <td className="px-3 py-2">
                  {c.custom ? (
                    <input
                      value={c.label}
                      onChange={(e) => onLabel(c.id, e.target.value)}
                      className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  ) : (
                    <span className="text-xs">{c.label}</span>
                  )}
                </td>

                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>Fixo</span>
                    <Switch checked={!c.fixed} onCheckedChange={(v) => onFixed(c.id, !v)} />
                    <span>Mensal</span>
                  </div>
                </td>
                {c.fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">Valor aplicado em todos os meses:</span>
                      <div className="w-36">
                        <MoneyInput
                          value={fixedCostBase(c.values)}
                          onChange={(n) => onAllMonths(c.id, n)}
                        />
                      </div>
                    </div>
                  </td>
                ) : (
                  c.values.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput value={v} onChange={(n) => onMonth(c.id, i, n)} />
                    </td>
                  ))
                )}

                <td className="num px-3 py-2 text-right text-neg">{fmtBRL(anual)}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">{fmtPct(pct)}</td>
                <td className="px-1 py-2 text-center">
                  {c.custom && (
                    <button
                      onClick={() => onRemove(c.id)}
                      title="Remover linha"
                      className="text-muted-foreground transition hover:text-neg"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

