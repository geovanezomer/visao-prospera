import { useEffect, useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { fmtBRL } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { KE_DEFAULT_BY_SECTOR } from "@/engines/finance/indicators";


import { BalanceSheetCard } from "@/components/sim/capital/BalanceSheetCard";
import { AberturaCard } from "@/components/sim/capital/AberturaCard";

import { CapexAtivacaoSection } from "@/components/sim/capital/CapexAtivacaoSection";


import { DebtContractsCard } from "@/components/sim/capital/DebtContractsCard";
import {
  aggregateContracts,
  DEBT_CONTRACTS_COST_ID,
} from "@/engines/finance/debtContracts";
import type { CostLine, DebtContract } from "@/engines/finance/types";
import { StatCard } from "@/components/sim/shared/primitives";
import { leverageDisplay } from "@/components/sim/shared/leverageLabel";



const EMPTY_CONTRACTS: DebtContract[] = [];

// Orquestrador da aba Capital — apenas compõe os sub-cartões e cuida das
// validações cruzadas (balanço, alavancagem). Toda a UI específica vive
// em src/components/sim/capital/*.tsx.
export function CapitalTab() {
  const { state, update } = useFinance();
  const c = state.capital;
  // SSOT: usa `useFinanceModel` (resolveEffectiveRegime + memo central) — mesma
  // fonte da aba Indicadores. Garante que WACC/ROIC/margens nunca divirjam.
  const { ind } = useFinanceModel(state);

  const set = (patch: Partial<typeof c>) =>

    update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  // Sincroniza Contratos de Dívida → dividaOnerosa, cashflow.amortizacoes
  // e linha sintética de custo financeiro (juros). Mantém os demais
  // indicadores (DSCR, ROIC, WACC, cobertura) automaticamente coerentes.
  const contracts = useMemo(() => c.debtContracts ?? EMPTY_CONTRACTS, [c.debtContracts]);
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
    // kd derivado: média ponderada das taxas dos contratos (saldo como peso).
    const totalSaldo = contracts.reduce((s, x) => s + Math.max(0, x.saldoDevedor || 0), 0);
    const kdDerivado =
      totalSaldo > 0
        ? contracts.reduce((s, x) => s + Math.max(0, x.saldoDevedor || 0) * (x.taxaAA || 0), 0) /
          totalSaldo
        : 0;
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
        capital: {
          ...s.capital,
          dividaOnerosa: Math.round(agg.saldoTotal),
          kd: kdDerivado > 0 ? Number(kdDerivado.toFixed(2)) : s.capital.kd,
        },
        cashflow: { ...s.cashflow, amortizacoes: agg.amort },
        costs: [...otherCosts, synthetic],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts]);

  // ke padrão por setor (benchmark PME BR — Selic + prêmio de risco). SSOT em
  // `engines/finance/indicators.ts`. O usuário pode sobrescrever via Análise/Valuation.
  useEffect(() => {
    const keAlvo = KE_DEFAULT_BY_SECTOR[state.businessType] ?? 18;
    if (!c.ke || c.ke <= 0) {
      update((s) => ({ ...s, capital: { ...s.capital, ke: keAlvo } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.businessType]);


  const wacc = ind.wacc;
  // Proporção real (PL ÷ PL+D) vem do motor — `ind.proprioPercent`.
  const proprioDerivado = ind.proprioPercent;
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
  if (ind.dividaPlBruto > 5) {
    warnings.push(
      `Endividamento muito elevado: D/PL = ${ind.dividaPlBruto.toFixed(1)}× (saudável ≤ 2×). Risco financeiro relevante.`,
    );
  }
  if (c.ativoCirculante > 0 && c.ativoTotal > 0 && c.ativoCirculante > c.ativoTotal) {
    warnings.push(
      `Ativo Circulante (${fmtBRL(c.ativoCirculante)}) maior que Ativo Total — confira os valores.`,
    );
  }

  // KPIs do topo — visão rápida da estrutura de capital. SSOT: todos os
  // valores vêm de `useFinanceModel` (indicators.ts). NÃO recalcular aqui.
  const servicoDividaMes = ind.servicoDividaMensal;

  // SSOT: Alavancagem Patrimonial vem de `calcIndicators` (dividaLiqPl) — mesma
  // métrica e mesma fórmula da aba Indicadores ("Dívida Líq. / PL").
  const alav = leverageDisplay("pl", ind.dividaLiqPl, ind.dividaLiquida, c.patrimonioLiquido);

  const waccTone: "pos" | "neg" | "default" =
    ind.roic >= wacc ? "pos" : ind.roic > 0 ? "default" : "neg";
  const propTone: "pos" | "neg" | "default" =
    proprioDerivado >= 50 ? "pos" : proprioDerivado >= 30 ? "default" : "neg";

  const kpis: Array<{
    label: string;
    value: string;
    hint: { description: string; formula: string };
    tone: "pos" | "neg" | "default" | "warn";
  }> = [
    {
      label: "Capital Próprio",
      value: `${proprioDerivado.toFixed(1)}%`,
      hint: {
        description: "Participação do PL no financiamento total da empresa.",
        formula: "PL ÷ (PL + Dívida Onerosa) × 100",
      },
      tone: propTone,
    },
    {
      label: "Serviço da Dívida / mês",
      value: fmtBRL(servicoDividaMes),
      hint: {
        description:
          "Saída mensal média com juros e amortização do principal. Anualização proporcional à janela preenchida (mesma da engine).",
        formula: "(Juros Anuais + Amortizações Anuais) ÷ 12",
      },
      tone: "default",
    },
    {
      label: "Alavancagem Patrimonial",
      value: alav.value,
      hint: {
        description:
          "Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio.",
        formula: "(Dívida Total − Caixa) ÷ Patrimônio Líquido",
      },
      tone: alav.tone,
    },
    {
      label: "WACC",
      value: `${wacc.toFixed(2)}%`,
      hint: {
        description:
          "Custo Médio Ponderado de Capital. É o retorno mínimo que a empresa precisa entregar para remunerar sócios e credores. Funciona como 'meta' do ROIC.",
        formula: "(E/V × Ke) + (D/V × Kd × (1 − IR))",
      },
      tone: waccTone,
    },
    {
      // CFO #3 — DSCR é a métrica que o banco olha primeiro em PME alavancada.
      // ≥1.25 saudável · 1.0–1.25 apertado · <1.0 inadimplência potencial.
      label: "DSCR",
      value: ind.dscr >= 99 ? "∞" : `${ind.dscr.toFixed(2)}×`,
      hint: {
        description:
          "Debt Service Coverage Ratio — capacidade do EBITDA cobrir o serviço da dívida (juros + amortização do principal). ≥1.25× é saudável; <1.0× sinaliza risco real de inadimplência.",
        formula: "EBITDA Anual ÷ (Juros + Amortizações Anuais)",
      },
      tone:
        ind.dscr >= 1.25 ? "pos" : ind.dscr >= 1.0 ? "default" : "neg",
    },
  ];


  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <StatCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} sub={k.hint.formula} />
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




      <div className="space-y-4">
        <BalanceSheetCard
          capital={c}
          onChange={set}
          debtContractsSlot={
            <DebtContractsCard
              contracts={contracts}
              onChange={(next) => set({ debtContracts: next })}
            />
          }
          capexSlot={
            <CapexAtivacaoSection
              items={c.capexAtivacao ?? []}
              onChange={(next) => set({ capexAtivacao: next })}
            />
          }
        />
        <AberturaCard capital={c} onChange={set} />
      </div>
    </div>
  );
}
