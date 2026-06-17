import { useMemo } from "react";
import { useFinance } from "@/engines/finance/AppStateContext";
import { fmtBRL, sum } from "@/engines/finance/format";
import { buildDRE, calcIndicators } from "@/engines/finance/calculations";
import { MoneyInput, HelpTip } from "./primitives";


import { IntroCard } from "./capital/IntroCard";
import { CapitalStructureCard } from "./capital/CapitalStructureCard";
import { BalanceSheetCard } from "./capital/BalanceSheetCard";
import { AdvancedRefinementCard } from "./capital/AdvancedRefinementCard";
import { CapexAtivacaoSection } from "./capital/CapexAtivacaoSection";
import { WaccRoicMeter } from "./capital/WaccRoicMeter";
import { NCGExplanationCard } from "./capital/NCGExplanationCard";

// Orquestrador da aba Capital — apenas compõe os sub-cartões e cuida das
// validações cruzadas (balanço, alavancagem). Toda a UI específica vive
// em src/components/sim/capital/*.tsx.
export function CapitalTab() {
  const { state, update } = useFinance();
  const c = state.capital;
  // Memoiza engine pesada — recomputa só quando o estado financeiro muda.
  const { dre } = useMemo(() => buildDRE(state, state.tax.regime), [state]);
  const ind = useMemo(() => calcIndicators(state, dre), [state, dre]);

  const set = (patch: Partial<typeof c>) => update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  const wacc = ind.wacc;
  // Quando PL e Dívida estão preenchidos, a proporção real é PL/(PL+D) — o slider
  // vira leitura derivada para evitar contradição visual entre % e R$.
  const totalFinancAbs = Math.max(0, c.patrimonioLiquido) + Math.max(0, c.dividaOnerosa);
  const proprioDerivado = totalFinancAbs > 0
    ? (Math.max(0, c.patrimonioLiquido) / totalFinancAbs) * 100
    : c.proprio;
  const terceiros = 100 - proprioDerivado;

  // Validações de inconsistência patrimonial.
  const warnings: string[] = [];
  if (c.dividaOnerosa > c.ativoTotal && c.ativoTotal > 0) {
    warnings.push(`Dívida onerosa (${fmtBRL(c.dividaOnerosa)}) maior que o Ativo Total (${fmtBRL(c.ativoTotal)}) — situação de insolvência técnica. WACC e ROIC perdem significado neste cenário.`);
  }
  if (c.patrimonioLiquido < 0) {
    warnings.push(`Patrimônio Líquido negativo (${fmtBRL(c.patrimonioLiquido)}) — passivo a descoberto. Reveja o balanço antes de interpretar ROE/ROIC.`);
  }
  if (c.patrimonioLiquido > 0 && c.dividaOnerosa / c.patrimonioLiquido > 5) {
    warnings.push(`Endividamento muito elevado: D/PL = ${(c.dividaOnerosa / c.patrimonioLiquido).toFixed(1)}× (saudável ≤ 2×). Risco financeiro relevante.`);
  }
  if (c.ativoCirculante > 0 && c.ativoTotal > 0 && c.ativoCirculante > c.ativoTotal) {
    warnings.push(`Ativo Circulante (${fmtBRL(c.ativoCirculante)}) maior que Ativo Total — confira os valores.`);
  }

  return (
    <div className="space-y-6">
      <IntroCard />

      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-warning">⚠ Inconsistências patrimoniais detectadas</div>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Capital de Giro Disponível
            <HelpTip text="Recursos próprios que a empresa tem disponíveis para financiar o ciclo operacional (capital permanente menos ativo permanente)." formula="(PL + Exigível a LP) − Ativo Permanente" />
          </div>
          <MoneyInput value={c.capitalGiroDisponivel} onChange={(n) => set({ capitalGiroDisponivel: n })} className="mt-2 text-lg" />
          <div className="mt-1 text-[10px] text-muted-foreground">Qual é a disponibilidade de dinheiro imediata da empresa para giro, somando caixa e bancos</div>
        </div>
        <div className="md:col-span-3">
          <NCGExplanationCard ncg={ind.ncg} pmr={state.revenue.pmr} pmp={state.revenue.pmp} receitaDia={sum(dre.receitaBruta)/360} cpvDia={sum(dre.cpv)/360} />
        </div>
      </div>

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
