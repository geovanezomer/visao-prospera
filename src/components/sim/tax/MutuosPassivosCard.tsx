/**
 * MutuosPassivosCard — Mútuos PF→PJ (sócio empresta para a empresa, AFAC remunerado).
 *
 * Espelho simétrico do MutuosSociosCard, invertido:
 *   - Captação = ENTRADA de caixa (Financiamento)
 *   - Amortização do principal = SAÍDA de caixa
 *   - Juros pagos = Despesa Financeira (linha sintética em `costs`)
 *   - Saldo devedor = Passivo (Mútuos a Pagar)
 *
 * SSOT: sincroniza state.cashflow.mutuosPassivosCaptados/Amortizados
 * e injeta linha __mutuos_passivos_juros__ em state.costs (category financeiro).
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
import { fmtBRL } from "@/engines/finance/format";
import {
  aggregateMutuosPassivos,
  SELIC_MENSAL_REFERENCIA_PASSIVO,
} from "@/engines/finance/mutuosPassivos";
import type { MutuoPassivo, CostLine } from "@/engines/finance/types";
import { SectionTitle, MoneyInput } from "@/components/sim/shared/primitives";

const EMPTY_MUTUOS: MutuoPassivo[] = [];
const EMPTY_SOCIOS: NonNullable<import("@/engines/finance/types").AppState["socios"]> = [];

const MUTUO_JUROS_PASSIVO_ID = "__mutuos_passivos_juros__";

const HINT = {
  description:
    "Cadastre empréstimos dos sócios para a empresa (mútuo PF→PJ / AFAC remunerado). Cada contrato gera entrada de caixa na captação, saídas mensais de amortização (Price) e juros pagos. O saldo devedor remanescente vai ao Balanço como Mútuos a Pagar (Passivo).",
  formula:
    "Parcela Price = PV · i / (1 − (1+i)^−n)\nSaldo devedor = PV − Σ amortizações\nDespesa Financeira = Σ juros pagos",
};

function novoMutuo(idx: number, nomeDefault: string): MutuoPassivo {
  return {
    id: `mutuopass_${Date.now()}_${idx}`,
    nome: nomeDefault,
    valorCaptado: 0,
    mesCaptacao: 1,
    taxaMensalPct: SELIC_MENSAL_REFERENCIA_PASSIVO,
    prazoMeses: 12,
    mesInicioDevolucao: 2,
  };
}

export function MutuosPassivosCard() {
  const { state } = useFinance();
  const update = useFinanceUpdate();
  const patchCashflow = usePatchCashflow();
  const readOnly = useFinanceReadOnly();

  const mutuos = state.mutuosPassivos ?? EMPTY_MUTUOS;
  const socios = state.socios ?? EMPTY_SOCIOS;

  const agg = useMemo(() => aggregateMutuosPassivos(mutuos), [mutuos]);

  // SSOT: sincroniza Fluxo de Caixa.
  useEffect(() => {
    if (readOnly) return;
    const curCap = state.cashflow.mutuosPassivosCaptados ?? [];
    const curAmort = state.cashflow.mutuosPassivosAmortizados ?? [];
    const igual =
      curCap.length === 12 &&
      curAmort.length === 12 &&
      curCap.every((v, i) => Math.abs(v - agg.captacao[i]) < 0.01) &&
      curAmort.every((v, i) => Math.abs(v - agg.amortizacao[i]) < 0.01);
    if (!igual) {
      patchCashflow({
        mutuosPassivosCaptados: agg.captacao,
        mutuosPassivosAmortizados: agg.amortizacao,
      });
    }
  }, [
    agg,
    readOnly,
    state.cashflow.mutuosPassivosCaptados,
    state.cashflow.mutuosPassivosAmortizados,
    patchCashflow,
  ]);

  // SSOT — Juros pagos viram linha sintética em state.costs (category financeiro).
  // O engine de DRE já trata `category === "financeiro"` como Despesa Financeira.
  useEffect(() => {
    if (readOnly) return;
    const totalJuros = agg.juros.reduce((a, b) => a + b, 0);
    update((s) => {
      const list = s.costs ?? [];
      const semSystem = list.filter((c) => c.id !== MUTUO_JUROS_PASSIVO_ID);
      if (totalJuros <= 0.005) {
        if (semSystem.length === list.length) return s;
        return { ...s, costs: semSystem };
      }
      const existente = list.find((c) => c.id === MUTUO_JUROS_PASSIVO_ID);
      const igual =
        existente &&
        existente.values.length === 12 &&
        existente.values.every((v, i) => Math.abs(v - agg.juros[i]) < 0.01);
      if (igual) return s;
      const novaLinha: CostLine = {
        id: MUTUO_JUROS_PASSIVO_ID,
        label: "Juros sobre mútuos passivos (sócios)",
        category: "financeiro",
        values: agg.juros.slice() as CostLine["values"],
        // Juros Price variam por mês — NÃO marcar como fixed, senão a engine
        // replicaria o valor-base nos 12 meses (perda de fidelidade da DRE).
        fixed: false,
        custom: false,
      };
      return { ...s, costs: [...semSystem, novaLinha] };
    });
  }, [agg, readOnly, update]);

  const setMutuos = (next: MutuoPassivo[]) =>
    update((s) => ({ ...s, mutuosPassivos: next }));

  const addMutuo = () => {
    const nome = socios[0]?.nome ?? `Sócio ${mutuos.length + 1}`;
    setMutuos([...mutuos, novoMutuo(mutuos.length, nome)]);
  };

  const updateMutuo = (id: string, patch: Partial<MutuoPassivo>) =>
    setMutuos(mutuos.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const removeMutuo = (id: string) =>
    setMutuos(mutuos.filter((m) => m.id !== id));

  const algumSemContrato = mutuos.some((m) => m.valorCaptado > 0 && m.prazoMeses <= 0);
  const algumJurosBaixo = mutuos.some(
    (m) => m.valorCaptado > 0 && m.taxaMensalPct < SELIC_MENSAL_REFERENCIA_PASSIVO,
  );

  return (
    <div className="rounded-lg border border-border/60 border-l-4 border-l-[color:var(--primary)] bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-4">
        <SectionTitle hint={HINT}>Empréstimos de Sócios (mútuo PF→PJ / AFAC)</SectionTitle>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={addMutuo}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar contrato
          </Button>
        )}
      </div>

      {/* Alerta fixo — AFAC + IOF + formalização */}
      {mutuos.length > 0 && (
        <div className="p-4 pb-0">
          <Alert variant="destructive" className="border-amber-500/40 bg-amber-500/5 text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-amber-200">
              Atenção — formalização obrigatória (AFAC vs Mútuo)
            </AlertTitle>
            <AlertDescription className="space-y-2 text-xs text-amber-100/90">
              <p>
                <strong>AFAC × Mútuo:</strong> sem contrato escrito e sem prazo definido, o
                aporte tende a ser tratado como <em>Adiantamento para Futuro Aumento de Capital
                (AFAC)</em> — irreversível, sem juros e classificado em PL. Para tratar como
                empréstimo (Passivo com devolução), formalize <strong>contrato de mútuo</strong>{" "}
                com cláusula de devolução, prazo e juros.
              </p>
              <p>
                <strong>IOF/Crédito (PF→PJ):</strong> mútuo de pessoa física para jurídica
                também incide IOF (alíquota diária + 0,38% adicional), recolhido pela PJ mutuária.
                Considere essa carga ao definir a taxa paga ao sócio.
              </p>
              <p>
                <strong>Dedutibilidade dos juros:</strong> juros pagos ao sócio são dedutíveis na
                apuração do IRPJ/CSLL (Lucro Real) se o contrato for formal, a taxa for de
                mercado e houver efetiva transferência de recursos. Caso contrário, podem ser
                glosados pela RFB.
              </p>
              {algumSemContrato && (
                <p className="font-semibold">
                  ⚠ Há contrato com prazo zero — defina prazo e cronograma de devolução.
                </p>
              )}
              {algumJurosBaixo && (
                <p className="font-semibold">
                  ⚠ Há contrato com taxa abaixo da SELIC mensal de referência (
                  {SELIC_MENSAL_REFERENCIA_PASSIVO.toFixed(2)}%/mês) — pode caracterizar
                  liberalidade e gerar IRPF do sócio sobre presunção de juros (RIR).
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
              <th className="px-2 py-2 text-right">Valor captado (R$)</th>
              <th className="px-2 py-2 text-center">Mês captação</th>
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
                  Nenhum empréstimo de sócio cadastrado. Clique em "Adicionar contrato" para começar.
                </td>
              </tr>
            )}
            {mutuos.map((m) => {
              const singleAgg = aggregateMutuosPassivos([m]);
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
                      value={m.valorCaptado}
                      onChange={(v) => updateMutuo(m.id, { valorCaptado: v })}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={m.mesCaptacao}
                      onChange={(e) =>
                        updateMutuo(m.id, { mesCaptacao: Number(e.target.value) || 1 })
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
                  <td className="px-2 py-2 text-right font-mono">
                    {fmtBRL(singleAgg.saldoFinal)}
                  </td>
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
                <td className="px-2 py-2 text-right font-mono">{fmtBRL(agg.totalCaptado)}</td>
                <td colSpan={4} className="px-2 py-2 text-right text-muted-foreground">
                  Juros pagos no ano (lançados em Despesa Financeira da DRE):
                </td>
                <td className="px-2 py-2 text-right font-mono text-neg">
                  {fmtBRL(agg.totalJurosAno)}
                </td>
                <td></td>
              </tr>
              <tr className="bg-card/60 text-xs text-muted-foreground">
                <td colSpan={6} className="px-3 py-2">
                  <Info className="mr-1 inline h-3 w-3" />
                  Saldo devedor remanescente ao fim do ano vai ao Balanço (Mútuos a Pagar).
                  Juros são sincronizados automaticamente em Despesas → "Juros sobre mútuos
                  passivos (sócios)" e refletem na DRE (Resultado Financeiro) e no Fluxo de
                  Caixa Operacional.
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
