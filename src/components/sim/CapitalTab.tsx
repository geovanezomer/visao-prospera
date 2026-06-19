import { useEffect, useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { fmtBRL, sum } from "@/engines/finance/format";
import { buildDRE, calcIndicators } from "@/engines/finance";

import { CapitalStructureCard } from "./capital/CapitalStructureCard";
import { BalanceSheetCard } from "./capital/BalanceSheetCard";
import { AdvancedRefinementCard } from "./capital/AdvancedRefinementCard";
import { CapexAtivacaoSection } from "./capital/CapexAtivacaoSection";
import { WaccRoicMeter } from "./capital/WaccRoicMeter";
import { NCGExplanationCard } from "./capital/NCGExplanationCard";
import { DebtContractsCard } from "./capital/DebtContractsCard";
import {
  aggregateContracts,
  DEBT_CONTRACTS_COST_ID,
} from "@/engines/finance/debtContracts";
import type { CostLine } from "@/engines/finance/types";

// Orquestrador da aba Capital — apenas compõe os sub-cartões e cuida das
// validações cruzadas (balanço, alavancagem). Toda a UI específica vive
// em src/components/sim/capital/*.tsx.
export function CapitalTab() {
  const { state, update } = useFinance();
  const c = state.capital;
  // Memoiza engine pesada — recomputa só quando o estado financeiro muda.
  const { dre } = useMemo(() => buildDRE(state, state.tax.regime), [state]);
  const ind = useMemo(() => calcIndicators(state, dre), [state, dre]);

  const set = (patch: Partial<typeof c>) =>
    update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  // Sincroniza Contratos de Dívida → dividaOnerosa, cashflow.amortizacoes
  // e linha sintética de custo financeiro (juros). Mantém os demais
  // indicadores (DSCR, ROIC, WACC, cobertura) automaticamente coerentes.
  const contracts = c.debtContracts ?? [];
  useEffect(() => {
    if (contracts.length === 0) {
      // Remove linha sintética de juros, se existir.
      update((s) => {
        const hasSynthetic = s.costs.some((x) => x.id === DEBT_CONTRACTS_COST_ID);
        if (!hasSynthetic) return s;
        return { ...s, costs: s.costs.filter((x) => x.id !== DEBT_CONTRACTS_COST_ID) };
      });
      return;
    }
    const agg = aggregateContracts(contracts);
    update((s) => {
      // upsert custo financeiro sintético
      const synthetic: CostLine = {
        id: DEBT_CONTRACTS_COST_ID,
        label: "Juros sobre contratos de dívida",
        category: "financeiro",
        values: agg.juros,
        fixed: false,
        custom: true,
      };
      const otherCosts = s.costs.filter((x) => x.id !== DEBT_CONTRACTS_COST_ID);
      return {
        ...s,
        capital: { ...s.capital, dividaOnerosa: Math.round(agg.saldoTotal) },
        cashflow: { ...s.cashflow, amortizacoes: agg.amort },
        costs: [...otherCosts, synthetic],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts]);


  const wacc = ind.wacc;
  // Quando PL e Dívida estão preenchidos, a proporção real é PL/(PL+D) — o slider
  // vira leitura derivada para evitar contradição visual entre % e R$.
  const totalFinancAbs = Math.max(0, c.patrimonioLiquido) + Math.max(0, c.dividaOnerosa);
  const proprioDerivado =
    totalFinancAbs > 0 ? (Math.max(0, c.patrimonioLiquido) / totalFinancAbs) * 100 : c.proprio;
  const terceiros = 100 - proprioDerivado;

  // Validações de inconsistência patrimonial.
  const warnings: string[] = [];
  if (c.dividaOnerosa > c.ativoTotal && c.ativoTotal > 0) {
    warnings.push(
      `Dívida onerosa (${fmtBRL(c.dividaOnerosa)}) maior que o Ativo Total (${fmtBRL(c.ativoTotal)}) — situação de insolvência técnica. WACC e ROIC perdem significado neste cenário.`,
    );
  }
  if (c.patrimonioLiquido < 0) {
    warnings.push(
      `Patrimônio Líquido negativo (${fmtBRL(c.patrimonioLiquido)}) — passivo a descoberto. Reveja o balanço antes de interpretar ROE/ROIC.`,
    );
  }
  if (c.patrimonioLiquido > 0 && c.dividaOnerosa / c.patrimonioLiquido > 5) {
    warnings.push(
      `Endividamento muito elevado: D/PL = ${(c.dividaOnerosa / c.patrimonioLiquido).toFixed(1)}× (saudável ≤ 2×). Risco financeiro relevante.`,
    );
  }
  if (c.ativoCirculante > 0 && c.ativoTotal > 0 && c.ativoCirculante > c.ativoTotal) {
    warnings.push(
      `Ativo Circulante (${fmtBRL(c.ativoCirculante)}) maior que Ativo Total — confira os valores.`,
    );
  }

  // KPIs do topo — visão rápida da estrutura de capital.
  const jurosAnual = sum(dre.custosFinanceirosTotal);
  const amortAnual = sum(state.cashflow.amortizacoes ?? []);
  const servicoDividaMes = (jurosAnual + amortAnual) / 12;
  const dPL = c.patrimonioLiquido > 0 ? c.dividaOnerosa / c.patrimonioLiquido : 0;

  const kpis = [
    { label: "Capital Próprio", value: `${proprioDerivado.toFixed(1)}%`, hint: "PL / (PL + Dívida)" },
    { label: "Dívida Onerosa", value: fmtBRL(c.dividaOnerosa), hint: "Empréstimos e financiamentos" },
    { label: "Serviço da Dívida / mês", value: fmtBRL(servicoDividaMes), hint: "Juros + amortização ÷ 12" },
    {
      label: "D / PL",
      value: c.patrimonioLiquido > 0 ? `${dPL.toFixed(2)}×` : "—",
      hint: "Saudável ≤ 2×",
    },
    { label: "WACC", value: `${(wacc * 100).toFixed(2)}%`, hint: "Custo médio ponderado" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border bg-card p-3 shadow-sm"
          >
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{k.value}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{k.hint}</div>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-warning">
            ⚠ Inconsistências patrimoniais detectadas
          </div>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}


      <NCGExplanationCard
        ncg={ind.ncg}
        pmr={state.revenue.pmr}
        pmp={state.revenue.pmp}
        receitaDia={sum(dre.receitaBruta) / 360}
        cpvDia={sum(dre.cpv) / 360}
      />

      <div className="space-y-4">
        <CapitalStructureCard
          proprio={proprioDerivado}
          terceiros={terceiros}
          ke={c.ke}
          kd={c.kd}
          patrimonioLiquido={c.patrimonioLiquido}
          dividaOnerosa={c.dividaOnerosa}
          derived={totalFinancAbs > 0}
          onChange={set}
        />
        <BalanceSheetCard capital={c} onChange={set} />
        <AdvancedRefinementCard capital={c} onChange={set} />
        <CapexAtivacaoSection
          items={c.capexAtivacao ?? []}
          onChange={(next) => set({ capexAtivacao: next })}
        />
        <WaccRoicMeter wacc={wacc} roic={ind.roic} />
      </div>
    </div>
  );
}
