import { useEffect, useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { fmtBRL, sum } from "@/engines/finance/format";
import { buildDRE, calcIndicators } from "@/engines/finance";

import { BalanceSheetCard } from "@/components/sim/capital/BalanceSheetCard";

import { CapexAtivacaoSection } from "@/components/sim/capital/CapexAtivacaoSection";
import { WaccRoicMeter } from "@/components/sim/capital/WaccRoicMeter";

import { DebtContractsCard } from "@/components/sim/capital/DebtContractsCard";
import {
  aggregateContracts,
  DEBT_CONTRACTS_COST_ID,
} from "@/engines/finance/debtContracts";
import type { CostLine, DebtContract } from "@/engines/finance/types";
import { StatCard } from "@/components/sim/shared/primitives";


const EMPTY_CONTRACTS: DebtContract[] = [];

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

  // ke padrão por setor (benchmark PME BR — Selic + prêmio de risco). O usuário
  // pode sobrescrever via Análise/Valuation se quiser refinar.
  const keDefaultPorSetor: Record<string, number> = {
    servicos: 18,
    comercio: 17,
    industria: 16,
  };
  useEffect(() => {
    const keAlvo = keDefaultPorSetor[state.businessType] ?? 18;
    if (!c.ke || c.ke <= 0) {
      update((s) => ({ ...s, capital: { ...s.capital, ke: keAlvo } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.businessType]);


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
  // SSOT: WACC e ROIC vêm de `calcIndicators` (indicators.ts) — já em PERCENTUAL
  // (ex.: 15 = 15%). NÃO multiplicar por 100 aqui; isso causava "WACC absurdo".
  const jurosAnual = sum(dre.custosFinanceirosTotal);
  const amortAnual = sum(state.cashflow.amortizacoes ?? []);
  const servicoDividaMes = (jurosAnual + amortAnual) / 12;
  const dPL = c.patrimonioLiquido > 0 ? c.dividaOnerosa / c.patrimonioLiquido : 0;

  const waccTone: "pos" | "neg" | "default" =
    ind.roic >= wacc ? "pos" : ind.roic > 0 ? "default" : "neg";
  const dplTone: "pos" | "neg" | "default" =
    c.patrimonioLiquido <= 0 ? "neg" : dPL <= 2 ? "pos" : dPL <= 4 ? "default" : "neg";
  const propTone: "pos" | "neg" | "default" =
    proprioDerivado >= 50 ? "pos" : proprioDerivado >= 30 ? "default" : "neg";

  const kpis: Array<{
    label: string;
    value: string;
    hint: { description: string; formula: string };
    tone: "pos" | "neg" | "default";
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
        description: "Saída mensal média com juros e amortização dos contratos.",
        formula: "(Juros anuais + Amortizações anuais) ÷ 12",
      },
      tone: "default",
    },
    {
      label: "D / PL",
      value: c.patrimonioLiquido > 0 ? `${dPL.toFixed(2)}×` : "—",
      hint: {
        description: "Alavancagem patrimonial. Saudável ≤ 2× para PMEs.",
        formula: "Dívida Onerosa ÷ Patrimônio Líquido",
      },
      tone: dplTone,
    },
    {
      label: "WACC",
      value: `${wacc.toFixed(2)}%`,
      hint: {
        description: "Custo médio ponderado do capital (próprio + terceiros, líquido de IR).",
        formula: "wE × Ke + wD × Kd × (1 − t)",
      },
      tone: waccTone,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
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
        <WaccRoicMeter wacc={wacc} roic={ind.roic} />
      </div>
    </div>
  );
}
