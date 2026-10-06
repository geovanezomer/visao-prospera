// ============================================================================
// Dashboard — o essencial primeiro: "o que fazer agora" e os números-chave. Os
// gráficos (recharts, o pedaço mais pesado) carregam logo em seguida, sem
// atrasar a primeira leitura no celular.
// ============================================================================
import { lazy, Suspense } from "react";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { DSCR_THRESHOLDS } from "@/engines/finance/indicators";
import { fmtBRL, fmtPct } from "@/engines/finance/format";
import { StatCard } from "@/components/sim/shared/primitives";
import { buildIndicatorCalcs } from "@/engines/finance/indicatorCalc";
import { ProximosPassos } from "./ProximosPassos";
import { leverageDisplay } from "@/components/sim/shared/leverageLabel";

const DashboardCharts = lazy(() =>
  import("./DashboardCharts").then((m) => ({ default: m.DashboardCharts })),
);

export function DashboardTab() {
  const state = useFinanceState();
  const { dre, ind, cagrReceitas12m } = useFinanceModel(state);
  const c = buildIndicatorCalcs(state, dre, ind, cagrReceitas12m);
  const alav = leverageDisplay(
    "pl",
    ind.dividaLiqPl,
    ind.dividaLiquida,
    state.capital.patrimonioLiquido,
  );

  return (
    <div className="space-y-6">
      {/* Situação em uma frase + até 3 ações: a primeira coisa que o dono lê. */}
      <ProximosPassos state={state} />

      {/* Linha 1 — Cards numéricos resumo (com tooltips, base unificada `useFinanceModel`) */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Receita Líquida (12m)"
          value={fmtBRL(ind.receitaLiquidaAnual)}
          tone="pos"
          sub="Últimos 12 meses"
          hint={{
            description:
              "Receita bruta dos últimos 12 meses descontados impostos sobre vendas, devoluções e abatimentos.",
            formula: "Receita Bruta − Impostos sobre Vendas − Devoluções",
            calc: c.receitaLiquida12m,
          }}
        />
        <StatCard
          label="EBITDA (12m)"
          value={fmtBRL(ind.ebitdaAnual)}
          tone={ind.ebitdaAnual >= 0 ? "pos" : "neg"}
          sub={
            ind.receitaLiquidaAnual > 0
              ? fmtPct(ind.ebitdaAnual / ind.receitaLiquidaAnual) + " da receita"
              : "—"
          }
          hint={{
            description:
              "Lucro operacional antes de juros, impostos, depreciação e amortização. Mede a geração operacional de caixa.",
            formula: "Lucro Operacional + Depreciação + Amortização",
            calc: c.ebitda12m,
          }}
        />
        <StatCard
          label="Lucro Líquido (12m)"
          value={fmtBRL(ind.lucroLiquidoAnual)}
          tone={ind.lucroLiquidoAnual >= 0 ? "pos" : "neg"}
          sub={
            ind.receitaLiquidaAnual > 0
              ? fmtPct(ind.lucroLiquidoAnual / ind.receitaLiquidaAnual) + " da receita"
              : "—"
          }
          hint={{
            description: "Resultado final do exercício após todas as despesas, juros e impostos.",
            formula: "Receita Líquida − Custos − Despesas − Juros − IRPJ/CSLL",
            calc: c.lucroLiquido12m,
          }}
        />
        <StatCard
          label="Alavancagem Patrimonial"
          value={
            ind.dividaLiquida < 0
              ? "Caixa > Dívida"
              : ind.dividaLiquida > 0
                ? "Caixa < Dívida"
                : "Sem dívida líquida"
          }
          tone={ind.dividaLiquida < 0 ? "pos" : ind.dividaLiquida > 0 ? "neg" : undefined}
          sub={alav.value}
          hint={{
            description:
              "Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio. Quando o caixa supera a dívida onerosa, a Dívida Líquida é negativa (posição cash-rich).",
            formula: "(Dívida Total − Caixa) ÷ Patrimônio Líquido",
            calc: c.dividaLiqPl,
          }}
        />
        <StatCard
          label="DSCR"
          value={ind.dscr == null ? "N/A" : ind.dscr >= 99 ? "∞" : `${ind.dscr.toFixed(2)}×`}
          tone={
            ind.dscr == null
              ? "default"
              : ind.dscr >= DSCR_THRESHOLDS.warn
                ? "pos"
                : ind.dscr >= DSCR_THRESHOLDS.danger
                  ? "default"
                  : "neg"
          }
          sub={ind.dscr == null ? "Sem dívida a servir" : "EBITDA ÷ Serviço da Dívida"}
          hint={{
            description:
              ind.dscr == null
                ? "N/A — a empresa não tem dívida onerosa (contratos + amortizações). O indicador não se aplica."
                : "Debt Service Coverage Ratio — capacidade do EBITDA cobrir o serviço da dívida (juros de contratos + amortização do principal). ≥1.25× é saudável; <1.0× sinaliza risco real de inadimplência.",
            formula: "EBITDA Anual ÷ (Juros de contratos + Amortizações Anuais)",
            calc: c.dscr,
          }}
        />
      </div>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-muted/30" />}>
        <DashboardCharts />
      </Suspense>
    </div>
  );
}
