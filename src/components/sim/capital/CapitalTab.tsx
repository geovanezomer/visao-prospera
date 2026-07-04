import { useEffect, useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { fmtBRL } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { KE_DEFAULT_BY_SECTOR } from "@/engines/finance/indicators";
import { StatCard } from "@/components/sim/shared/primitives";


import { BalanceSheetCard } from "@/components/sim/capital/BalanceSheetCard";
import { AberturaCard } from "@/components/sim/capital/AberturaCard";

import { CapexAtivacaoSection } from "@/components/sim/capital/CapexAtivacaoSection";


import { DebtContractsCard } from "@/components/sim/capital/DebtContractsCard";
import {
  aggregateContracts,
  DEBT_CONTRACTS_COST_ID,
  totalDividaOnerosa,
} from "@/engines/finance/debtContracts";
import { assertDebtContracts } from "@/engines/finance/debtContracts.validation";
import { toast } from "sonner";
import { deriveAbertura } from "@/engines/finance/aberturaDerivada";
import type { CostLine, DebtContract } from "@/engines/finance/types";



const EMPTY_CONTRACTS: DebtContract[] = [];

// Orquestrador da aba Capital — apenas compõe os sub-cartões e cuida das
// validações cruzadas (balanço, alavancagem). Toda a UI específica vive
// em src/components/sim/capital/*.tsx.
export function CapitalTab() {
  const { state, update } = useFinance();
  const c = state.capital;
  // SSOT: usa `useFinanceModel` (resolveEffectiveRegime + memo central) — mesma
  // fonte da aba Indicadores. Garante que WACC/ROIC/margens nunca divirjam.
  const { ind, model } = useFinanceModel(state);
  const aberturaTotals = useMemo(
    () => deriveAbertura({ state, impostosTotalMensais: model.dre.impostosTotal }).totals,
    [state, model.dre.impostos],
  );

  const set = (patch: Partial<typeof c>) =>

    update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  // Sincroniza Contratos de Dívida → dividaOnerosa, cashflow.amortizacoes
  // e linha sintética de custo financeiro (juros). Mantém os demais
  // indicadores (DSCR, ROIC, WACC, cobertura) automaticamente coerentes.
  const contracts = useMemo(() => c.debtContracts ?? EMPTY_CONTRACTS, [c.debtContracts]);
  useEffect(() => {
    if (contracts.length === 0) {
      // Sem contratos: remove linha sintética de juros e zera amortizações/captações no fluxo.
      update((s) => {
        const hasSynthetic = s.costs.some((x) => x.id === DEBT_CONTRACTS_COST_ID);
        const zeros = new Array(12).fill(0);
        return {
          ...s,
          costs: hasSynthetic ? s.costs.filter((x) => x.id !== DEBT_CONTRACTS_COST_ID) : s.costs,
          cashflow: { ...s.cashflow, amortizacoes: zeros, emprestimosCaptados: zeros },
        };
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
        cashflow: { ...s.cashflow, amortizacoes: agg.amort, emprestimosCaptados: agg.captacao },
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

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Totais de abertura — topo da página, padrão visual igual ao Dashboard */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <StatCard
          label="Ativo abertura"
          value={fmtBRL(aberturaTotals.ativo)}
          tone="pos"
          hint={{
            description:
              "Soma de Caixa + Recebíveis + Estoques + Imobilizado Líquido + Intangível Líquido + Impostos a Recuperar na data de abertura.",
            formula: "Σ Ativos (Circulante + Não-Circulante)",
            calc: `Σ Ativos\n= ${fmtBRL(aberturaTotals.ativo)}`,
          }}
        />
        <StatCard
          label="Passivo abertura"
          value={fmtBRL(aberturaTotals.passivo)}
          tone="neg"
          hint={{
            description:
              "Soma de Fornecedores + Empréstimos CP/LP + Impostos a Pagar + Salários e Encargos na data de abertura.",
            formula: "Σ Passivos (Circulante + Não-Circulante)",
            calc: `Σ Passivos\n= ${fmtBRL(aberturaTotals.passivo)}`,
          }}
        />
        <StatCard
          label="PL abertura"
          value={fmtBRL(aberturaTotals.pl)}
          tone={aberturaTotals.pl >= 0 ? "pos" : "neg"}
          hint={{
            description:
              "Patrimônio Líquido de abertura — Capital Social + Reservas + Lucros/Prejuízos Acumulados. Negativo indica passivo a descoberto.",
            formula: "Capital Social + Reservas + Lucros Acumulados",
            calc: `Ativo − Passivo\n= ${fmtBRL(aberturaTotals.ativo)} − ${fmtBRL(aberturaTotals.passivo)}\n= ${fmtBRL(aberturaTotals.pl)}`,
          }}
        />
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
              onChange={(next) => {
                // Valida antes de persistir; bloqueia salvamento inválido
                // e exibe toast amigável apontando o primeiro erro.
                try {
                  assertDebtContracts(next);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  const firstLine = msg.split("\n").slice(0, 2).join(" ");
                  toast.error("Contrato de dívida inválido", { description: firstLine });
                  return;
                }
                set({ debtContracts: next });
              }}
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
