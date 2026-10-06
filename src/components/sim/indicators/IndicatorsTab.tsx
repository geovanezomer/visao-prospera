import { useFinanceState } from "@/engines/finance/AppStateContext";
import { fmtBRL, fmtPct } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { buildIndicatorCalcs } from "@/engines/finance/indicatorCalc";
import { HelpTip, StatCard } from "@/components/sim/shared/primitives";
import { TrendingUp, TrendingDown } from "lucide-react";
import { IndicatorsGrid } from "./IndicatorsGrid";
import { WaccRoicMeter } from "@/components/sim/capital/WaccRoicMeter";
import { KanitzCard } from "@/components/sim/shared/KanitzCard";

// Tooltip style (mantido para CashConversionSmall e outros consumidores futuros)

export function IndicatorsTab() {
  const state = useFinanceState();
  const { dre, ind, cagrReceitas12m } = useFinanceModel(state);
  const c = buildIndicatorCalcs(state, dre, ind, cagrReceitas12m);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Ciclo Financeiro"
          value={`${(ind.cicloFinanceiro ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`}
          hint={{
            description:
              "Dias entre pagar fornecedores e receber dos clientes. Quanto MAIOR, mais capital de giro a empresa precisa imobilizar.",
            formula: "PMR + PME − PMP",
            calc: c.cicloFinanceiro,
          }}
          sub={
            ind.cicloFinanceiro > 60
              ? "Ciclo longo — pressiona o caixa"
              : ind.cicloFinanceiro > 30
                ? "Ciclo moderado"
                : "Ciclo curto — bom para o caixa"
          }
        />
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm ring-1 ring-primary/10">
          <div className="flex items-center justify-between gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            <span>Necessidade de Capital de Giro (NCG)</span>
            <HelpTip
              text="Dinheiro consumido pela operação (defasagem entre receber dos clientes e pagar fornecedores/estoque). O Gap de Capital de Giro compara a NCG com o Capital de Giro (CDG = recursos de longo prazo aplicados no curto prazo): se o CDG cobre a NCG, sobra caixa; se não cobre, falta — e o déficit precisa ser financiado por dívida onerosa ou atraso a fornecedores."
              formula="NCG = Contas a Receber + Estoques − Fornecedores  •  Gap = NCG − CDG"
              calc={c.ncg}
            />
          </div>
          <div className="mono mt-2 text-2xl font-bold text-foreground">{fmtBRL(ind.ncg)}</div>
          <div
            className={`mt-1 text-[11px] font-medium ${ind.gapCapitalGiro > 0 ? "text-neg" : "text-pos"}`}
          >
            {ind.gapCapitalGiro > 0
              ? `Falta ${fmtBRL(ind.gapCapitalGiro)} (gap de capital)`
              : `Sobra ${fmtBRL(Math.abs(ind.gapCapitalGiro))} (CDG cobre a NCG)`}
          </div>
        </div>
        <StatCard
          label="EVA (Lucro Econômico)"
          value={fmtBRL(ind.eva)}
          tone={ind.eva >= 0 ? "pos" : "neg"}
          sub={ind.eva >= 0 ? "Gerando Valor" : "Destruindo Valor"}
          hint={{
            description:
              "Economic Value Added — lucro que sobra DEPOIS de remunerar todo o capital (próprio + terceiros) ao custo do WACC.",
            formula: "(ROIC − WACC) × Capital Investido",
            calc: c.eva,
          }}
        />

        <CashConversionSmall conversao={ind.conversaoEbitdaCaixa} calc={c.conversaoEbitdaCaixa} />
      </div>

      <IndicatorsGrid state={state} />

      {/* Termômetros (vieram do Dashboard, que ficou só com o essencial). */}
      <WaccRoicMeter wacc={ind.wacc} roic={ind.roic} />
      <KanitzCard />
    </div>
  );
}

// `Ind` foi extraído para IndicatorsGrid.tsx (SSOT visual dos indicadores).

// (I2) Consome ind.conversaoEbitdaCaixa — não recalcula localmente.
function CashConversionSmall({ conversao, calc }: { conversao: number; calc?: string }) {
  const conversaoEbitda = conversao;
  const tone = conversaoEbitda >= 70 ? "pos" : conversaoEbitda >= 40 ? "default" : "neg";

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Conversão de Caixa</span>
        <HelpTip
          text="Mede quanto do EBITDA efetivamente vira caixa livre (FCF)."
          formula="FCF ÷ EBITDA × 100"
          calc={calc}
        />
      </div>
      <div
        className={`mono mt-2 text-2xl font-bold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-foreground"}`}
      >
        {fmtPct(conversaoEbitda / 100)}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        {conversaoEbitda >= 70 ? (
          <TrendingUp className="h-3 w-3 text-pos" />
        ) : (
          <TrendingDown className="h-3 w-3 text-neg" />
        )}
        EBITDA → Caixa
      </div>
    </div>
  );
}
