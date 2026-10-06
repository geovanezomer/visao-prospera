/**
 * SociosCard — Pró-labore × Distribuição de Lucros — Previsão.
 *
 * Tabela superior (PREVISÃO): cadastrados em Configurações → Empresa → Sócios.
 * Mostra apenas folha (pró-labore, INSS sócio/patronal, IRPF do pró-labore) e
 * a CAPACIDADE TEÓRICA de distribuição. Esses números NÃO afetam Caixa/DRE/Balanço.
 *
 * Bloco inferior (REALIZADA): decisão dos sócios sobre quanto efetivamente
 * distribuir mês-a-mês. Esta é a fonte de verdade que alimenta:
 *  - Fluxo de Caixa (Atividades de Financiamento → Dividendos)
 *  - Balanço (Resultado do exercício = Lucro Líquido; dividendos reduzem o PL em rubrica própria)
 *  - IRPF do excedente (parcela tributável calculada sobre o REALIZADO)
 *
 * O Adicional IRPJ de 10% (Lei 9.249/95) continua incidindo sobre o LUCRO
 * presumido trimestral (não sobre a retirada) — está correto e não muda.
 */
import { useMemo, useState } from "react";
import { Settings, Wand2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useFinance, useFinanceUpdate } from "@/engines/finance/AppStateContext";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
import { buildDRE } from "@/engines/finance/dre";
import { fmtBRL, MESES, sum } from "@/engines/finance/format";
import {
  calcRetiradaSocio,
  syncSociosToCosts,
  calcDistribuicaoIsentaBreakdown,
  calcDistribuicaoIsentaLimite,
  getDistribuicaoRealizadaMeses,
} from "@/engines/finance/socios";
import { SectionTitle, HelpTip } from "@/components/sim/shared/primitives";
import { getSalarioMinimo, getIrpfTable } from "@/engines/finance/taxDefaults";
import { CompanyConfigDialog } from "@/components/sim/shared/CompanyConfigDialog";
import { fill12 } from "@/engines/finance/format";

const HINT = {
  description:
    "PREVISÃO: capacidade teórica derivada do cadastro de sócios. Mostra pró-labore, INSS e IRPF (folha — sempre realizados) e o teto de distribuição isenta. A distribuição EFETIVA é registrada no bloco inferior — só ela alimenta Fluxo de Caixa e Balanço; dividendos não passam pela DRE.",
  formula:
    "Líquido (folha) = Pró-labore − INSS sócio − IRPF do pró-labore\nCusto PJ = Pró-labore + INSS patronal",
  example:
    "Se a empresa pode distribuir R$ 50k mas decide reter R$ 20k para reforçar caixa, registre apenas R$ 30k em 'Distribuição Realizada' — o caixa preservado aparece nos Lucros Acumulados do Balanço.",
};

const SEPARATOR_HINT = {
  description:
    "A PREVISÃO (acima) mostra quanto a empresa PODERIA distribuir sem violar limites legais. A REALIZADA (abaixo) é o que de fato saiu do caixa para os sócios. Apenas a Realizada alimenta Fluxo de Caixa e Balanço; na DRE, dividendos não são despesa.",
  formula:
    "Resultado do exercício (Balanço) = Σ Lucro Líquido\nDividendos pagos no período = −Σ Distribuição Realizada\nDFC Financiamento (Dividendos) = Distribuição Realizada (mês a mês)",
};

