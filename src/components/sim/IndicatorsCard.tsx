import { useMemo } from "react";
import { AppState } from "@/lib/finance/types";
import { buildDRE, calcIndicators } from "@/lib/finance/calculations";
import { fmtBRL, fmtPct } from "@/lib/finance/format";
import { HelpTip, SectionTitle } from "./primitives";

export function IndicatorsCard({ state }: { state: AppState }) {
  const ind = useMemo(() => {
    const { dre } = buildDRE(state, state.tax.regime);
    return calcIndicators(state, dre);
  }, [state]);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <SectionTitle hint={{ description: "Métricas-chave que sintetizam a saúde financeira da empresa. Cada card traz a definição e a fórmula usada no cálculo." }}>
        Indicadores financeiros
      </SectionTitle>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        <Ind label="Margem Bruta" v={fmtPct(ind.margemBruta / 100)} desc="Quanto sobra da receita após pagar o custo direto do produto/serviço." formula="Lucro Bruto ÷ Receita Líquida × 100" />
        <Ind label="Margem EBITDA" v={fmtPct(ind.margemEbitda / 100)} desc="Geração operacional antes de juros, impostos e depreciação." formula="EBITDA ÷ Receita Líquida × 100" />
        <Ind label="Margem Líquida" v={fmtPct(ind.margemLiquida / 100)} desc="Lucro final sobre receita, após tudo pago." formula="Lucro Líquido ÷ Receita Líquida × 100" />
        <Ind label="Margem de Contribuição" v={fmtPct(ind.margemContribuicao / 100)} desc="Quanto cada R$ vendido contribui para cobrir fixos e gerar lucro." formula="(Receita − Custos Variáveis) ÷ Receita × 100" />
        <Ind label="Ponto de Equilíbrio" v={fmtBRL(ind.pontoEquilibrio)} desc="Receita mínima para não ter prejuízo." formula="Custos Fixos ÷ Margem de Contribuição" />
        <Ind label="Ponto de Eq. Financeiro" v={fmtBRL(ind.pontoEquilibrioFinanceiro)} desc="Idem, desconsiderando depreciação." formula="(Custos Fixos − Depreciação) ÷ Margem de Contribuição" />
        <Ind label="ROE" v={fmtPct(ind.roe / 100)} desc="Retorno sobre Patrimônio Líquido." formula="Lucro Líquido ÷ PL × 100" />
        <Ind label="ROA" v={fmtPct(ind.roa / 100)} desc="Retorno sobre Ativo Total." formula="Lucro Líquido ÷ Ativo Total × 100" />
        <Ind label="ROIC" v={fmtPct(ind.roic / 100)} tone={ind.roic >= ind.wacc ? "pos" : "neg"} desc="Retorno sobre Capital Investido. Se ROIC > WACC, cria valor." formula="NOPAT ÷ Capital Investido × 100" />
        <Ind label="WACC" v={fmtPct(ind.wacc / 100)} desc="Custo Médio Ponderado de Capital." formula="(E/V × Ke) + (D/V × Kd × (1 − IR))" />
        <Ind label="Liquidez Corrente" v={ind.liquidezCorrente.toFixed(2)} tone={ind.liquidezCorrente >= 1 ? "pos" : "neg"} desc="Ativo Circulante ÷ Passivo Circulante." formula="AC ÷ PC" />
        <Ind label="Liquidez Seca" v={ind.liquidezSeca.toFixed(2)} desc="Liquidez sem estoques." formula="(AC − Estoques) ÷ PC" />
        <Ind label="Liquidez Imediata" v={ind.liquidezImediata.toFixed(2)} desc="Pagar dívidas CP só com caixa." formula="Disponibilidades ÷ PC" />
        <Ind label="Endividamento Geral" v={fmtPct(ind.endividamentoGeral / 100)} desc="% do ativo financiado por terceiros." formula="Passivo Total ÷ Ativo Total × 100" />
        <Ind label="Cobertura de Juros" v={Number.isFinite(ind.coberturaJuros) ? `${ind.coberturaJuros.toFixed(1)}×` : "∞"} tone={ind.coberturaJuros >= 2 ? "pos" : "neg"} desc="Quantas vezes o EBIT cobre os juros." formula="EBIT ÷ Despesas Financeiras" />
        <Ind label="Giro do Ativo" v={`${ind.giroAtivo.toFixed(2)}×`} desc="Quantas vezes o ativo gira em vendas no ano." formula="Receita Líquida ÷ Ativo Total" />
        <Ind label="Dívida Líq. / EBITDA" v={Number.isFinite(ind.dividaLiqEbitda) ? `${ind.dividaLiqEbitda.toFixed(1)}×` : "∞"} tone={ind.dividaLiqEbitda <= 3 ? "pos" : "neg"} desc="Anos de EBITDA para quitar a dívida líquida." formula="(Dívida − Caixa) ÷ EBITDA" />
        <Ind label="Ciclo Financeiro" v={`${ind.cicloFinanceiro} d`} desc="Dias entre pagar fornecedores e receber clientes." formula="PMR + PME − PMP" />
        <Ind label="NCG" v={fmtBRL(ind.ncg)} tone="warn" desc="Necessidade de Capital de Giro." formula="(Ciclo ÷ 30) × Custos Mensais" />
        <Ind label="GAO" v={ind.gao !== 0 ? `${ind.gao.toFixed(2)}×` : "—"} tone={ind.gao > 3 ? "warn" : "pos"} desc="Grau de Alavancagem Operacional. Se a receita variar 1%, o EBIT varia GAO%. Quanto maior, mais sensível o lucro ao volume." formula="Margem de Contribuição (R$) ÷ EBIT" />
        <Ind label="Qualidade do Lucro" v={ind.qualidadeLucro !== 0 ? `${ind.qualidadeLucro.toFixed(2)}×` : "—"} tone={ind.qualidadeLucro >= 1 ? "pos" : "neg"} desc="O lucro contábil está virando caixa? ≥1 saudável; <1 lucro 'no papel' (NCG, inadimplência)." formula="Fluxo de Caixa Operacional ÷ Lucro Líquido" />
        <Ind label="Payback (anos)" v={Number.isFinite(ind.payback) ? ind.payback.toFixed(1) : "—"} desc="Tempo para o lucro recuperar o capital investido." formula="PL ÷ Lucro Líquido Anual" />
        <Ind label="FCF estimado" v={fmtBRL(ind.fcf)} tone={ind.fcf >= 0 ? "pos" : "neg"} desc="Free Cash Flow estimado." formula="EBITDA − Impostos − Δ NCG" />
      </div>
    </div>
  );
}

function Ind({ label, v, desc, formula, tone }: { label: string; v: string; desc?: string; formula?: string; tone?: "pos" | "neg" | "warn" }) {
  const cls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "warn" ? "text-[var(--warning)]" : "";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2 sm:p-3">
      <div className="flex items-center gap-1 text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground leading-tight min-h-[20px]">
        <span className="truncate">{label}</span> {desc && <HelpTip text={desc} formula={formula} />}
      </div>
      <div className={`mono mt-1 text-sm sm:text-lg font-semibold truncate ${cls}`}>{v}</div>
    </div>
  );
}
