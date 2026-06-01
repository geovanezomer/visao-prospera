import { AppState, CapexAtivacao } from "@/lib/finance/types";
import { fmtBRL, fmtPct, sum } from "@/lib/finance/format";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { MoneyInput, NumInput, PctInput, SectionTitle, StatCard, HelpTip } from "./primitives";

export function CapitalTab({ state, update }: { state: AppState; update: (p: Partial<AppState> | ((s: AppState) => AppState)) => void }) {
  const c = state.capital;
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);

  const set = (patch: Partial<typeof c>) => update((s) => ({ ...s, capital: { ...s.capital, ...patch } }));

  const wacc = ind.wacc;
  const terceiros = 100 - c.proprio;

  // Validação de consistência patrimonial
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
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-warning">⚠ Inconsistências patrimoniais detectadas</div>
          <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
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
        <StatCard label="Necessidade de Capital de Giro" value={fmtBRL(ind.ncg)} tone="warn" hint={{ description: "Dinheiro que a operação consome permanentemente para girar. Quando Contas a Receber/Fornecedores estão zerados, é estimada via PMR/PMP sobre receita bruta e CPV — pode divergir 30-40% do real se você tem mix de à vista/a prazo. Preencha os saldos médios para precisão.", formula: "CR + Estoques − Fornecedores" }} />
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
          hint={{ description: "Diferença entre o que a operação precisa (Necessidade de Capital de Giro) e o que a empresa tem (CGD). Positivo = precisa de empréstimo de giro; Negativo = sobra caixa.", formula: "Necessidade de Capital de Giro − Capital de Giro Disponível" }}
        />
      </div>

      {/* Capex / Ativação de Imobilizado — gera depreciação adicional a partir do mês informado */}
      <CapexAtivacaoSection
        items={c.capexAtivacao ?? []}
        onChange={(next) => set({ capexAtivacao: next })}
      />
    </div>
  );
}

function CapexAtivacaoSection({
  items,
  onChange,
}: {
  items: CapexAtivacao[];
  onChange: (next: CapexAtivacao[]) => void;
}) {
  const add = () => {
    const id = `cx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onChange([...items, { id, label: "Novo ativo", mes: 1, valor: 0, vidaUtilMeses: 60 }]);
  };
  const upd = (id: string, patch: Partial<CapexAtivacao>) =>
    onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const rm = (id: string) => onChange(items.filter((x) => x.id !== id));

  const depMensalAdicional = items.reduce(
    (acc, x) => acc + (x.vidaUtilMeses > 0 ? x.valor / x.vidaUtilMeses : 0),
    0,
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <SectionTitle hint="Cada item gera depreciação adicional linear (valor ÷ vida útil) a partir do mês de ativação até o fim do ano. Atualiza EBIT, IR (no Real) e ROIC automaticamente.">
          Capex · Ativação de Imobilizado no ano
        </SectionTitle>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Depreciação adicional/mês:{" "}
            <span className="num text-foreground">{fmtBRL(depMensalAdicional)}</span>
          </span>
          <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar ativação
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Nenhuma ativação cadastrada. Use para máquinas, software, reformas etc. que entram em operação no meio do ano.
        </div>
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Descrição</th>
                <th className="w-24 px-2 py-2 text-center">Mês ativ.</th>
                <th className="w-40 px-2 py-2 text-right">Valor capitalizado</th>
                <th className="w-32 px-2 py-2 text-right">Vida útil (meses)</th>
                <th className="w-32 px-2 py-2 text-right">Dep./mês</th>
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => {
                const dep = x.vidaUtilMeses > 0 ? x.valor / x.vidaUtilMeses : 0;
                return (
                  <tr key={x.id} className="border-t border-border/40 align-middle">
                    <td className="px-3 py-2">
                      <input
                        value={x.label}
                        onChange={(e) => upd(x.id, { label: e.target.value })}
                        className="w-full rounded-md border border-border/40 bg-input/40 px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <NumInput
                        integer
                        min={1}
                        max={12}
                        value={x.mes}
                        onChange={(n) => upd(x.id, { mes: Math.max(1, Math.min(12, n || 1)) })}
                        className="w-16"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <MoneyInput value={x.valor} onChange={(n) => upd(x.id, { valor: n })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumInput
                        integer
                        min={1}
                        value={x.vidaUtilMeses}
                        onChange={(n) => upd(x.id, { vidaUtilMeses: Math.max(1, n || 1) })}
                      />
                    </td>

                    <td className="num px-2 py-2 text-right text-neg">{fmtBRL(dep)}</td>
                    <td className="px-1 py-2 text-center">
                      <button
                        onClick={() => rm(x.id)}
                        title="Remover"
                        className="text-muted-foreground transition hover:text-neg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
