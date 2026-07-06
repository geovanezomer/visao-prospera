import { AppState } from "@/engines/finance/types";
import { useFinanceModel } from "@/engines/finance/useFinanceModel";
import { fmtBRL, fmtPct, fmtTimes, sum } from "@/engines/finance/format";
import { HelpTip, SectionTitle } from "@/components/sim/shared/primitives";
import { leverageDisplay } from "@/components/sim/shared/leverageLabel";
import { buildIndicatorCalcs } from "@/engines/finance/indicatorCalc";
import { DSCR_THRESHOLDS } from "@/engines/finance/indicators";
import { getDistribuicaoRealizadaMeses } from "@/engines/finance/socios";

// SSOT visual dos indicadores financeiros.
// Renderizado IDENTICAMENTE na página Indicadores (IndicatorsTab) e no
// card do Simulador (IndicatorsCard). Cálculos vêm de `useFinanceModel`
// (SSOT de dados). Memória de cálculo (string resolvida) vem de
// `buildIndicatorCalcs` — SSOT de exibição. Qualquer ajuste em
// label/descrição/fórmula/tone é feito SOMENTE aqui.
export function IndicatorsGrid({ state }: { state: AppState }) {
  const { dre, ind, cf, cagrReceitas12m, model } = useFinanceModel(state);

  const ebitAnual = sum(dre.ebit);
  const ebitdaAnual = sum(dre.ebitda);
  const hasHeadcount = (state.numColaboradores ?? 0) > 0;
  // cagrReceitas12m já vem em fração (0,15 = 15%); não dividir por 100.
  const cagrReceitas12mFmt = Number.isFinite(cagrReceitas12m) ? fmtPct(cagrReceitas12m) : "—";

  // Memória de cálculo — SSOT para todos os cards.
  const c = buildIndicatorCalcs(state, dre, ind, cagrReceitas12m);






  // ─── Análise Tributária — métricas adicionais ───
  // Carga Tributária Efetiva: total de tributos (s/ vendas + IRPJ/CSLL) ÷ Receita Bruta.
  const receitaBrutaAnual = sum(dre.receitaBruta);
  const totalTributos = sum(dre.impostosTotal);
  const cargaTribEfetiva = receitaBrutaAnual > 0 ? (totalTributos / receitaBrutaAnual) * 100 : 0;
  const cargaTribEfetivaCalc =
    receitaBrutaAnual > 0
      ? `${fmtBRL(totalTributos)} ÷ ${fmtBRL(receitaBrutaAnual)} × 100 = ${fmtPct(cargaTribEfetiva / 100)}`
      : "Receita Bruta = 0 → indicador indisponível";

  // Distribuição Isenta / Lucro Líquido — % do lucro distribuído sem IRPF (isenção PJ→PF).
  const distribuicaoTotalAnual = sum(getDistribuicaoRealizadaMeses(state));
  const llAnual = sum(dre.lucroLiquido);
  const distIsentaSobreLucro = llAnual > 0 ? (distribuicaoTotalAnual / llAnual) * 100 : 0;
  const distIsentaCalc =
    llAnual > 0
      ? `${fmtBRL(distribuicaoTotalAnual)} ÷ ${fmtBRL(llAnual)} × 100 = ${fmtPct(distIsentaSobreLucro / 100)}`
      : "Lucro Líquido ≤ 0 → indicador indisponível";

  // ─── Análises de Fluxo de Caixa ───
  // FCO (Método Indireto): LL + D&A ± ΔNCG — base do CPC 03 / IAS 7.
  // Usa o MESMO valor consumido pelo FluxoCaixaTab (SSOT cf.fluxoOperacional).
  const fcoAnual = sum(cf.fluxoOperacional);
  const llAnualFco = sum(dre.lucroLiquido);
  const daAnual = sum(dre.depreciacao);
  // ΔNCG conforme CPC 03/IAS 7 (método indireto): positivo = NCG cresceu
  // e CONSUMIU caixa; negativo = NCG diminuiu e LIBEROU caixa.
  // Identidade: FCO = LL + D&A − ΔNCG  →  ΔNCG = LL + D&A − FCO.
  const deltaNcgAnual = llAnualFco + daAnual - fcoAnual;
  const fcoCalc = `${fmtBRL(llAnualFco)} + ${fmtBRL(daAnual)} − ${fmtBRL(deltaNcgAnual)} = ${fmtBRL(fcoAnual)}`;

  const receitaLiquidaAnual = sum(dre.receitaLiquida);
  const margemCaixaOp = receitaLiquidaAnual > 0 ? (fcoAnual / receitaLiquidaAnual) * 100 : 0;
  const margemCaixaOpCalc =
    receitaLiquidaAnual > 0
      ? `${fmtBRL(fcoAnual)} ÷ ${fmtBRL(receitaLiquidaAnual)} × 100 = ${fmtPct(margemCaixaOp / 100)}`
      : "Receita Líquida = 0 → indicador indisponível";



  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <SectionTitle
        hint={{
          description:
            "Métricas-chave que sintetizam a saúde financeira da empresa. Cada card traz a definição e a fórmula usada no cálculo.",
        }}
      >
        Indicadores financeiros
      </SectionTitle>
      <div className="mt-4 space-y-6">
        {/* ───── Análise de Lucro (Margens) ───── */}
        <Group title="Análise de Lucro (Margens)">
          <Ind
            label="Margem Bruta"
            v={fmtPct(ind.margemBruta / 100)}
            desc="Quanto sobra da receita após pagar o custo direto do produto/serviço. Mede a eficiência da operação antes das despesas."
            formula="Lucro Bruto ÷ Receita Líquida × 100"
            calc={c.margemBruta}
          />
          <Ind
            label="Margem EBITDA"
            v={fmtPct(ind.margemEbitda / 100)}
            desc="Quanto a operação gera de caixa antes de juros, impostos e depreciação. Mede a geração operacional 'pura'."
            formula="EBITDA ÷ Receita Líquida × 100"
            calc={c.margemEbitda}
          />
          <Ind
            label="Margem Líquida"
            v={fmtPct(ind.margemLiquida / 100)}
            desc="O lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos)."
            formula="Lucro Líquido ÷ Receita Líquida × 100"
            calc={c.margemLiquida}
          />
          <Ind
            label="Margem de Contribuição"
            v={fmtPct(ind.margemContribuicao / 100)}
            desc="Quanto cada R$ vendido contribui para pagar os custos fixos e gerar lucro. Quanto maior, mais resiliente é o negócio."
            formula="(Receita − Custos Variáveis) ÷ Receita × 100"
            calc={c.margemContribuicao}
          />
        </Group>

        {/* ───── Análises de Fluxo de Caixa ───── */}
        <Group title="Análises Fluxo de Caixa">
          <Ind
            label="FCO (Método Indireto)"
            v={fmtBRL(fcoAnual)}
            tone={fcoAnual >= 0 ? "pos" : "neg"}
            desc="Fluxo de Caixa Operacional pelo método indireto (CPC 03 / IAS 7): parte do Lucro Líquido, soma itens não-caixa (D&A) e ajusta pela variação de NCG. É a base de tudo — mostra quanto caixa a operação de fato gera."
            formula="Lucro Líquido + Depreciação/Amortização ± Δ NCG"
            calc={fcoCalc}
          />
          <Ind
            label="Margem de Caixa Operacional"
            v={receitaLiquidaAnual > 0 ? fmtPct(margemCaixaOp / 100) : "—"}
            tone={margemCaixaOp >= 0 ? "pos" : "neg"}
            desc="Equivalente 'em caixa' da margem operacional: quantos centavos de caixa cada R$ 1,00 de Receita Líquida efetivamente converte. Comparar com a Margem EBITDA evidencia o quanto a NCG está 'comendo' a geração operacional."
            formula="FCO ÷ Receita Líquida × 100"
            calc={margemCaixaOpCalc}
          />
          <Ind
            label="FCF estimado"
            v={fmtBRL(ind.fcf)}
            tone={ind.fcf >= 0 ? "pos" : "neg"}
            desc="Free Cash Flow operacional antes do CAPEX — geração de caixa após imposto operacional e variação de capital de giro."
            formula="NOPAT + D&A − Δ NCG"
            calc={c.fcf}
          />
          <Ind
            label="Qualidade do Lucro"
            v={ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}×` : "—"}
            // Só aplica cor quando existe valor — evita pintar "—" de vermelho
            // quando LL ≤ 0 (indicador indisponível, não "ruim").
            tone={ind.qualidadeLucro === 0 ? undefined : ind.qualidadeLucro >= 1 ? "pos" : "neg"}
            desc="O lucro contábil está virando caixa? ≥1 saudável; <1 indica lucro 'no papel' (preso em NCG, inadimplência ou estoques)."
            formula="Fluxo de Caixa Operacional ÷ Lucro Líquido"
            calc={c.qualidadeLucro}
          />
        </Group>

        {/* ───── Análise de Ponto de Equilíbrio ───── */}

        <Group title="Análise de Ponto de Equilíbrio">
          <Ind
            label="PE Operacional"
            v={fmtBRL(ind.pontoEquilibrioOperacional)}
            desc="Conceito clássico (Garrison/Horngren): receita mínima para cobrir custos fixos OPERACIONAIS (com depreciação, sem juros). Juros e impostos ficam abaixo do EBIT."
            formula="(Custos Fixos Op. + Depreciação) ÷ Margem de Contribuição"
            calc={c.pontoEquilibrioOperacional}
          />
          <Ind
            label="PE Financeiro (caixa)"
            v={fmtBRL(ind.pontoEquilibrioFinanceiro)}
            desc="Receita mínima para cobrir DESEMBOLSOS operacionais — exclui depreciação (não-caixa) e juros (financeiro). Conceito clássico de break-even em caixa."
            formula="Custos Fixos Operacionais ÷ Margem de Contribuição"
            calc={c.pontoEquilibrioFinanceiro}
          />
          <Ind
            label="PE Total (c/ juros)"
            v={fmtBRL(ind.pontoEquilibrio)}
            desc="Cobertura financeira completa: inclui juros como custo fixo recorrente. Visão da PME para 'não ter prejuízo' considerando o serviço da dívida."
            formula="(Custos Fixos Op. + Depreciação + Juros) ÷ Margem de Contribuição"
            calc={c.pontoEquilibrioTotal}
          />
          <Ind
            label="Margem de Segurança"
            v={ind.margemSeguranca !== 0 ? fmtPct(ind.margemSeguranca / 100) : "—"}
            tone={ind.margemSeguranca >= 25 ? "pos" : ind.margemSeguranca >= 10 ? "warn" : "neg"}
            desc="Folga entre a receita atual e o Ponto de Equilíbrio. >25% confortável; 10–25% atenção; <10% zona crítica — pequenas quedas de receita já geram prejuízo."
            formula="(Receita − Ponto de Equilíbrio) ÷ Receita × 100"
            calc={c.margemSeguranca}
          />
        </Group>

        {/* ───── Análise de Retorno sobre Capital ───── */}
        <Group title="Análise de Retorno sobre Capital">
          <Ind
            label="ROE"
            v={ind.roe == null ? "N/A — PL negativo" : fmtPct(ind.roe / 100)}
            desc="Retorno sobre o Patrimônio Líquido. Usa PL MÉDIO ((abertura + final)/2, CFA/Damodaran) com o PL de abertura completo (Capital Social + Reservas + Lucros Acumulados) obtido do SSOT da abertura. Quando PL médio ≤ 0 (passivo a descoberto), exibe N/A — a métrica perde significado."
            formula="Lucro Líquido ÷ PL Médio × 100"
            calc={c.roe}
          />
          <Ind
            label="ROA"
            v={fmtPct(ind.roa / 100)}
            desc="Retorno sobre o Ativo Total. Usa Ativo Total MÉDIO ((abertura + final)/2, padrão CFA/Damodaran) quando o Ativo Total de abertura é informado em Capital; caso contrário, usa Ativo Total fim de período."
            formula="Lucro Líquido ÷ Ativo Total Médio × 100"
            calc={c.roa}
          />
          <Ind
            label="ROIC"
            v={fmtPct(ind.roic / 100)}
            tone={ind.roic >= ind.wacc ? "pos" : "neg"}
            desc="Retorno sobre o Capital Investido na operação. Se ROIC > WACC, a empresa CRIA valor; se ROIC < WACC, DESTRÓI valor."
            formula="NOPAT ÷ Capital Investido × 100  (NOPAT = EBIT × (1 − IR))"
            calc={c.roic}
          />
          <Ind
            label="WACC"
            v={fmtPct(ind.wacc / 100)}
            desc="Custo Médio Ponderado de Capital. É o retorno mínimo que a empresa precisa entregar para remunerar sócios e credores. Funciona como 'meta' do ROIC."
            formula="(E/V × Ke) + (D/V × Kd × (1 − IR))"
            calc={c.wacc}
          />
        </Group>

        {/* ───── Análise de Liquidez ───── */}
        <Group title="Análise de Liquidez">
          <Ind
            label="Liquidez Corrente"
            v={ind.liquidezCorrente.toFixed(2)}
            tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"}
            desc="Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. Acima de 1,0 indica folga; abaixo, aperto."
            formula="Ativo Circulante ÷ Passivo Circulante"
            calc={c.liquidezCorrente}
          />
          <Ind
            label="Liquidez Seca"
            v={ind.liquidezSeca.toFixed(2)}
            desc="Versão mais rigorosa da liquidez corrente: exclui estoques (que podem demorar a virar caixa). Ideal acima de 1,0."
            formula="(Ativo Circulante − Estoques) ÷ Passivo Circulante"
            calc={c.liquidezSeca}
          />
          <Ind
            label="Liquidez Imediata"
            v={ind.liquidezImediata.toFixed(2)}
            desc="Capacidade de pagar dívidas de curto prazo IMEDIATAMENTE, só com dinheiro em caixa e aplicações."
            formula="Disponibilidades ÷ Passivo Circulante"
            calc={c.liquidezImediata}
          />
          <Ind
            label="Liquidez Geral"
            v={ind.liquidezGeral.toFixed(2)}
            tone={ind.liquidezGeral >= 1 ? "pos" : "neg"}
            desc="Capacidade total de honrar todas as dívidas (curto + longo prazo) com todos os ativos circulantes. Acima de 1,0 indica solvência estrutural; abaixo, dependência de refinanciamento."
            formula="Ativo Circulante ÷ (Ativo Total − PL)"
            calc={c.liquidezGeral}
          />
        </Group>

        {/* ───── Análise de Dívida e Cobertura ───── */}
        <Group title="Análise de Dívida e Cobertura">
          <Ind
            label={
              ind.endividamentoGeralDadosCompletos
                ? "Endividamento Geral"
                : "Endividamento Geral (estim.)"
            }
            v={`${fmtPct(ind.endividamentoGeral / 100)}${!ind.endividamentoGeralDadosCompletos ? " ⚠️" : ""}`}
            tone={ind.endividamentoOneroso <= 60 ? "pos" : "neg"}
            desc={`Percentual do ativo financiado por passivo total (operacional + oneroso). O gatilho de risco usa a fatia ONEROSA — ${fmtPct(ind.endividamentoOneroso / 100)} de dívida financeira. Empresa sem dívida bancária pode ter passivo operacional saudável (fornecedores, impostos, folha) sem que isso configure alavancagem financeira.${!ind.endividamentoGeralDadosCompletos ? " ⚠️ Balanço detalhado ausente — valor é ESTIMATIVA. Preencha o Balanço para o cálculo real." : ""}`}
            formula="Passivo Total ÷ Ativo Total × 100"
            calc={c.endividamentoGeral}
          />
          <Ind
            label="Endividamento Oneroso"
            v={fmtPct(ind.endividamentoOneroso / 100)}
            tone={ind.endividamentoOneroso <= 40 ? "pos" : ind.endividamentoOneroso <= 60 ? "warn" : "neg"}
            desc="Só dívida FINANCEIRA (bancos, financiamentos, debêntures) sobre o ativo total. Métrica que banco/investidor lê para julgar alavancagem — 0% = empresa sem dívida onerosa."
            formula="Dívida Onerosa ÷ Ativo Total × 100"
          />
          <Ind
            label="Amortização do PL pelo Lucro"
            v={
              Number.isFinite(ind.amortizacaoPlPorLucro)
                ? `${ind.amortizacaoPlPorLucro.toFixed(1)} anos`
                : "—"
            }
            desc="Tempo (anos) para o lucro contábil acumulado igualar o Patrimônio Líquido. NÃO confundir com o Payback clássico — este indicador mede a velocidade de remuneração do capital próprio pelo lucro contábil."
            formula="Patrimônio Líquido ÷ Lucro Líquido Anual"
            calc={c.amortizacaoPlPorLucro}
          />

          <Ind
            label="Capital Próprio"
            v={`${ind.proprioPercent.toFixed(1)}%`}
            tone={ind.proprioPercent >= 50 ? "pos" : ind.proprioPercent >= 30 ? "warn" : "neg"}
            desc="Participação do PL no financiamento total da empresa."
            formula="PL ÷ (PL + Dívida Onerosa) × 100"
            calc={c.capitalProprio}
          />
          <Ind
            label="Cobertura de Juros"
            v={fmtTimes(ind.coberturaJuros, ebitAnual)}
            tone={ind.coberturaJuros >= 2 ? "pos" : "neg"}
            desc="Quantas vezes o lucro operacional cobre as despesas de juros. Abaixo de 2× é zona de risco."
            formula="EBIT ÷ Despesas Financeiras"
            calc={c.coberturaJuros}
          />
          {(() => {
            // Sempre renderiza os 3 múltiplos de alavancagem (EBITDA, EBIT, PL).
            // `leverageDisplay` já trata cash-rich por métrica (Dívida Líq < 0 → "Posição Líquida de Caixa").
            const dlEbitda = leverageDisplay("ebitda", ind.dividaLiqEbitda, ind.dividaLiquida, ebitdaAnual);
            const dlEbit = leverageDisplay("ebit", ind.dividaLiqEbit, ind.dividaLiquida, ebitAnual);
            const dlPl = leverageDisplay("pl", ind.dividaLiqPl, ind.dividaLiquida, state.capital.patrimonioLiquido);
            return (
              <>
                <Ind
                  label={dlEbitda.label}
                  v={dlEbitda.value}
                  tone={dlEbitda.tone}
                  chip={dlEbitda.chip}
                  desc={dlEbitda.desc ?? "Em quantos anos de geração de caixa (EBITDA) a empresa quitaria sua dívida líquida. Acima de 3× preocupa bancos."}
                  formula={dlEbitda.formula ?? "(Dívida Onerosa − Disponibilidades) ÷ EBITDA"}
                  calc={c.dividaLiqEbitda}
                />
                <Ind
                  label={dlEbit.label}
                  v={dlEbit.value}
                  tone={dlEbit.tone}
                  chip={dlEbit.chip}
                  desc={dlEbit.desc ?? "Quantos anos de lucro operacional (já líquido da depreciação) seriam necessários para quitar a dívida líquida. Mais conservador que Dívida/EBITDA."}
                  formula={dlEbit.formula ?? "(Dívida Onerosa − Disponibilidades) ÷ EBIT"}
                  calc={c.dividaLiqEbit}
                />
                <Ind
                  label={dlPl.label}
                  v={dlPl.value}
                  tone={dlPl.tone}
                  chip={dlPl.chip}
                  desc={dlPl.desc ?? "Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio."}
                  formula={dlPl.formula ?? "(Dívida Onerosa − Disponibilidades) ÷ Patrimônio Líquido"}
                  calc={c.dividaLiqPl}
                />
              </>
            );
          })()}
          <Ind
            label="DSCR (Serviço da Dívida)"
            v={
              ind.dscr !== 0
                ? `${ind.dscr.toFixed(2)}×${!ind.dscrAmortizacoesInformadas && ind.dividaOnerosa > 0 ? " ⚠️" : ""}`
                : "—"
            }
            tone={ind.dscr >= DSCR_THRESHOLDS.covenant ? "pos" : ind.dscr >= DSCR_THRESHOLDS.warn ? "warn" : "neg"}
            desc={`Quantas vezes o EBITDA cobre o serviço total da dívida (juros + amortização do principal). Bancos exigem ≥1,25× para renovar giro; ≥1,50× destrava melhores linhas.${!ind.dscrAmortizacoesInformadas && ind.dividaOnerosa > 0 ? " ⚠️ Amortizações de principal não informadas no Fluxo de Caixa — DSCR exibido equivale à Cobertura de Juros e pode estar SUPERESTIMADO." : ""}`}
            formula="EBITDA ÷ (Juros + Amortizações de Principal)"
            calc={c.dscr}
          />
        </Group>

        {/* ───── Análise de Crescimento e Eficiência ───── */}
        <Group title="Análise de Crescimento e Eficiência">
          <Ind
            label="CAGR Receitas 12m"
            v={cagrReceitas12mFmt}
            tone={
              Number.isFinite(cagrReceitas12m) ? (cagrReceitas12m >= 0 ? "pos" : "neg") : undefined
            }
            desc="Taxa de Crescimento Anual Composta (CAGR) da Receita Líquida ao longo dos 12 meses. Mostra o ritmo equivalente anualizado de crescimento entre o primeiro e o último mês com receita."
            formula="(Receita_fim ÷ Receita_início)^(12 ÷ meses) − 1"
            calc={c.cagrReceitas12m}
          />
          <Ind
            label="Giro do Ativo"
            v={`${ind.giroAtivo.toFixed(2)}×`}
            desc="Quantas vezes o ativo total 'gira' em vendas no ano. Usa Ativo Total MÉDIO (consistente com ROA) quando o valor de abertura é informado em Capital."
            formula="Receita Líquida ÷ Ativo Total Médio"
            calc={c.giroAtivo}
          />
          <Ind
            label="GAO"
            v={ind.gao !== 0 ? `${ind.gao.toFixed(2)}×` : "—"}
            tone={ind.gao > 3 ? "warn" : ind.gao > 0 ? "pos" : undefined}
            desc="Grau de Alavancagem Operacional. Se a receita variar 1%, o EBIT varia GAO%. Quanto maior, mais sensível o lucro ao volume — bom em alta, perigoso em queda."
            formula="Margem de Contribuição (R$) ÷ EBIT"
            calc={c.gao}
          />
          <Ind
            label="GAF"
            v={ind.gaf !== 0 ? `${ind.gaf.toFixed(2)}×` : "—"}
            tone={ind.gaf > 2 ? "warn" : ind.gaf > 0 ? "pos" : undefined}
            desc="Grau de Alavancagem Financeira. Mede o efeito da dívida sobre o lucro líquido: se o EBIT variar 1%, o lucro varia GAF%. GAF=1 → sem alavancagem; >1 → dívida amplifica o resultado (bom em alta, perigoso em queda); indefinido quando os juros consomem todo o EBIT (LAIR ≤ 0)."
            formula="EBIT ÷ LAIR  (LAIR = EBIT − Despesas Financeiras)"
            calc={c.gaf}
          />
        </Group>

        {/* ───── Análise de Produtividade (Pessoas) ───── */}
        <Group title="Análise de Produtividade (Pessoas)">
          <Ind
            label="Receita Líq. / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.receitaPorColaborador) : "—"}
            desc="Receita LÍQUIDA (após deduções e impostos sobre venda) por colaborador. Comparável entre regimes tributários."
            formula="Receita Líquida ÷ Nº de Colaboradores"
            calc={c.receitaPorColaborador}
          />
          <Ind
            label="EBITDA / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.ebitdaPorColaborador) : "—"}
            tone={ind.ebitdaPorColaborador >= 0 ? "pos" : "neg"}
            desc="Geração operacional (EBITDA) por colaborador no ano. Mede o resultado operacional que cada pessoa do time produz, antes de juros, impostos e depreciação."
            formula="EBITDA ÷ Nº de Colaboradores"
            calc={c.ebitdaPorColaborador}
          />
          <Ind
            label="Lucro / Colaborador"
            v={hasHeadcount ? fmtBRL(ind.lucroPorColaborador) : "—"}
            tone={ind.lucroPorColaborador >= 0 ? "pos" : "neg"}
            desc="Lucro líquido gerado por colaborador no ano. Mede a conversão de mão de obra em resultado."
            formula="Lucro Líquido ÷ Nº de Colaboradores"
            calc={c.lucroPorColaborador}
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
            calc={c.folhaSobreReceita}
          />
        </Group>

        {/* ───── Análise Tributária ───── */}
        <Group title="Análise Tributária">
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
            calc={c.impostosSobreReceita}
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
            calc={c.impostosSobreLucro}
          />
          <Ind
            label="Carga Tributária Efetiva"
            v={receitaBrutaAnual > 0 ? fmtPct(cargaTribEfetiva / 100) : "—"}
            tone={
              cargaTribEfetiva > 30 ? "neg" : cargaTribEfetiva > 0 ? "pos" : undefined
            }
            desc="Total de tributos (impostos sobre vendas + IRPJ/CSLL) sobre a Receita Bruta. Mais correto que usar Receita Líquida, pois muitos tributos incidem sobre o bruto. Mede o peso fiscal real do negócio."
            formula="Total de Tributos ÷ Receita Bruta × 100"
            calc={cargaTribEfetivaCalc}
          />
          <Ind
            label="Distribuição Isenta / Lucro Líquido"
            v={llAnual > 0 ? fmtPct(distIsentaSobreLucro / 100) : "—"}
            tone={llAnual > 0 ? (distIsentaSobreLucro > 0 ? "pos" : undefined) : undefined}
            desc="Percentual do lucro líquido que foi distribuído aos sócios via distribuição de lucros — atualmente isenta de IRPF (PJ→PF). Quanto maior, mais eficiente fiscalmente está a remuneração do sócio."
            formula="Distribuição de Lucros Realizada ÷ Lucro Líquido × 100"
            calc={distIsentaCalc}
          />
        </Group>

      </div>
    </div>
  );
}

// Subseção visual: título sutil + grid de cards. Padroniza o agrupamento
// por tipo de análise dentro do card "Indicadores financeiros".
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90">
        {title}
      </h4>
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}


function Ind({
  label,
  v,
  desc,
  formula,
  calc,
  tone,
  chip,
}: {
  label: string;
  v: string;
  desc?: string;
  formula?: string;
  calc?: string;
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
        <span>{label}</span>{" "}
        {desc && <HelpTip text={desc} formula={formula} calc={calc} />}
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

