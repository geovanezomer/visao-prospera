import { AppState } from "@/lib/finance/types";
import { fmtBRL, fmtPct, sum } from "@/lib/finance/format";
import { buildDRE, calcIndicators, monthValues } from "@/lib/finance/calculations";
import { Slider } from "@/components/ui/slider";
import { MoneyInput, PctInput, SectionTitle, StatCard, HelpTip } from "./primitives";

export function CapitalTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const c = state.capital;
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);

  const set = (patch: Partial<typeof c>) => update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  const wacc = ind.wacc;
  const terceiros = 100 - c.proprio;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-5">
          <SectionTitle hint="Proporção entre capital dos sócios e dívida com terceiros.">Estrutura de capital</SectionTitle>

          <div>
            <div className="flex justify-between text-xs">
              <span>Capital Próprio (E)</span>
              <span className="num text-pos">{c.proprio.toFixed(0)}%</span>
            </div>
            <Slider value={[c.proprio]} min={0} max={100} step={1} onValueChange={([v]) => set({ proprio: v })} className="mt-2" />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Capital de Terceiros (D)</span>
              <span className="num">{terceiros.toFixed(0)}%</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Ke — Custo do Capital Próprio <HelpTip text="Retorno mínimo exigido pelos sócios para aceitar o risco do negócio. Quem investe em empresa precisa ganhar mais do que na renda fixa." formula="CAPM: Rf + β × (Rm − Rf)" example="Selic 10% + Prêmio de risco 8% = 18%" />
              </label>
              <PctInput value={c.ke} onChange={(n) => set({ ke: n })} />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Kd — Custo da Dívida (a.a.) <HelpTip text="Taxa média anual paga em empréstimos e financiamentos, ANTES do benefício fiscal (juros são dedutíveis do IR)." formula="Custo efetivo = Kd × (1 − Alíquota IR)" />
              </label>
              <PctInput value={c.kd} onChange={(n) => set({ kd: n })} />
            </div>
          </div>

          <div className="rounded-md border border-primary/40 bg-primary/10 p-4">
            <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-primary">
              WACC — Custo Médio Ponderado de Capital
              <HelpTip text="Retorno mínimo que a empresa precisa entregar para remunerar sócios (Ke) e credores (Kd). É a 'meta' que o ROIC precisa superar para a empresa criar valor." formula="(E/V × Ke) + (D/V × Kd × (1 − IR))" />
            </div>
            <div className="mono mt-2 text-3xl font-semibold text-primary">{wacc.toFixed(2)}%</div>
            <div className="mt-1 text-xs text-muted-foreground">
              ROIC atual: <span className="num">{ind.roic.toFixed(2)}%</span> —{" "}
              {ind.roic >= wacc ? <span className="text-pos font-semibold">criando valor</span> : <span className="text-neg font-semibold">destruindo valor</span>}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-4">
          <SectionTitle hint="Itens patrimoniais usados para calcular liquidez, ROE, ROA e alavancagem.">Posição patrimonial</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Patrimônio Líquido</label>
              <MoneyInput value={c.patrimonioLiquido} onChange={(n) => set({ patrimonioLiquido: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ativo Total</label>
              <MoneyInput value={c.ativoTotal} onChange={(n) => set({ ativoTotal: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Disponibilidades (caixa)</label>
              <MoneyInput value={c.disponibilidades} onChange={(n) => set({ disponibilidades: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Estoques</label>
              <MoneyInput value={c.estoques} onChange={(n) => set({ estoques: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dívida Onerosa (empréstimos)</label>
              <MoneyInput value={c.dividaOnerosa} onChange={(n) => set({ dividaOnerosa: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Passivo Circulante (0 = auto)</label>
              <MoneyInput value={c.passivoCirculante} onChange={(n) => set({ passivoCirculante: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Ativo Circulante (0 = auto)</label>
              <MoneyInput value={c.ativoCirculante} onChange={(n) => set({ ativoCirculante: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Contas a Receber (0 = auto via PMR)</label>
              <MoneyInput value={c.contasReceber} onChange={(n) => set({ contasReceber: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Fornecedores a Pagar (0 = auto via PMP)</label>
              <MoneyInput value={c.fornecedores} onChange={(n) => set({ fornecedores: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Depreciação mensal</label>
              <MoneyInput value={c.depreciacaoMensal} onChange={(n) => set({ depreciacaoMensal: n })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Juros recebidos / mês</label>
              <MoneyInput value={c.jurosRecebidosMensal} onChange={(n) => set({ jurosRecebidosMensal: n })} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Ciclo Financeiro" value={`${ind.cicloFinanceiro} dias`} hint={{ description: "Dias entre pagar fornecedores e receber dos clientes. Quanto MAIOR, mais capital de giro a empresa precisa imobilizar.", formula: "PMR + PME − PMP" }} />
        <StatCard label="NCG" value={fmtBRL(ind.ncg)} tone="warn" hint={{ description: "Necessidade de Capital de Giro — dinheiro que a operação 'consome' permanentemente para girar (estoques + clientes − fornecedores).", formula: "(Ciclo Financeiro ÷ 30) × Custos Mensais" }} />
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Capital de Giro Disponível
            <HelpTip text="Recursos próprios que a empresa tem disponíveis para financiar o ciclo operacional (capital permanente menos ativo permanente)." formula="(PL + Exigível a LP) − Ativo Permanente" />
          </div>
          <MoneyInput value={c.capitalGiroDisponivel} onChange={(n) => set({ capitalGiroDisponivel: n })} className="mt-2 text-lg" />
        </div>
        <StatCard
          label="Gap de Capital de Giro"
          value={fmtBRL(ind.gapCapitalGiro)}
          tone={ind.gapCapitalGiro > 0 ? "neg" : "pos"}
          sub={ind.gapCapitalGiro > 0 ? "Falta caixa para sustentar o ciclo" : "Capital de giro suficiente"}
          hint={{ description: "Diferença entre o que a operação precisa (NCG) e o que a empresa tem (CGD). Positivo = precisa de empréstimo de giro; Negativo = sobra caixa.", formula: "NCG − Capital de Giro Disponível" }}
        />
      </div>
    </div>
  );
}
