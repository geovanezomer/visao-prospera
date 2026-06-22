import { useFinanceState } from "@/engines/finance/AppStateContext";
import { fmtBRL, fmtPct } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { HelpTip, StatCard } from "@/components/sim/shared/primitives";
import { TrendingUp, TrendingDown } from "lucide-react";
import { IndicatorsGrid } from "./IndicatorsGrid";

// Tooltip style (mantido para CashConversionSmall e outros consumidores futuros)

export function IndicatorsTab() {
  const state = useFinanceState();
  const { ind } = useFinanceModel(state);



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
              text="Dinheiro consumido pela operação. Reflete a defasagem entre recebimento de clientes e pagamento de fornecedores/estoque."
              formula="Contas a Receber + Estoques − Fornecedores"
            />
          </div>
          <div className="mono mt-2 text-2xl font-bold text-foreground">{fmtBRL(ind.ncg)}</div>
        </div>
        <StatCard
          label="Gap de Capital de Giro"
          value={fmtBRL(ind.gapCapitalGiro)}
          tone={ind.gapCapitalGiro > 0 ? "neg" : "pos"}
          sub={
            ind.gapCapitalGiro > 0
              ? "Falta caixa: negocie prazos, antecipe recebíveis ou capte giro"
              : "Folga: sobra para investir ou amortizar dívidas"
          }
          hint={{
            description:
              "Diferença entre o que a operação precisa (NCG) e o que a empresa tem (CGD). Positivo = precisa de empréstimo de giro; Negativo = sobra caixa.",
            formula: "NCG − CGD",
          }}
        />
        <CashConversionSmall conversao={ind.conversaoEbitdaCaixa} />
      </div>

      <IndicatorsGrid state={state} />

    </div>
  );
}


// `Ind` foi extraído para IndicatorsGrid.tsx (SSOT visual dos indicadores).


// (I2) Consome ind.conversaoEbitdaCaixa — não recalcula localmente.
function CashConversionSmall({ conversao }: { conversao: number }) {
  const conversaoEbitda = conversao;
  const tone = conversaoEbitda >= 70 ? "pos" : conversaoEbitda >= 40 ? "default" : "neg";

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Conversão de Caixa</span>
        <HelpTip
          text="Mede quanto do EBITDA efetivamente vira caixa livre (FCF)."
          formula="FCF ÷ EBITDA × 100"
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
