import { useCallback, useEffect, useMemo, useState } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { AppState, CostCategory, CostLine, TaxRegime } from "@/engines/finance/types";
import { fill12, fmtBRL, fmtPct, MESES, sum, genId } from "@/engines/finance/format";
import { fixedCostBase, monthValues } from "@/engines/finance";
import { DEBT_CONTRACTS_COST_ID } from "@/engines/finance/debtContracts";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { COST_VENDAS_LABEL, COST_VENDAS_TABLE_CONFIG } from "@/engines/finance/types";
import { MoneyInput, SectionTitle, StatCard } from "@/components/sim/shared/primitives";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { PrazoTable } from "@/components/sim/shared/PrazoTable";
import { MonthlyCardList } from "@/components/sim/shared/MonthlyCardList";

type Updater = (p: Partial<AppState> | ((s: AppState) => AppState)) => void;

export function CostsTab() {
  const { state, update } = useFinance();
  const receitaBrutaAnual = useMemo(() => sum(state.revenue.bruta), [state.revenue.bruta]);

  // Aviso inline quando o usuário tenta digitar valor negativo (revertido para 0)
  const [negWarn, setNegWarn] = useState<string | null>(null);
  useEffect(() => {
    if (!negWarn) return;
    const t = setTimeout(() => setNegWarn(null), 4000);
    return () => clearTimeout(t);
  }, [negWarn]);

  // Aceita aliases legados (fixo↔despesa_administrativa, variavel↔despesa_comercial).
  const ALIAS: Partial<Record<CostCategory, CostCategory>> = {
    despesa_administrativa: "fixo",
    fixo: "despesa_administrativa",
    despesa_comercial: "variavel",
    variavel: "despesa_comercial",
  };
  const byCat = (cat: CostCategory) =>
    state.costs.filter(
      (c) => (c.category === cat || c.category === ALIAS[cat]) && !c.system,
    );
  // Linhas system (sócios: pró-labore, INSS patronal) — exibidas somente-leitura
  // dentro de "Despesas Administrativas" para que a tabela some ao total do card.
  const systemAdminLines = state.costs.filter(
    (c) =>
      !!c.system &&
      (c.category === "despesa_administrativa" || c.category === "fixo"),
  );


  const updateLine = (id: string, patch: Partial<CostLine>) =>
    update((s) => ({ ...s, costs: s.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const safeCostValue = (id: string, i: number | null, v: number) => {
    const cur = state.costs.find((c) => c.id === id);
    let safe = Number.isFinite(v) ? v : 0;
    if (!Number.isFinite(v) || v < 0) {
      safe = 0;
      const label = cur?.label ?? "Descrição";
      const suffix = i === null ? "valor fixo" : MESES[i];
      setNegWarn(
        `"${label}" — ${suffix}: valores negativos não são permitidos. Use uma linha dedicada para recuperações/créditos. Revertido para R$ 0.`,
      );
    }
    return safe;
  };

  const setMonth = (id: string, i: number, v: number) => {
    const safe = safeCostValue(id, i, v);
    update((s) => ({
      ...s,
      costs: s.costs.map((c) =>
        c.id === id
          ? {
              ...c,
              values: (c.values.length === 12 ? c.values : fill12(c.values[0] || 0)).map((x, j) =>
                j === i ? safe : x,
              ),
            }
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
        if (!fixed) {
          // Mensal: preserva os valores atuais (não achatar Fixo→Mensal).
          return { ...c, fixed: false, values };
        }
        // Mensal→Fixo: usa o primeiro valor não-zero como referência
        // (fixedCostBase é robusto a séries com meses iniciais zerados).
        const base = fixedCostBase(values);
        return { ...c, fixed: true, values: fill12(base) };
      }),
    }));

  const addLine = (category: CostCategory, subcategory?: string) => {
    const id = genId("c_");
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

  // totais (memoizados — recalcular só quando custos ou regime mudam)
  // Usa o regime EFETIVO (SSOT) — mesmo critério aplicado pelo motor para
  // resolver encargos do Simples, evitando divergência com DRE/Indicadores.
  const effectiveRegime = useMemo(() => resolveEffectiveRegime(state), [state]);
  const { totCV, totFix, totVar, totFin, totCPV, totGeral } = useMemo(() => {
    let cv = 0,
      fix = 0,
      vr = 0,
      fn = 0,
      cpv = 0;
    // Deduplicação (idêntica à do DRE em classifyCosts): quando existe a linha
    // sintética de juros de contratos de dívida (vinda do módulo Capital),
    // ignora linhas MANUAIS cujo label indique juros de empréstimo/contrato/
    // mútuo/sócio, para evitar dupla contagem.
    const LOAN_INTEREST_RE = /juros[^a-z]*(sobre)?[^a-z]*(empr[eé]stimo|contrato|m[uú]tuo|afac|s[óo]cio)/i;
    const hasSyntheticDebt = state.costs.some((c) => c.id === DEBT_CONTRACTS_COST_ID);
    for (const c of state.costs) {
      const v = sum(monthValues(c, effectiveRegime));
      if (c.category === "custo_vendas") {
        cv += v;
        cpv += v;
      } else if (c.category === "direto_venda") {
        cpv += v;
      } else if (c.category === "despesa_administrativa" || c.category === "fixo") fix += v;
      else if (c.category === "despesa_comercial" || c.category === "variavel") vr += v;
      else if (c.category === "financeiro") {
        if (hasSyntheticDebt && c.id !== DEBT_CONTRACTS_COST_ID && LOAN_INTEREST_RE.test(c.label))
          continue;
        fn += v;
      }
    }
    return {
      totCV: cv,
      totFix: fix,
      totVar: vr,
      totFin: fn,
      totCPV: cpv,
      totGeral: cpv + fix + vr + fn,
    };
  }, [state.costs, effectiveRegime]);


  const pctRec = useCallback(
    (v: number) => (receitaBrutaAnual > 0 ? v / receitaBrutaAnual : 0),
    [receitaBrutaAnual],
  );

  // Detecta itens com o MESMO label em GRUPOS DIFERENTES de custo — sinal
  // de lançamento duplicado (ex.: "Insumos / Matéria Prima" em CSP e em
  // Despesas Comerciais ao mesmo tempo). Compara por label normalizado.
  const duplicateLabels = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const map = new Map<string, Set<CostCategory>>();
    for (const c of state.costs) {
      const key = norm(c.label);
      if (!key) continue;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(c.category);
    }
    const dups: { label: string; categories: CostCategory[] }[] = [];
    for (const [key, cats] of map) {
      if (cats.size > 1) {
        const original =
          state.costs.find((c) => norm(c.label) === key)?.label ?? key;
        dups.push({ label: original, categories: Array.from(cats) });
      }
    }
    return dups;
  }, [state.costs]);

  return (
    <div className="space-y-6">
      {negWarn && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-foreground/90">{negWarn}</span>
        </div>
      )}
      {duplicateLabels.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1 text-foreground/90">
            {duplicateLabels.map((d) => (
              <div key={d.label}>
                ⚠️ O item <strong>"{d.label}"</strong> aparece em mais de um grupo de custo. Verifique se não há lançamento duplicado.
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Sumário */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label={COST_VENDAS_LABEL[state.businessType].short}
          value={fmtBRL(totCPV)}
          tone="neg"
          sub={fmtPct(pctRec(totCPV)) + " da receita"}
          hint={{
            description: COST_VENDAS_LABEL[state.businessType].long,
            formula: "Σ CPV/CMV/CSP dos 12 meses",
          }}
        />
        <StatCard
          label="Despesas Administrativas"
          value={fmtBRL(totFix)}
          tone="neg"
          sub={fmtPct(pctRec(totFix)) + " da receita"}
          hint={{
            description:
              "Despesas de estrutura que não variam com o volume vendido (aluguel, pró-labore, contabilidade, salários administrativos).",
            formula: "Σ Despesas Administrativas dos 12 meses",
          }}
        />
        <StatCard
          label="Despesas Comerciais"
          value={fmtBRL(totVar)}
          tone="neg"
          sub={fmtPct(pctRec(totVar)) + " da receita"}
          hint={{
            description:
              "Despesas que variam proporcionalmente às vendas (comissões, marketing, frete sobre vendas, royalties).",
            formula: "Σ Despesas Comerciais dos 12 meses",
          }}
        />
        <StatCard
          label="Despesas Financeiras"
          value={fmtBRL(totFin)}
          tone="neg"
          sub={fmtPct(pctRec(totFin)) + " da receita"}
          hint={{
            description:
              "Juros, IOF, antecipação de recebíveis, tarifas bancárias e taxas de maquininha.",
            formula: "Σ Despesas Financeiras dos 12 meses",
          }}
        />
        <StatCard
          label="Total de Custos e Despesas"
          value={fmtBRL(totGeral)}
          tone="neg"
          sub={fmtPct(pctRec(totGeral)) + " da receita"}
          hint={{
            description:
              "Soma de todos os custos e despesas. Quanto menor o % sobre a receita, mais saudável é a operação.",
            formula: "CPV/CMV/CSP + Desp. Administrativas + Desp. Comerciais + Desp. Financeiras",
          }}
        />
      </div>

      {/* Custos Diretos de Venda (CMV/CPV/CSP) */}
      <SectionBlock
        title={COST_VENDAS_LABEL[state.businessType].long}
        hint={`Custos diretamente ligados à ${state.businessType === "servicos" ? "prestação do serviço" : "produção ou revenda"}.`}
        accentClass="border-l-primary"
        onAdd={() => addLine("direto_venda")}
      >
        <CostTable
          lines={[...byCat("custo_vendas"), ...byCat("direto_venda")]}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={effectiveRegime}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Custos Fixos */}
      <SectionBlock
        title="Despesas Administrativas"
        hint="Não variam com o volume vendido. Compõem a estrutura mínima de operação."
        accentClass="border-l-[color:var(--warning)]"
        onAdd={() => addLine("despesa_administrativa")}
      >
        {state.socios?.some((s) => (s.prolaboreMensal ?? 0) > 0) && (

          <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-muted-foreground">
            <strong className="text-foreground">Pró-labore</strong> e{" "}
            <strong className="text-foreground">INSS Patronal</strong> dos sócios são geridos em{" "}
            <em>Configurações → Sócios / Pró-labore</em>. Os valores entram automaticamente
            no DRE, Balanço e Fluxo de Caixa.
          </div>
        )}

        <CostTable
          lines={[...byCat("fixo"), ...systemAdminLines]}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={effectiveRegime}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Custos Variáveis */}
      <SectionBlock
        title="Despesas Comerciais"
        hint="Variam proporcionalmente às vendas — comissões, marketing, frete sobre vendas etc."
        accentClass="border-l-[#5BA8F5]"
        onAdd={() => addLine("despesa_comercial")}
      >
        <CostTable
          lines={byCat("variavel")}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={effectiveRegime}
          onMonth={setMonth}
          onAllMonths={setAllMonths}
          onFixed={setFixed}
          onLabel={setLabel}
          onRemove={removeLine}
        />
      </SectionBlock>

      {/* Despesas Financeiras */}
      <SectionBlock
        title="Despesas Financeiras"
        hint="Juros, IOF, tarifas bancárias e antecipação de recebíveis."
        accentClass="border-l-neg"
        onAdd={() => addLine("financeiro")}
      >
        <CostTable
          lines={byCat("financeiro")}
          receitaBrutaAnual={receitaBrutaAnual}
          regime={effectiveRegime}
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
              return {
                ...s,
                revenue: { ...s.revenue, pmpFixo: true, pmpMensal: fill12(ref), pmp: ref },
              };
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
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Nenhuma rubrica nesta categoria. Use “+ Adicionar linha”.
      </div>
    );
  }
  return (
    <>
      <MonthlyCardList
        rows={lines.map((c) => {
          const vals = monthValues(c, regime);
          return {
            id: c.id,
            label: c.label,
            unit: "brl",
            values: c.values.length === 12 ? c.values : fill12(c.values[0] || 0),
            brlValues: vals,
            fixed: c.fixed,
            tone: "neg",
            editableLabel: !!c.custom,
            removable: !!c.custom,
            readOnly: !!c.system,
            readOnlyHint: c.system
              ? "Gerido em Configurações → Sócios / Pró-labore"
              : undefined,
          };
        })}
        receitaAnual={receitaBrutaAnual}
        onMonth={onMonth}
        onAllMonths={onAllMonths}
        onFixed={onFixed}
        onLabel={onLabel}
        onRemove={onRemove}
      />
    <div className="scrollbar-thin hidden md:block w-full overflow-x-auto overflow-y-hidden">
      <table className="w-full min-w-[900px] text-[clamp(0.75rem,1vw+0.5rem,0.875rem)] md:min-w-[1200px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="w-56 px-3 py-2">Descrição</th>
            <th className="w-24 px-2 py-2 text-center">Modo</th>
            {MESES.map((m) => (
              <th key={m} className="px-1 py-2 text-right">
                {m}
              </th>
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
              <tr key={c.id} className={`border-t border-border/40 align-middle ${c.system ? "bg-muted/20" : ""}`}>
                <td className="px-3 py-2">
                  {c.custom ? (
                    <input
                      value={c.label}
                      onChange={(e) => onLabel(c.id, e.target.value)}
                      className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                  ) : (
                    <span className="text-xs">
                      {c.label}
                      {c.system && (
                        <span
                          className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary"
                          title="Gerido em Configurações → Sócios / Pró-labore"
                        >
                          Auto
                        </span>
                      )}
                    </span>
                  )}
                </td>

                <td className="px-2 py-2">
                  {c.system ? (
                    <div className="text-center text-[10px] italic text-muted-foreground">
                      —
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>Fixo</span>
                      <Switch checked={!c.fixed} onCheckedChange={(v) => onFixed(c.id, !v)} />
                      <span>Mensal</span>
                    </div>
                  )}
                </td>
                {c.fixed ? (
                  <td className="px-1 py-1" colSpan={12}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {c.system
                          ? "Valor mensal (gerido em Configurações → Sócios):"
                          : "Valor aplicado em todos os meses:"}
                      </span>
                      <div className="w-36">
                        <MoneyInput
                          value={fixedCostBase(c.values)}
                          onChange={(n) => onAllMonths(c.id, n)}
                          readOnly={!!c.system}
                        />
                      </div>
                    </div>
                  </td>
                ) : (
                  c.values.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <MoneyInput
                        value={v}
                        onChange={(n) => onMonth(c.id, i, n)}
                        readOnly={!!c.system}
                      />
                    </td>
                  ))
                )}

                <td className="num px-3 py-2 text-right text-neg">{fmtBRL(anual)}</td>
                <td className="num px-2 py-2 text-right text-xs text-muted-foreground">
                  {fmtPct(pct)}
                </td>
                <td className="px-1 py-2 text-center">
                  {c.custom && !c.system && (
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
    </>
  );
}
