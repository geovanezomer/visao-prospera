/**
 * MutuosSociosCard — Empréstimos PJ→PF (mútuo ativo aos sócios).
 *
 * Espelha o padrão visual de Contratos de Dívida (Capital): tabela de
 * cadastro, com saldo devedor calculado e alerta tributário fixo.
 *
 * SSOT: ao alterar a lista, sincroniza state.cashflow.mutuosConcedidos
 * e mutuosDevolvidos via patchCashflow (Fluxo de Caixa lê dali).
 */
import { useEffect, useMemo } from "react";
import { Plus, Trash2, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useFinance,
  useFinanceUpdate,
  usePatchCashflow,
  useFinanceReadOnly,
} from "@/engines/finance/AppStateContext";
import { fmtBRL, fmtNum } from "@/engines/finance/format";
import { aggregateMutuos, SELIC_MENSAL_REFERENCIA } from "@/engines/finance/mutuosSocios";
import type { MutuoSocio } from "@/engines/finance/types";
import { SectionTitle, MoneyInput } from "@/components/sim/shared/primitives";

const EMPTY_MUTUOS: MutuoSocio[] = [];
const EMPTY_SOCIOS: NonNullable<import("@/engines/finance/types").AppState["socios"]> = [];

const HINT = {
  description:
    "Cadastre empréstimos da empresa aos sócios (mútuo PJ→PF). Cada contrato gera saída de caixa na concessão, entradas mensais de amortização (Price) e juros recebidos. O saldo devedor remanescente vai ao Balanço como Mútuos a Receber.",
  formula:
    "Parcela Price = PV · i / (1 − (1+i)^−n)\nSaldo devedor = PV − Σ amortizações\nReceita Financeira = Σ juros recebidos",
};

function novoMutuo(idx: number, nomeDefault: string): MutuoSocio {
  return {
    id: `mutuo_${Date.now()}_${idx}`,
    nome: nomeDefault,
    valorConcedido: 0,
    mesConcessao: 1,
    taxaMensalPct: SELIC_MENSAL_REFERENCIA,
    prazoMeses: 12,
    mesInicioDevolucao: 2,
  };
}