export function SociosCard() {
  const { state } = useFinance();
  const update = useFinanceUpdate();
  const regime = resolveEffectiveRegime(state);
  const socios = state.socios ?? [];
  const salarioMin = getSalarioMinimo(state.tax);
  const [configOpen, setConfigOpen] = useState(false);

  const payoutPct = state.payoutPolicyPct ?? 100;
  const reservaMin = state.reservaMinimaMensal ?? 0;

  const { lucroMensalBruto, lucroMensalDisponivel } = useMemo(() => {
    try {
      const semSocios = syncSociosToCosts({ ...state, socios: [] }, regime);
      const { dre } = buildDRE(semSocios, regime);
      const lucroAno = dre.lucroLiquido.reduce((a, b) => a + b, 0);
      const bruto = Math.max(0, lucroAno / 12);
      const aposReserva = Math.max(0, bruto - reservaMin);
      return { lucroMensalBruto: bruto, lucroMensalDisponivel: (aposReserva * payoutPct) / 100 };
    } catch {
      return { lucroMensalBruto: 0, lucroMensalDisponivel: 0 };
    }
  }, [state, regime, payoutPct, reservaMin]);

  const somaPartic = socios.reduce((a, s) => a + s.participacaoPct, 0);
  const partOk = socios.length === 0 || Math.abs(somaPartic - 100) < 0.01;

  // Cálculo de folha (independe da distribuição realizada).
  const resultadosFolha = socios.map((s) =>
    calcRetiradaSocio(s, state, regime, (lucroMensalDisponivel * s.participacaoPct) / 100),
  );

  // ─── Distribuição Realizada ──────────────────────────────────────────
  const realizadaArr = getDistribuicaoRealizadaMeses(state);
  const realizadaFixed = state.distribuicaoRealizada?.fixed ?? true;
  const realizadaTotalAno = realizadaArr.reduce((a, b) => a + b, 0);
  const realizadaMediaMes = realizadaTotalAno / 12;
  const previsaoTotalAno = lucroMensalDisponivel * 12;
  const retidoAno = Math.max(0, previsaoTotalAno - realizadaTotalAno);

  // Lucro Líquido real do exercício (COM impacto dos sócios) — base para o
  // alerta "sem lastro no lucro" (RIR/2018 art. 238, Lei 6.404/76 art. 201).
  const llAnualReal = useMemo(() => {
    try {
      const { dre } = buildDRE(state, regime);
      return dre.lucroLiquido.reduce((a, b) => a + b, 0);
    } catch {
      return 0;
    }
  }, [state, regime]);
  const alertaSemLastro =
    realizadaTotalAno > 0 && (llAnualReal < 0 || realizadaTotalAno > llAnualReal * 1.2);

  const limiteIsentoMensal = calcDistribuicaoIsentaLimite(state, regime);
  const breakdown = calcDistribuicaoIsentaBreakdown(state, regime);
  const tabela = getIrpfTable(state.tax);
  const aliqTopoPct = tabela[tabela.length - 1][1];
  const limiteIsentoAnual = Number.isFinite(limiteIsentoMensal)
    ? limiteIsentoMensal * 12
    : Number.POSITIVE_INFINITY;

  // IRPF excedente sobre o REALIZADO: apura mês a mês para não esconder picos.
  const excedenteArr = Number.isFinite(limiteIsentoMensal)
    ? realizadaArr.map((v) => Math.max(0, v - limiteIsentoMensal))
    : fill12(0);
  const excedenteAno = sum(excedenteArr);
  const irpfExcedenteAno = excedenteAno * (aliqTopoPct / 100);
  const irpfExcedenteMes = irpfExcedenteAno / 12;

  const setRealizadaFixed = (fixed: boolean) => {
    const values = fixed ? fill12(realizadaMediaMes) : realizadaArr;
    update((s) => ({
      ...s,
      distribuicaoRealizada: { values, fixed },
    }));
  };
  const setRealizadaUniforme = (v: number) => {
    const val = Math.max(0, v);
    update((s) => ({
      ...s,
      distribuicaoRealizada: { values: fill12(val), fixed: true },
    }));
  };
  const setRealizadaMes = (idx: number, v: number) => {
    const next = [...realizadaArr];
    next[idx] = Math.max(0, v);
    update((s) => ({
      ...s,
      distribuicaoRealizada: { values: next, fixed: false },
    }));
  };
  const usarPrevisao = () => {
    update((s) => ({
      ...s,
      distribuicaoRealizada: { values: fill12(lucroMensalDisponivel), fixed: true },
    }));
  };
  const zerarRealizada = () => {
    update((s) => ({
      ...s,
      distribuicaoRealizada: { values: fill12(0), fixed: true },
    }));
  };

  const totaisAno = {
    prolab: resultadosFolha.reduce((a, r) => a + r.prolaboreMensal, 0) * 12,
    patronal: resultadosFolha.reduce((a, r) => a + r.inssPatronal, 0) * 12,
    inssSocio: resultadosFolha.reduce((a, r) => a + r.inssSocio, 0) * 12,
    irpf: resultadosFolha.reduce((a, r) => a + r.irpfMensal, 0) * 12,
    liquidoFolha:
      resultadosFolha.reduce((a, r) => a + (r.prolaboreMensal - r.inssSocio - r.irpfMensal), 0) *
      12,
    custoPJ: resultadosFolha.reduce((a, r) => a + r.custoTotalPJ, 0) * 12,
  };

  // Alertas inteligentes
  const acimaIsento = excedenteAno > 0;
  const retencaoForte = retidoAno > 0 && retidoAno > previsaoTotalAno * 0.3;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionTitle hint={HINT}>Pró-labore × Distribuição de Lucros — Previsão</SectionTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Capacidade teórica mensal: <b>{fmtBRL(lucroMensalDisponivel)}</b>
            {(payoutPct !== 100 || reservaMin > 0) && (
              <span className="text-muted-foreground/70">
                {" "}
                (bruto {fmtBRL(lucroMensalBruto)} − reserva {fmtBRL(reservaMin)} × payout{" "}
                {payoutPct}%)
              </span>
            )}{" "}
            · Regime: <b className="uppercase">{regime}</b> · Piso legal:{" "}
            <b>{fmtBRL(salarioMin)}</b>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
          <Settings className="mr-1 h-3.5 w-3.5" /> Editar sócios
        </Button>
      </div>

      {socios.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nenhum sócio cadastrado. Clique em <b>Editar sócios</b> para abrir o cadastro em
          Configurações → Empresa → Sócios.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 font-medium">Sócio</th>
                <th className="px-2 py-2 font-medium text-right">Participação</th>
                <th className="px-2 py-2 font-medium text-right">Pró-labore (mês)</th>
                <th className="px-2 py-2 font-medium text-right">INSS sócio</th>
                <th className="px-2 py-2 font-medium text-right">INSS patronal</th>
                <th className="px-2 py-2 font-medium text-right">IRPF (pró-labore)</th>
                <th className="px-2 py-2 font-medium text-right">Líquido folha (mês)</th>
                <th className="px-2 py-2 font-medium text-right">Custo PJ (mês)</th>
              </tr>
            </thead>
            <tbody>
              {socios.map((s, i) => {
                const r = resultadosFolha[i];
                const abaixoDoPiso =
                  s.operacional && s.prolaboreMensal > 0 && s.prolaboreMensal < salarioMin;
                const liquidoFolha = r.prolaboreMensal - r.inssSocio - r.irpfMensal;
                return (
                  <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium">{s.nome}</td>
                    <td className="num px-2 py-1.5 text-right">{s.participacaoPct.toFixed(2)}%</td>
                    <td
                      className={`num px-2 py-1.5 text-right ${
                        abaixoDoPiso ? "text-[var(--warning)]" : ""
                      }`}
                      title={
                        abaixoDoPiso
                          ? `Abaixo do piso de ${fmtBRL(salarioMin)} (IN RFB 971/2009)`
                          : undefined
                      }
                    >
                      {fmtBRL(s.prolaboreMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.inssSocio)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.inssPatronal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-foreground/90">
                      {fmtBRL(r.irpfMensal)}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold text-pos">
                      {fmtBRL(liquidoFolha)}
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold">
                      {fmtBRL(r.custoTotalPJ)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border/60 bg-muted/20 text-[12px] font-semibold">
                <td className="px-2 py-2">Total anual</td>
                <td
                  className={`num px-2 py-2 text-right ${
                    partOk ? "text-foreground" : "text-[var(--warning)]"
                  }`}
                >
                  {somaPartic.toFixed(2)}%
                </td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.prolab)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.inssSocio)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.patronal)}</td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.irpf)}</td>
                <td className="num px-2 py-2 text-right text-pos">
                  {fmtBRL(totaisAno.liquidoFolha)}
                </td>
                <td className="num px-2 py-2 text-right">{fmtBRL(totaisAno.custoPJ)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Retenção Lei 15.270/25 + alerta IRPFM (por sócio) */}
          {resultadosFolha.some((r) => r.retencaoDividendosMensal > 0 || r.alertaIRPFM) && (
            <div className="mt-3 space-y-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[12px]">
              {resultadosFolha.map((r, i) =>
                r.retencaoDividendosMensal > 0 || r.alertaIRPFM ? (
                  <div key={r.socioId} className="space-y-1">
                    <div className="font-medium">{socios[i]?.nome ?? r.socioId}</div>
                    {r.retencaoDividendosMensal > 0 && (
                      <div
                        className="text-foreground/90"
                        title="Retenção na fonte sobre distribuições acima de R$ 50 mil/mês da mesma PJ à mesma PF; antecipação do IRPF Mínimo anual."
                      >
                        (−) Retenção IR dividendos 10% (Lei 15.270/25):{" "}
                        <b>{fmtBRL(r.retencaoDividendosMensal)}</b>/mês
                      </div>
                    )}
                    {r.alertaIRPFM && (
                      <div className="text-[var(--warning)]">
                        ⚠ Renda anual do sócio acima de R$ 600 mil — sujeita ao IRPF Mínimo (até
                        10%). Simulação não calcula o IRPFM, que depende da renda global da PF.
                      </div>
                    )}
                  </div>
                ) : null,
              )}
            </div>
          )}

          {!partOk && (
            <div className="mt-3 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[12px] text-[var(--warning)]">
              ⚠️ A soma das participações é <b>{somaPartic.toFixed(2)}%</b> e precisa fechar{" "}
              <b>100%</b>. Ajuste em <b>Configurações → Empresa → Sócios</b>.
            </div>
          )}
        </div>
      )}

      {/* ───────────────── Separador + Distribuição Realizada ───────────────── */}
      <div className="mt-6">
        <Separator className="my-4" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Distribuição Realizada — 12 meses</h4>
            <HelpTip
              text={SEPARATOR_HINT.description}
              formula={SEPARATOR_HINT.formula}
              calc={[
                `Capacidade prevista (ano) = ${fmtBRL(previsaoTotalAno)}`,
                `Realizado (ano) = ${fmtBRL(realizadaTotalAno)}`,
                `Retido em caixa (ano) = ${fmtBRL(retidoAno)}`,
                `Limite isento = ${fmtBRL(limiteIsentoMensal)}/mês (${fmtBRL(limiteIsentoAnual)}/ano)`,
                `Excedente realizado (ano) = ${fmtBRL(excedenteAno)}`,
                `Adicional IRPJ 10% já no DRE = ${fmtBRL(breakdown.adicionalIrpjAno)}/ano`,
              ].join("\n")}
            />
            <span className="rounded-full bg-pos/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-pos">
              Efetivado em caixa
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={usarPrevisao}
              title="Copia a capacidade prevista para todos os meses"
            >
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Usar Previsão
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={zerarRealizada}
              title="Zera todos os meses (segura o caixa)"
            >
              <Eraser className="mr-1 h-3.5 w-3.5" /> Zerar
            </Button>
          </div>
        </div>

        <p className="mt-1 text-[11px] text-muted-foreground">
          O valor preenchido aqui é o que <b>efetivamente</b> sai do caixa para os sócios. Use{" "}
          <b>Usar Previsão</b> para distribuir 100% do disponível, ou ajuste mês-a-mês para reter
          caixa nos meses críticos.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <Switch
            id="dist-realizada-fixed"
            checked={realizadaFixed}
            onCheckedChange={setRealizadaFixed}
          />
          <Label htmlFor="dist-realizada-fixed" className="text-[12px] cursor-pointer">
            Fixar todos os meses (mesmo valor)
          </Label>
        </div>

        {realizadaFixed ? (
          <div className="mt-3 max-w-xs">
            <Label className="text-[11px] text-muted-foreground">Valor mensal (R$)</Label>
            <Input
              type="number"
              min={0}
              step={100}
              value={realizadaArr[0] ?? 0}
              onChange={(e) => setRealizadaUniforme(Number(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {realizadaArr.map((v, i) => (
              <div key={i} className="space-y-1">
                <Label className="text-[10px] uppercase text-muted-foreground">{MESES[i]}</Label>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={v}
                  onChange={(e) => setRealizadaMes(i, Number(e.target.value) || 0)}
                  className="h-8 text-[12px]"
                />
              </div>
            ))}
          </div>
        )}

        {/* Resumo + Alertas */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryBox label="Realizado (ano)" value={fmtBRL(realizadaTotalAno)} tone="pos" />
          <SummaryBox
            label="Disponível previsto (ano)"
            value={fmtBRL(previsaoTotalAno)}
            tone="default"
          />
          <SummaryBox
            label="Retido em caixa (ano)"
            value={fmtBRL(retidoAno)}
            tone={retidoAno > 0 ? "warn" : "default"}
            sub={
              previsaoTotalAno > 0
                ? `${((retidoAno / previsaoTotalAno) * 100).toFixed(1)}% do disponível`
                : undefined
            }
          />
          <SummaryBox
            label="IRPF excedente (mês)"
            value={fmtBRL(irpfExcedenteMes)}
            tone={irpfExcedenteMes > 0 ? "warn" : "default"}
            sub={
              acimaIsento ? `Excedente anual ${fmtBRL(excedenteAno)}` : "Dentro do limite isento"
            }
          />
        </div>

        {/* Alerta de excedente ao limite isento removido — substituído pelo
            alerta "Distribuição sem lastro no lucro" renderizado no rodapé da
            aba Pró-labore (ProlaboreTab), que trata o mesmo risco fiscal
            (RIR/2018 art. 238) com base no Lucro Líquido do exercício. */}
        {retencaoForte && !acimaIsento && (
          <div className="mt-3 rounded border border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            💡 Empresa está retendo <b>{fmtBRL(retidoAno)}</b> (
            {((retidoAno / previsaoTotalAno) * 100).toFixed(0)}%) do disponível. O caixa preservado
            aparece como aumento de <b>Lucros Acumulados</b> no Balanço.
          </div>
        )}

        {alertaSemLastro &&
          (() => {
            // Excedente sem lastro = distribuição anual acima do LL positivo do exercício.
            // Se LL ≤ 0, todo o valor distribuído fica sem lastro no ano.
            const excedenteSemLastro = Math.max(0, realizadaTotalAno - Math.max(0, llAnualReal));
            // Estimativas de tributação adicional sobre o excedente:
            //  - Piso: ganho de capital (15%) se reclassificado como devolução de capital.
            //  - Teto: IRPF (27,5%) se reclassificado como rendimento tributável do sócio.
            const irpfMin = excedenteSemLastro * 0.15;
            const irpfMax = excedenteSemLastro * 0.275;
            return (
              <div className="mt-3 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-[12px] text-foreground/90">
                <div className="font-semibold text-destructive mb-1">
                  ⚠️ Distribuição sem lastro no lucro do exercício
                </div>
                <p className="leading-relaxed">
                  Distribuição anual planejada: <b>{fmtBRL(realizadaTotalAno)}</b> · Lucro Líquido
                  do exercício: <b>{fmtBRL(llAnualReal)}</b>.
                </p>
                <p className="leading-relaxed mt-1">
                  Sem lucro suficiente no ano, a Receita pode reclassificar o excedente como{" "}
                  <b>devolução de capital</b> (potencial ganho de capital 15–22,5% para o sócio) ou{" "}
                  <b>rendimento tributável</b> (IRPF até 27,5%) — RIR/2018 art. 238. Só distribua
                  acima do LL se houver <b>reserva de lucros de exercícios anteriores</b>{" "}
                  devidamente registrada em balanço (Lei 6.404/76 art. 201).
                </p>
                <p className="leading-relaxed mt-2">
                  <b>Estimativa de tributação adicional</b> sobre o excedente sem lastro de{" "}
                  <b>{fmtBRL(excedenteSemLastro)}</b>: entre <b>{fmtBRL(irpfMin)}</b> (ganho de
                  capital 15%) e <b>{fmtBRL(irpfMax)}</b> (IRPF 27,5%), a depender do enquadramento
                  pela Receita.
                </p>
              </div>
            );
          })()}

        {realizadaTotalAno > 0 && (
          <div className="mt-3 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-[12px] text-foreground/90">
            <div className="font-semibold text-[var(--warning)] mb-1">
              ⚖️ Atenção — Requisitos legais para distribuir lucros
            </div>
            <p className="leading-relaxed">
              A distribuição de lucros só é permitida quando a empresa está{" "}
              <b>em dia com tributos federais</b>
              (Lei nº 4.357/1964, art. 32 — veda a distribuição enquanto houver débito não garantido
              com a União, INSS, FGTS ou contribuições sociais, sob pena de multa de 50% do valor
              distribuído aos sócios). É obrigatório manter <b>
                escrituração contábil regular
              </b>{" "}
              (Livro Diário, Razão, Balanço e DRE) que comprove a existência de lucro efetivamente
              apurado (CC/2002 art. 1.078; RIR/2018 arts. 238 e 725; IN RFB 1.700/2017). Sem
              contabilidade completa, a isenção do IRPF (Lei 9.249/1995 art. 10) fica limitada ao
              lucro presumido líquido dos tributos — o excedente é tributado como rendimento do
              sócio. Recomenda-se reter <b>CND/CPEN</b> e <b>ata de deliberação</b> dos sócios antes
              de cada pagamento.
            </p>
          </div>
        )}

        <p className="mt-3 text-[11px] text-muted-foreground">
          Para alterar nome, participação, pró-labore, dependentes ou status operacional, edite o
          cadastro em <b>Configurações → Empresa → Sócios</b>.
        </p>
      </div>

      <CompanyConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: "default" | "pos" | "warn";
  sub?: string;
}) {
  const toneClass =
    tone === "pos" ? "text-pos" : tone === "warn" ? "text-[var(--warning)]" : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
