import { useMemo } from "react";
import { useFinanceState } from "@/engines/finance/AppStateContext";
import { AppState } from "@/engines/finance/types";
import { fmtBRL, fmtPct, fmtTimes, MESES, sum } from "@/engines/finance/format";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HelpTip, SectionTitle, StatCard } from "@/components/sim/shared/primitives";
import { leverageDisplay } from "@/components/sim/shared/leverageLabel";
import { TrendingUp, TrendingDown } from "lucide-react";
import { HistoricalYearPills } from "@/components/sim/shared/HistoricalYearPills";

const CHART_COLORS = [
  "#00E5A0",
  "#5BA8F5",
  "#F5B85B",
  "#C77DFF",
  "#FF6B6B",
  "#7DD3FC",
  "#FACC15",
  "#F472B6",
  "#34D399",
  "#A78BFA",
  "#FB923C",
];

// Estilo padrão de tooltip dos charts (DRY — antes repetido 4×)
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;
const TOOLTIP_ITEM = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--popover-foreground)", fontWeight: 600 } as const;

// `fmtTimes` é importado de `engines/finance/format` (SSOT).

export function IndicatorsTab() {
  const state = useFinanceState();
  // (I1+I9) Modelo central: regime efetivo + DRE + indicadores + CAGR memoizados.
  const { dre, ind, cagrReceitas12m } = useFinanceModel(state);

  // (I7) D&A é linha própria nos dois charts — padroniza classificação com o waterfall.
  const monthlyChart = useMemo(
    () =>
      MESES.map((m, i) => ({
        mes: m,
        Receita: dre.receitaLiquida[i],
        Operacionais: dre.cpv[i] + dre.despesasOperacionais[i],
        "D&A": dre.depreciacao[i],
        Financeiros: dre.custosFinanceirosTotal[i],
        Lucro: dre.lucroLiquido[i],
      })),
    [dre],
  );

  // B10: memoizar acumulado
  const acumulado = useMemo(
    () =>
      dre.lucroLiquido.reduce<{ mes: string; valor: number }[]>((acc, v, i) => {
        const last = i === 0 ? 0 : acc[i - 1].valor;
        acc.push({ mes: MESES[i], valor: last + v });
        return acc;
      }, []),
    [dre.lucroLiquido],
  );

  const costPie = useMemo(
    () =>
      Object.entries(dre.despesasPorCategoria)
        .map(([k, v]) => ({ name: k, value: sum(v) }))
        .filter((x) => x.value > 0)
        .sort((a, b) => b.value - a.value),
    [dre.despesasPorCategoria],
  );

  const cvLabel =
    state.businessType === "industria" ? "CPV" : state.businessType === "comercio" ? "CMV" : "CSP";
  const ll = sum(dre.lucroLiquido);

  const waterfall = useMemo(
    () => [
      { name: "Receita Bruta", value: sum(dre.receitaBruta) },
      { name: "− Imp. Vendas", value: -sum(dre.impostosVendas) },
      { name: `− ${cvLabel}`, value: -sum(dre.cpv) },
      { name: "− Desp. Op.", value: -sum(dre.despesasOperacionais) },
      { name: "− D&A", value: -sum(dre.depreciacao) },
      { name: "± Financ.", value: sum(dre.resultadoFinanceiro) },
      { name: "− IRPJ/CSLL", value: -sum(dre.impostos) },
      { name: "Lucro Líq.", value: ll },
    ],
    [dre, cvLabel, ll],
  );

  // Pré-calcula EBIT/EBITDA anuais para distinguir ∞ vs indefinido (B7)
  const ebitAnual = sum(dre.ebit);
  // (I3) Gate correto dos cards de produtividade: headcount > 0 (não valor calculado).
  const hasHeadcount = (state.numColaboradores ?? 0) > 0;
  const ebitdaAnual = sum(dre.ebitda);
  // cagrReceitas12m já vem em fração (0,15 = 15%); não dividir por 100.
  const cagrReceitas12mFmt = Number.isFinite(cagrReceitas12m) ? fmtPct(cagrReceitas12m) : "—";

  return (
    <div className="space-y-6">
      <HistoricalYearPills />
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

      <div className="rounded-lg border border-border/60 bg-card/40 p-5">
        <SectionTitle
          hint={{
            description:
              "Métricas-chave que sintetizam a saúde financeira da empresa. Cada card traz a definição e a fórmula usada no cálculo.",
          }}
        >
          Indicadores financeiros
        </SectionTitle>
        <div className="mt-4 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
          <Ind
            label="Margem Bruta"
            v={fmtPct(ind.margemBruta / 100)}
            desc="Quanto sobra da receita após pagar o custo direto do produto/serviço. Mede a eficiência da operação antes das despesas."
            formula="Lucro Bruto ÷ Receita Líquida × 100"
          />
          <Ind
            label="Margem EBITDA"
            v={fmtPct(ind.margemEbitda / 100)}
            desc="Quanto a operação gera de caixa antes de juros, impostos e depreciação. Mede a geração operacional 'pura'."
            formula="EBITDA ÷ Receita Líquida × 100"
          />
          <Ind
            label="Margem EBIT"
            v={fmtPct(ind.margemEbit / 100)}
            desc="Lucro operacional (após depreciação, antes de juros e impostos) sobre receita. Mede a rentabilidade da operação considerando o desgaste dos ativos."
            formula="EBIT ÷ Receita Líquida × 100"
          />
          <Ind
            label="Margem Líquida"
            v={fmtPct(ind.margemLiquida / 100)}
            desc="O lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos)."
            formula="Lucro Líquido ÷ Receita Líquida × 100"
          />
          <Ind
            label="Margem de Contribuição"
            v={fmtPct(ind.margemContribuicao / 100)}
            desc="Quanto cada R$ vendido contribui para pagar os custos fixos e gerar lucro. Quanto maior, mais resiliente é o negócio."
            formula="(Receita − Custos Variáveis) ÷ Receita × 100"
          />
          <Ind
            label="PE Operacional"
            v={fmtBRL(ind.pontoEquilibrioOperacional)}
            desc="Conceito clássico (Garrison/Horngren): receita mínima para cobrir custos fixos OPERACIONAIS (com depreciação, sem juros). Juros e impostos ficam abaixo do EBIT."
            formula="(Custos Fixos Op. + Depreciação) ÷ Margem de Contribuição"
          />
          <Ind
            label="PE Financeiro (caixa)"
            v={fmtBRL(ind.pontoEquilibrioFinanceiro)}
            desc="Receita mínima para cobrir DESEMBOLSOS operacionais — exclui depreciação (não-caixa) e juros (financeiro). Conceito clássico de break-even em caixa."
            formula="Custos Fixos Operacionais ÷ Margem de Contribuição"
          />
          <Ind
            label="PE Total (c/ juros)"
            v={fmtBRL(ind.pontoEquilibrio)}
            desc="Cobertura financeira completa: inclui juros como custo fixo recorrente. Visão da PME para 'não ter prejuízo' considerando o serviço da dívida."
            formula="(Custos Fixos Op. + Depreciação + Juros) ÷ Margem de Contribuição"
          />
          <Ind
            label="ROE"
            v={fmtPct(ind.roe / 100)}
            desc="Retorno sobre o Patrimônio Líquido. Usa PL MÉDIO ((abertura + final)/2, CFA/Damodaran) quando o PL de abertura é informado em Capital; caso contrário, usa PL fim de período (pode subestimar ROE em empresas em crescimento e superestimar em empresas com prejuízo acumulado)."
            formula="Lucro Líquido ÷ PL Médio × 100"
          />
          <Ind
            label="ROA"
            v={fmtPct(ind.roa / 100)}
            desc="Retorno sobre o Ativo Total. Usa Ativo Total MÉDIO ((abertura + final)/2, padrão CFA/Damodaran) quando o Ativo Total de abertura é informado em Capital; caso contrário, usa Ativo Total fim de período."
            formula="Lucro Líquido ÷ Ativo Total Médio × 100"
          />
          <Ind
            label="ROIC"
            v={fmtPct(ind.roic / 100)}
            tone={ind.roic >= ind.wacc ? "pos" : "neg"}
            desc="Retorno sobre o Capital Investido na operação. Se ROIC > WACC, a empresa CRIA valor; se ROIC < WACC, DESTRÓI valor."
            formula="NOPAT ÷ Capital Investido × 100  (NOPAT = EBIT × (1 − IR))"
          />
          <Ind
            label="WACC"
            v={fmtPct(ind.wacc / 100)}
            desc="Custo Médio Ponderado de Capital. É o retorno mínimo que a empresa precisa entregar para remunerar sócios e credores. Funciona como 'meta' do ROIC."
            formula="(E/V × Ke) + (D/V × Kd × (1 − IR))"
          />
          <Ind
            label="Liquidez Corrente"
            v={ind.liquidezCorrente.toFixed(2)}
            tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"}
            desc="Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. Acima de 1,0 indica folga; abaixo, aperto."
            formula="Ativo Circulante ÷ Passivo Circulante"
          />
          <Ind
            label="Liquidez Seca"
            v={ind.liquidezSeca.toFixed(2)}
            desc="Versão mais rigorosa da liquidez corrente: exclui estoques (que podem demorar a virar caixa). Ideal acima de 1,0."
            formula="(Ativo Circulante − Estoques) ÷ Passivo Circulante"
          />
          <Ind
            label="Liquidez Imediata"
            v={ind.liquidezImediata.toFixed(2)}
            desc="Capacidade de pagar dívidas de curto prazo IMEDIATAMENTE, só com dinheiro em caixa e aplicações."
            formula="Disponibilidades ÷ Passivo Circulante"
          />
          <Ind
            label={
              ind.endividamentoGeralDadosCompletos
                ? "Endividamento Geral"
                : "Endividamento Geral (estim.)"
            }
            v={`${fmtPct(ind.endividamentoGeral / 100)}${!ind.endividamentoGeralDadosCompletos ? " ⚠️" : ""}`}
            tone={ind.endividamentoGeral <= 60 ? "pos" : "neg"}
            desc={`Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro.${!ind.endividamentoGeralDadosCompletos ? " ⚠️ Ativo Total não informado em Capital — valor é ESTIMATIVA com base em (Dívida + PNO) ÷ (PL + Dívida + PNO). Preencha Ativo Total para o cálculo real." : ""}`}
            formula="Passivo Total ÷ Ativo Total × 100"
          />
          <Ind
            label="Cobertura de Juros"
            v={fmtTimes(ind.coberturaJuros, ebitAnual)}
            tone={ind.coberturaJuros >= 2 ? "pos" : "neg"}
            desc="Quantas vezes o lucro operacional cobre as despesas de juros. Abaixo de 2× é zona de risco."
            formula="EBIT ÷ Despesas Financeiras"
          />
          <Ind
            label="Giro do Ativo"
            v={`${ind.giroAtivo.toFixed(2)}×`}
            desc="Quantas vezes o ativo total 'gira' em vendas no ano. Mede eficiência: quanto maior, mais a empresa produz com o que tem."
            formula="Receita Líquida ÷ Ativo Total"
          />
          {(() => {
            const dl = leverageDisplay("ebitda", ind.dividaLiqEbitda, ind.dividaLiquida, ebitdaAnual);
            return (
              <Ind
                label={dl.label}
                v={dl.value}
                tone={dl.tone}
                chip={dl.chip}
                desc="Em quantos anos de geração de caixa (EBITDA) a empresa quitaria sua dívida líquida. Acima de 3× preocupa bancos."
                formula="(Dívida Total − Caixa) ÷ EBITDA"
              />
            );
          })()}
          {(() => {
            const dl = leverageDisplay("ebit", ind.dividaLiqEbit, ind.dividaLiquida, ebitAnual);
            return (
              <Ind
                label={dl.label}
                v={dl.value}
                tone={dl.tone}
                chip={dl.chip}
                desc="Quantos anos de lucro operacional (já líquido da depreciação) seriam necessários para quitar a dívida líquida. Mais conservador que Dívida/EBITDA."
                formula="(Dívida Total − Caixa) ÷ EBIT"
              />
            );
          })()}
          {(() => {
            const dl = leverageDisplay("pl", ind.dividaLiqPl, ind.dividaLiquida, state.capital.patrimonioLiquido);
            return (
              <Ind
                label={dl.label}
                v={dl.value}
                tone={dl.tone}
                chip={dl.chip}
                desc="Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio."
                formula="(Dívida Total − Caixa) ÷ Patrimônio Líquido"
              />
            );
          })()}
          <Ind
            label="Amortização do PL pelo Lucro"
            v={
              Number.isFinite(ind.amortizacaoPlPorLucro)
                ? `${ind.amortizacaoPlPorLucro.toFixed(1)} anos`
                : "—"
            }
            desc="Tempo (anos) para o lucro contábil acumulado igualar o Patrimônio Líquido. NÃO confundir com o Payback clássico — este indicador mede a velocidade de remuneração do capital próprio pelo lucro contábil."
            formula="Patrimônio Líquido ÷ Lucro Líquido Anual"
          />
          <Ind
            label="Payback (CAPEX)"
            v={
              Number.isFinite(ind.paybackCapex) && ind.paybackCapex > 0
                ? `${ind.paybackCapex.toFixed(1)} anos`
                : "—"
            }
            desc="Payback CLÁSSICO (conceito bancário): tempo para a geração de caixa recuperar o CAPEX total do ano. '—' quando não há CAPEX informado ou quando FCF ≤ 0."
            formula="CAPEX Anual ÷ FCF Operacional"
          />
          <Ind
            label="FCF estimado"
            v={fmtBRL(ind.fcf)}
            tone={ind.fcf >= 0 ? "pos" : "neg"}
            desc="Free Cash Flow operacional antes do CAPEX — geração de caixa após imposto operacional e variação de capital de giro."
            formula="NOPAT + D&A − Δ NCG"
          />
          <Ind
            label="CAGR Receitas 12m"
            v={cagrReceitas12mFmt}
            tone={
              Number.isFinite(cagrReceitas12m) ? (cagrReceitas12m >= 0 ? "pos" : "neg") : undefined
            }
            desc="Taxa de Crescimento Anual Composta (CAGR) da Receita Líquida ao longo dos 12 meses. Mostra o ritmo equivalente anualizado de crescimento entre o primeiro e o último mês com receita."
            formula="(Receita_fim ÷ Receita_início)^(12 ÷ meses) − 1"
          />
          <Ind
            label="GAO"
            v={ind.gao !== 0 ? `${ind.gao.toFixed(2)}×` : "—"}
            tone={ind.gao > 3 ? "warn" : ind.gao > 0 ? "pos" : undefined}
            desc="Grau de Alavancagem Operacional. Se a receita variar 1%, o EBIT varia GAO%. Quanto maior, mais sensível o lucro ao volume — bom em alta, perigoso em queda."
            formula="Margem de Contribuição (R$) ÷ EBIT"
          />
          <Ind
            label="Qualidade do Lucro"
            v={ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}×` : "—"}
            tone={ind.qualidadeLucro >= 1 ? "pos" : "neg"}
            desc="O lucro contábil está virando caixa? ≥1 saudável; <1 indica lucro 'no papel' (preso em NCG, inadimplência ou estoques)."
            formula="Fluxo de Caixa Operacional ÷ Lucro Líquido"
          />
          <Ind
            label="Faturamento / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.faturamentoPorColaborador) : "—"}
            desc="Receita BRUTA gerada por colaborador no ano — métrica clássica de benchmarking de produtividade. Ajuste o nº de colaboradores em Configurações Rápidas (sidebar)."
            formula="Receita Bruta ÷ Nº de Colaboradores"
          />
          <Ind
            label="Receita Líq. / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.receitaPorColaborador) : "—"}
            desc="Receita LÍQUIDA (após deduções e impostos sobre venda) por colaborador. Comparável entre regimes tributários."
            formula="Receita Líquida ÷ Nº de Colaboradores"
          />
          <Ind
            label="EBITDA / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.ebitdaPorColaborador) : "—"}
            tone={ind.ebitdaPorColaborador >= 0 ? "pos" : "neg"}
            desc="Geração operacional (EBITDA) por colaborador no ano. Mede o resultado operacional que cada pessoa do time produz, antes de juros, impostos e depreciação."
            formula="EBITDA ÷ Nº de Colaboradores"
          />
          <Ind
            label="Lucro / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.lucroPorColaborador) : "—"}
            tone={ind.lucroPorColaborador >= 0 ? "pos" : "neg"}
            desc="Lucro líquido gerado por colaborador no ano. Mede a conversão de mão de obra em resultado."
            formula="Lucro Líquido ÷ Nº de Colaboradores"
          />
          <Ind
            label="Folha / Receita"
            v={ind.custoPessoalSobreReceita > 0 ? fmtPct(ind.custoPessoalSobreReceita / 100) : "—"}
            tone={
              ind.custoPessoalSobreReceita > 35
                ? "neg"
                : ind.custoPessoalSobreReceita > 0
                  ? "pos"
                  : undefined
            }
            desc="Peso da folha total (CLT + pró-labore + MOD, com encargos) sobre a receita. Acima de 35% acende alerta em serviços."
            formula="Folha Total Anual ÷ Receita Bruta × 100"
          />
          <Ind
            label="Margem de Segurança"
            v={ind.margemSeguranca !== 0 ? fmtPct(ind.margemSeguranca / 100) : "—"}
            tone={ind.margemSeguranca >= 25 ? "pos" : ind.margemSeguranca >= 10 ? "warn" : "neg"}
            desc="Folga entre a receita atual e o Ponto de Equilíbrio. >25% confortável; 10–25% atenção; <10% zona crítica — pequenas quedas de receita já geram prejuízo."
            formula="(Receita − Ponto de Equilíbrio) ÷ Receita × 100"
          />
          <Ind
            label="DSCR (Serviço da Dívida)"
            v={
              ind.dscr !== 0
                ? `${ind.dscr.toFixed(2)}×${!ind.dscrAmortizacoesInformadas && ind.dividaOnerosa > 0 ? " ⚠️" : ""}`
                : "—"
            }
            tone={ind.dscr >= 1.5 ? "pos" : ind.dscr >= 1.25 ? "warn" : "neg"}
            desc={`Quantas vezes o EBITDA cobre o serviço total da dívida (juros + amortização do principal). Bancos exigem ≥1,25× para renovar giro; ≥1,50× destrava melhores linhas.${!ind.dscrAmortizacoesInformadas && ind.dividaOnerosa > 0 ? " ⚠️ Amortizações de principal não informadas no Fluxo de Caixa — DSCR exibido equivale à Cobertura de Juros e pode estar SUPERESTIMADO." : ""}`}
            formula="EBITDA ÷ (Juros + Amortizações de Principal)"
          />
          <Ind
            label="Impostos / Receita"
            v={fmtPct(ind.impostosSobreReceita / 100)}
            tone={
              ind.impostosSobreReceita > 30
                ? "neg"
                : ind.impostosSobreReceita > 0
                  ? "pos"
                  : undefined
            }
            desc="Carga tributária TOTAL (impostos sobre vendas + IRPJ/CSLL) sobre a Receita Bruta. Mede o peso fiscal completo do negócio — útil para comparar regimes (Simples × Presumido × Real) e impacto da Reforma (CBS/IBS)."
            formula="(Impostos s/ Vendas + IRPJ/CSLL) ÷ Receita Bruta × 100"
          />
          <Ind
            label="Impostos / Lucro Líquido"
            v={ind.impostosSobreLucro !== 0 ? fmtPct(ind.impostosSobreLucro / 100) : "—"}
            tone={
              ind.impostosSobreLucro > 100
                ? "neg"
                : ind.impostosSobreLucro > 0
                  ? "warn"
                  : undefined
            }
            desc="Quanto a empresa paga de impostos TOTAIS para cada R$ 1,00 de lucro líquido gerado. Acima de 100% indica que o fisco leva mais do que sobra para os sócios — sinal de regime tributário ineficiente."
            formula="(Impostos s/ Vendas + IRPJ/CSLL) ÷ Lucro Líquido × 100"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Receita × Custos × Lucro (mensal)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Receita" fill="#00E5A0" />
              <Bar dataKey="Operacionais" fill="#FF6B6B" />
              <Bar dataKey="D&A" fill="#C77DFF" />
              <Bar dataKey="Financeiros" fill="#F5B85B" />
              <Bar dataKey="Lucro" fill="#5BA8F5" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Resultado acumulado (lucro líquido)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={acumulado}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Line
                type="monotone"
                dataKey="valor"
                stroke="#00E5A0"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Composição de despesas operacionais (anual)">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={costPie} dataKey="value" nameKey="name" outerRadius="80%" innerRadius="45%">
                {costPie.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Da receita ao lucro líquido (waterfall)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={waterfall}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={11} />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM}
                labelStyle={TOOLTIP_LABEL}
                formatter={(v: number) => fmtBRL(v)}
              />
              <Bar dataKey="value">
                {waterfall.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0 ? "#00E5A0" : "#FF6B6B"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function Ind({
  label,
  v,
  desc,
  formula,
  tone,
  chip,
}: {
  label: string;
  v: string;
  desc?: string;
  formula?: string;
  tone?: "pos" | "neg" | "warn";
  chip?: string | null;
}) {
  const cls =
    tone === "pos"
      ? "text-pos"
      : tone === "neg"
        ? "text-neg"
        : tone === "warn"
          ? "text-[var(--warning)]"
          : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label} {desc && <HelpTip text={desc} formula={formula} />}
        {chip && (
          <span className="ml-auto rounded-full bg-pos/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-pos">
            {chip}
          </span>
        )}
      </div>
      <div className={`mono mt-1 text-lg font-semibold ${cls}`}>{v}</div>
    </div>
  );
}

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