export function MutuosSociosCard() {
  const { state } = useFinance();
  const update = useFinanceUpdate();
  const patchCashflow = usePatchCashflow();
  const readOnly = useFinanceReadOnly();

  const mutuos = state.mutuosSocios ?? EMPTY_MUTUOS;
  const socios = state.socios ?? EMPTY_SOCIOS;

  const agg = useMemo(() => aggregateMutuos(mutuos), [mutuos]);

  // SSOT: sincroniza Fluxo de Caixa sempre que a lista mudar.
  useEffect(() => {
    if (readOnly) return;
    const curCon = state.cashflow.mutuosConcedidos ?? [];
    const curDev = state.cashflow.mutuosDevolvidos ?? [];
    const igual =
      curCon.length === 12 &&
      curDev.length === 12 &&
      curCon.every((v, i) => Math.abs(v - agg.concessao[i]) < 0.01) &&
      curDev.every((v, i) => Math.abs(v - agg.devolucao[i]) < 0.01);
    if (!igual) {
      patchCashflow({
        mutuosConcedidos: agg.concessao,
        mutuosDevolvidos: agg.devolucao,
      });
    }
  }, [
    agg,
    readOnly,
    state.cashflow.mutuosConcedidos,
    state.cashflow.mutuosDevolvidos,
    patchCashflow,
  ]);

  // SSOT — Juros recebidos vão automaticamente para Receita Financeira na DRE.
  // Como `cashflow.receitasFinanceiras` deriva de `revenue.receitasFinanceiras`
  // via splitReceitasFinanceiras, o impacto no Fluxo de Caixa é automático.
  // Linha de sistema (id `__mutuos_juros__`); recolhida quando não há juros.
  useEffect(() => {
    if (readOnly) return;
    const MUTUO_JUROS_ID = "__mutuos_juros__";
    const totalJuros = agg.juros.reduce((a, b) => a + b, 0);
    update((s) => {
      const list = s.revenue.receitasFinanceiras ?? [];
      const semSystem = list.filter((d) => d.id !== MUTUO_JUROS_ID);
      if (totalJuros <= 0.005) {
        if (semSystem.length === list.length) return s;
        return { ...s, revenue: { ...s.revenue, receitasFinanceiras: semSystem } };
      }
      const existente = list.find((d) => d.id === MUTUO_JUROS_ID);
      const igual =
        existente &&
        existente.valores.length === 12 &&
        existente.valores.every((v, i) => Math.abs(v - agg.juros[i]) < 0.01);
      if (igual) return s;
      const novaLinha = {
        id: MUTUO_JUROS_ID,
        label: "Juros sobre mútuo a sócios",
        valores: agg.juros.slice() as typeof agg.juros,
        fixed: false,
        tipo: "financeira" as const,
        custom: false,
      };
      return {
        ...s,
        revenue: { ...s.revenue, receitasFinanceiras: [...semSystem, novaLinha] },
      };
    });
  }, [agg, readOnly, update]);

  const setMutuos = (next: MutuoSocio[]) => update((s) => ({ ...s, mutuosSocios: next }));

  const addMutuo = () => {
    const nome = socios[0]?.nome ?? `Sócio ${mutuos.length + 1}`;
    setMutuos([...mutuos, novoMutuo(mutuos.length, nome)]);
  };

  const updateMutuo = (id: string, patch: Partial<MutuoSocio>) =>
    setMutuos(mutuos.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const removeMutuo = (id: string) => setMutuos(mutuos.filter((m) => m.id !== id));

  // Alertas por contrato (para badge na linha)
  const algumSemContrato = mutuos.some((m) => m.valorConcedido > 0 && m.prazoMeses <= 0);
  const algumJurosBaixo = mutuos.some(
    (m) => m.valorConcedido > 0 && m.taxaMensalPct < SELIC_MENSAL_REFERENCIA,
  );

  return (
    <div className="rounded-lg border border-border/60 border-l-4 border-l-[color:var(--primary)] bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-4">
        <SectionTitle hint={HINT}>Empréstimos a Sócios (mútuo PJ→PF)</SectionTitle>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={addMutuo}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar contrato
          </Button>
        )}
      </div>

      {/* Alerta fixo — tributário + IOF */}
      {mutuos.length > 0 && (
        <div className="p-4 pb-0">
          <Alert
            variant="destructive"
            className="border-amber-500/40 bg-amber-500/5 text-amber-200"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-amber-200">Atenção — formalização obrigatória</AlertTitle>
            <AlertDescription className="space-y-2 text-xs text-amber-100/90">
              <p>
                <strong>Risco tributário (RFB):</strong> a Receita Federal pode reclassificar o
                mútuo como <em>distribuição disfarçada de lucros</em> se faltar (a) contrato
                escrito, (b) juros de mercado (≥ SELIC) e (c) cronograma de devolução. Mantenha
                contrato registrado e cobre juros compatíveis.
              </p>
              <p>
                <strong>IOF/Crédito:</strong> mútuo PJ→PF está sujeito a IOF (alíquota diária +
                0,38% adicional), recolhido pela PJ mutuante. Considere essa carga ao definir a taxa
                cobrada do sócio.
              </p>
              {algumSemContrato && (
                <p className="font-semibold">
                  ⚠ Há contrato com prazo zero — defina prazo e cronograma de devolução.
                </p>
              )}
              {algumJurosBaixo && (
                <p className="font-semibold">
                  ⚠ Há contrato com taxa abaixo da SELIC mensal de referência (
                  {fmtNum(SELIC_MENSAL_REFERENCIA, 2)}%/mês) — risco de autuação.
                </p>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="scrollbar-thin overflow-x-auto p-2">
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr className="bg-card text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Sócio</th>
              <th className="px-2 py-2 text-right">Valor concedido (R$)</th>
              <th className="px-2 py-2 text-center">Mês concessão</th>
              <th className="px-2 py-2 text-right">Taxa (% a.m.)</th>
              <th className="px-2 py-2 text-center">Prazo (meses)</th>
              <th className="px-2 py-2 text-center">Início devolução</th>
              <th className="px-2 py-2 text-right">Saldo fim do ano</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {mutuos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhum empréstimo cadastrado. Clique em "Adicionar contrato" para começar.
                </td>
              </tr>
            )}
            {mutuos.map((m) => {
              // Recalcula saldo individual para exibir por linha.
              const singleAgg = aggregateMutuos([m]);
              return (
                <tr key={m.id} className="border-t border-border/40 bg-card align-middle">
                  <td className="px-3 py-2">
                    <Input
                      value={m.nome}
                      onChange={(e) => updateMutuo(m.id, { nome: e.target.value })}
                      className="h-8 text-xs"
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <MoneyInput
                      value={m.valorConcedido}
                      onChange={(v) => updateMutuo(m.id, { valorConcedido: v })}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={m.mesConcessao}
                      onChange={(e) =>
                        updateMutuo(m.id, { mesConcessao: Number(e.target.value) || 1 })
                      }
                      className="h-8 w-16 text-center text-xs"
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      step={0.01}
                      min={0}
                      value={m.taxaMensalPct}
                      onChange={(e) =>
                        updateMutuo(m.id, { taxaMensalPct: Number(e.target.value) || 0 })
                      }
                      className="h-8 text-right text-xs"
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Input
                      type="number"
                      min={1}
                      value={m.prazoMeses}
                      onChange={(e) =>
                        updateMutuo(m.id, { prazoMeses: Number(e.target.value) || 1 })
                      }
                      className="h-8 w-20 text-center text-xs"
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={m.mesInicioDevolucao}
                      onChange={(e) =>
                        updateMutuo(m.id, { mesInicioDevolucao: Number(e.target.value) || 1 })
                      }
                      className="h-8 w-16 text-center text-xs"
                      disabled={readOnly}
                    />
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{fmtBRL(singleAgg.saldoFinal)}</td>
                  <td className="px-2 py-2 text-right">
                    {!readOnly && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeMutuo(m.id)}
                        title="Remover contrato"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {mutuos.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border/60 bg-card/60 font-semibold">
                <td className="px-3 py-2">Totais</td>
                <td className="px-2 py-2 text-right font-mono">{fmtBRL(agg.totalConcedido)}</td>
                <td colSpan={4} className="px-2 py-2 text-right text-muted-foreground">
                  Juros recebidos no ano (lançados em Receita Financeira da DRE):
                </td>
                <td className="px-2 py-2 text-right font-mono text-pos">
                  {fmtBRL(agg.totalJurosAno)}
                </td>
                <td></td>
              </tr>
              <tr className="bg-card/60 text-xs text-muted-foreground">
                <td colSpan={6} className="px-3 py-2">
                  <Info className="mr-1 inline h-3 w-3" />
                  Saldo devedor remanescente ao fim do ano vai ao Balanço (Mútuos a Receber). Juros
                  são sincronizados automaticamente em Receitas → "Juros sobre mútuo a sócios" e
                  refletem na DRE (Resultado Financeiro) e no Fluxo de Caixa Operacional.
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtBRL(agg.saldoFinal)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
