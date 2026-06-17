import { AppState } from "@/lib/finance/types";
import { useFinanceModel } from "@/lib/finance/useFinanceModel";
import { fmtBRL, fmtPct, sum } from "@/lib/finance/format";
import { HelpTip, SectionTitle } from "./primitives";

// Card de indicadores usado no Simulador.
// IMPORTANTE: deve refletir EXATAMENTE os mesmos indicadores da página
// INDICADORES (IndicatorsTab). Reflete o estado simulado recebido em props.
function fmtTimes(v: number, base: number, decimals = 1): string {
  if (base <= 0) return "—";
  return `${v.toFixed(decimals)}×`;
}

export function IndicatorsCard({ state }: { state: AppState }) {
  // (I1) Regime efetivo + (I9) modelo central memoizado (DRE+ind+cagr).
  const { dre, ind, cagrReceitas12m } = useFinanceModel(state);

  // Anuais para distinguir ∞ vs indefinido (mesmo critério da página Indicadores).
  const ebitAnual = sum(dre.ebit);
  const ebitdaAnual = sum(dre.ebitda);
  const hasHeadcount = (state.numColaboradores ?? 0) > 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <SectionTitle hint={{ description: "Métricas-chave que sintetizam a saúde financeira da empresa. Cada card traz a definição e a fórmula usada no cálculo." }}>
        Indicadores financeiros
      </SectionTitle>
      <div className="mt-4 grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        <Ind label="Margem Bruta" v={fmtPct(ind.margemBruta / 100)} desc="Quanto sobra da receita após pagar o custo direto do produto/serviço. Mede a eficiência da operação antes das despesas." formula="Lucro Bruto ÷ Receita Líquida × 100" />
        <Ind label="Margem EBITDA" v={fmtPct(ind.margemEbitda / 100)} desc="Quanto a operação gera de caixa antes de juros, impostos e depreciação. Mede a geração operacional 'pura'." formula="EBITDA ÷ Receita Líquida × 100" />
        <Ind label="Margem EBIT" v={fmtPct(ind.margemEbit / 100)} desc="Lucro operacional (após depreciação, antes de juros e impostos) sobre receita. Mede a rentabilidade da operação considerando o desgaste dos ativos." formula="EBIT ÷ Receita Líquida × 100" />
        <Ind label="Margem Líquida" v={fmtPct(ind.margemLiquida / 100)} desc="O lucro que efetivamente sobra para os sócios, após tudo pago (custos, despesas, juros e impostos)." formula="Lucro Líquido ÷ Receita Líquida × 100" />
        <Ind label="Margem de Contribuição" v={fmtPct(ind.margemContribuicao / 100)} desc="Quanto cada R$ vendido contribui para pagar os custos fixos e gerar lucro. Quanto maior, mais resiliente é o negócio." formula="(Receita − Custos Variáveis) ÷ Receita × 100" />
        <Ind label="PE Operacional" v={fmtBRL(ind.pontoEquilibrioOperacional)} desc="Conceito clássico (Garrison/Horngren): custos fixos operacionais com depreciação, sem juros." formula="(Custos Fixos Op. + Depreciação) ÷ Margem de Contribuição" />
        <Ind label="PE Financeiro (caixa)" v={fmtBRL(ind.pontoEquilibrioFinanceiro)} desc="Receita mínima para cobrir desembolsos operacionais — sem depreciação e sem juros." formula="Custos Fixos Operacionais ÷ Margem de Contribuição" />
        <Ind label="PE Total (c/ juros)" v={fmtBRL(ind.pontoEquilibrio)} desc="Cobertura financeira completa — inclui juros como custo fixo recorrente." formula="(Custos Fixos Op. + Depreciação + Juros) ÷ Margem de Contribuição" />
        <Ind label="ROE" v={fmtPct(ind.roe / 100)} desc="Usa PL médio quando o PL de abertura é informado; caso contrário, PL fim de período." formula="Lucro Líquido ÷ PL Médio × 100" />
        <Ind label="ROA" v={fmtPct(ind.roa / 100)} desc="Retorno sobre o Ativo Total. Mostra a eficiência da empresa em gerar lucro com todos os seus recursos (próprios + terceiros)." formula="Lucro Líquido ÷ Ativo Total × 100" />
        <Ind label="ROIC" v={fmtPct(ind.roic / 100)} tone={ind.roic >= ind.wacc ? "pos" : "neg"} desc="Retorno sobre o Capital Investido na operação. Se ROIC > WACC, a empresa CRIA valor; se ROIC < WACC, DESTRÓI valor." formula="NOPAT ÷ Capital Investido × 100  (NOPAT = EBIT × (1 − IR))" />
        <Ind label="WACC" v={fmtPct(ind.wacc / 100)} desc="Custo Médio Ponderado de Capital. É o retorno mínimo que a empresa precisa entregar para remunerar sócios e credores. Funciona como 'meta' do ROIC." formula="(E/V × Ke) + (D/V × Kd × (1 − IR))" />
        <Ind label="Liquidez Corrente" v={ind.liquidezCorrente.toFixed(2)} tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"} desc="Capacidade de pagar dívidas de curto prazo com recursos de curto prazo. Acima de 1,0 indica folga; abaixo, aperto." formula="Ativo Circulante ÷ Passivo Circulante" />
        <Ind label="Liquidez Seca" v={ind.liquidezSeca.toFixed(2)} desc="Versão mais rigorosa da liquidez corrente: exclui estoques (que podem demorar a virar caixa). Ideal acima de 1,0." formula="(Ativo Circulante − Estoques) ÷ Passivo Circulante" />
        <Ind label="Liquidez Imediata" v={ind.liquidezImediata.toFixed(2)} desc="Capacidade de pagar dívidas de curto prazo IMEDIATAMENTE, só com dinheiro em caixa e aplicações." formula="Disponibilidades ÷ Passivo Circulante" />
        <Ind label={ind.endividamentoGeralDadosCompletos ? "Endividamento Geral" : "Endividamento Geral (estim.)"} v={`${fmtPct(ind.endividamentoGeral / 100)}${!ind.endividamentoGeralDadosCompletos ? " ⚠️" : ""}`} tone={ind.endividamentoGeral <= 60 ? "pos" : "neg"} desc={`Percentual do ativo financiado por dívidas (terceiros). Acima de 60% costuma indicar alto risco financeiro.${!ind.endividamentoGeralDadosCompletos ? " ⚠️ Ativo Total não informado — valor é estimativa." : ""}`} formula="Passivo Total ÷ Ativo Total × 100" />
        <Ind label="Cobertura de Juros" v={fmtTimes(ind.coberturaJuros, ebitAnual)} tone={ind.coberturaJuros >= 2 ? "pos" : "neg"} desc="Quantas vezes o lucro operacional cobre as despesas de juros. Abaixo de 2× é zona de risco." formula="EBIT ÷ Despesas Financeiras" />
        <Ind label="Giro do Ativo" v={`${ind.giroAtivo.toFixed(2)}×`} desc="Quantas vezes o ativo total 'gira' em vendas no ano. Mede eficiência: quanto maior, mais a empresa produz com o que tem." formula="Receita Líquida ÷ Ativo Total" />
        <Ind label="Dívida Líq. / EBITDA" v={fmtTimes(ind.dividaLiqEbitda, ebitdaAnual)} tone={ind.dividaLiqEbitda <= 3 ? "pos" : "neg"} desc="Em quantos anos de geração de caixa (EBITDA) a empresa quitaria sua dívida líquida. Acima de 3× preocupa bancos." formula="(Dívida Total − Caixa) ÷ EBITDA" />
        <Ind label="Dívida Líq. / EBIT" v={fmtTimes(ind.dividaLiqEbit, ebitAnual)} tone={ind.dividaLiqEbit <= 4 ? "pos" : "neg"} desc="Quantos anos de lucro operacional (já líquido da depreciação) seriam necessários para quitar a dívida líquida. Mais conservador que Dívida/EBITDA." formula="(Dívida Total − Caixa) ÷ EBIT" />
        <Ind label="Dívida Líq. / PL" v={Number.isFinite(ind.dividaLiqPl) ? `${ind.dividaLiqPl.toFixed(2)}×` : "—"} tone={ind.dividaLiqPl <= 1 ? "pos" : "neg"} desc="Relação entre dívida líquida e capital dos sócios. Mostra o quanto a empresa está alavancada em relação ao patrimônio próprio." formula="(Dívida Total − Caixa) ÷ Patrimônio Líquido" />
        <Ind label="Payback (anos)" v={Number.isFinite(ind.payback) ? ind.payback.toFixed(1) : "—"} desc="Tempo estimado para o lucro acumulado recuperar todo o capital investido pelos sócios." formula="Patrimônio Líquido ÷ Lucro Líquido Anual" />
        <Ind label="FCF estimado" v={fmtBRL(ind.fcf)} tone={ind.fcf >= 0 ? "pos" : "neg"} desc="Free Cash Flow — geração de caixa livre após impostos e investimento em capital de giro. É o que sobra para sócios e dívida." formula="EBITDA − Impostos − Δ NCG" />
        <Ind
          label="CAGR Receitas 12m"
          v={Number.isFinite(cagrReceitas12m) ? fmtPct(cagrReceitas12m) : "—"}
          tone={Number.isFinite(cagrReceitas12m) ? (cagrReceitas12m >= 0 ? "pos" : "neg") : undefined}
          desc="Taxa de Crescimento Anual Composta (CAGR) da Receita Líquida ao longo dos 12 meses."
          formula="(Receita_fim ÷ Receita_início)^(12 ÷ meses) − 1"
        />
        <Ind label="GAO" v={ind.gao !== 0 ? `${ind.gao.toFixed(2)}×` : "—"} tone={ind.gao > 3 ? "warn" : ind.gao > 0 ? "pos" : undefined} desc="Grau de Alavancagem Operacional. Se a receita variar 1%, o EBIT varia GAO%. Quanto maior, mais sensível o lucro ao volume — bom em alta, perigoso em queda." formula="Margem de Contribuição (R$) ÷ EBIT" />
        <Ind label="Qualidade do Lucro" v={ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}×` : "—"} tone={ind.qualidadeLucro >= 1 ? "pos" : "neg"} desc="O lucro contábil está virando caixa? ≥1 saudável; <1 indica lucro 'no papel' (preso em NCG, inadimplência ou estoques)." formula="Fluxo de Caixa Operacional ÷ Lucro Líquido" />
        <Ind label="Faturamento / Colaborador" v={hasHeadcount ? fmtBRL(ind.faturamentoPorColaborador) : "—"} desc="Receita BRUTA gerada por colaborador no ano — métrica clássica de benchmarking de produtividade. Ajuste o nº de colaboradores em Configurações Rápidas (sidebar)." formula="Receita Bruta ÷ Nº de Colaboradores" />
        <Ind label="Receita Líq. / Colaborador" v={hasHeadcount ? fmtBRL(ind.receitaPorColaborador) : "—"} desc="Receita LÍQUIDA (após deduções e impostos sobre venda) por colaborador. Comparável entre regimes tributários." formula="Receita Líquida ÷ Nº de Colaboradores" />
        <Ind label="EBITDA / Colaborador" v={hasHeadcount ? fmtBRL(ind.ebitdaPorColaborador) : "—"} tone={ind.ebitdaPorColaborador >= 0 ? "pos" : "neg"} desc="Geração operacional (EBITDA) por colaborador no ano." formula="EBITDA ÷ Nº de Colaboradores" />
        <Ind label="Lucro / Colaborador" v={hasHeadcount ? fmtBRL(ind.lucroPorColaborador) : "—"} tone={ind.lucroPorColaborador >= 0 ? "pos" : "neg"} desc="Lucro líquido gerado por colaborador no ano. Mede a conversão de mão de obra em resultado." formula="Lucro Líquido ÷ Nº de Colaboradores" />
        <Ind label="Folha / Receita" v={ind.custoPessoalSobreReceita > 0 ? fmtPct(ind.custoPessoalSobreReceita / 100) : "—"} tone={ind.custoPessoalSobreReceita > 35 ? "neg" : ind.custoPessoalSobreReceita > 0 ? "pos" : undefined} desc="Peso da folha total (CLT + pró-labore + MOD, com encargos) sobre a receita. Acima de 35% acende alerta em serviços." formula="Folha Total Anual ÷ Receita Líquida × 100" />
        <Ind label="Margem de Segurança" v={ind.margemSeguranca !== 0 ? fmtPct(ind.margemSeguranca / 100) : "—"} tone={ind.margemSeguranca >= 25 ? "pos" : ind.margemSeguranca >= 10 ? "warn" : "neg"} desc="Folga entre a receita atual e o Ponto de Equilíbrio. >25% confortável; 10–25% atenção; <10% zona crítica — pequenas quedas de receita já geram prejuízo." formula="(Receita − Ponto de Equilíbrio) ÷ Receita × 100" />
        <Ind label="DSCR (Serviço da Dívida)" v={ind.dscr !== 0 ? `${ind.dscr.toFixed(2)}×${!ind.dscrAmortizacoesInformadas && ind.dividaOnerosa > 0 ? " ⚠️" : ""}` : "—"} tone={ind.dscr >= 1.5 ? "pos" : ind.dscr >= 1.25 ? "warn" : "neg"} desc={`Quantas vezes o EBITDA cobre o serviço total da dívida (juros + amortização do principal). Bancos exigem ≥1,25× para renovar giro; ≥1,50× destrava melhores linhas.${!ind.dscrAmortizacoesInformadas && ind.dividaOnerosa > 0 ? " ⚠️ Amortizações de principal não informadas — DSCR equivale à Cobertura de Juros (pode estar superestimado)." : ""}`} formula="EBITDA ÷ (Juros + Amortizações de Principal)" />
      </div>
    </div>
  );
}

function Ind({ label, v, desc, formula, tone }: { label: string; v: string; desc?: string; formula?: string; tone?: "pos" | "neg" | "warn" }) {
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span> {desc && <HelpTip text={desc} formula={formula} />}
      </div>
      <div className={`mono mt-1 text-lg font-semibold ${cls}`}>{v}</div>
    </div>
  );
}
