// =====================================================================
// SSOT — Memória de cálculo dos indicadores financeiros (pt-BR).
// Recebe (state, dre, ind) e devolve um Record de strings prontas para
// exibição abaixo da Fórmula no tooltip de cada card.
//
// Regras:
//  - Quando o denominador é 0 / base insuficiente → "Base insuficiente — cálculo indisponível".
//  - Reusa SOMENTE valores já expostos em `Indicators` (incl. `ind.bases`,
//    as bases exatas de cada fórmula) — NENHUM novo cálculo financeiro.
//    O resultado mostrado é sempre o valor do card.
//  - Formatação 100% pt-BR via helpers de `format.ts`.
// =====================================================================
import type { AppState } from "./types";
import type { DRE } from "./dre";
import type { Indicators } from "./indicators";
import { fmtBRL, fmtPct, fmtRatio, fmtAnos, fmtDays, fmtNum } from "./format";

const NA = "Base insuficiente — cálculo indisponível";

const line = (lhs: string, rhs: string) => `${lhs}\n= ${rhs}`;

export interface IndicatorCalcs {
  // Margens
  margemBruta: string;
  margemEbitda: string;
  eva: string;
  margemLiquida: string;
  margemContribuicao: string;
  // Ponto de equilíbrio
  pontoEquilibrioOperacional: string;
  pontoEquilibrioFinanceiro: string;
  pontoEquilibrioTotal: string;
  // Retornos
  roe: string;
  roa: string;
  roic: string;
  wacc: string;
  // Liquidez
  liquidezCorrente: string;
  liquidezSeca: string;
  liquidezImediata: string;
  liquidezGeral: string;
  // Estrutura
  endividamentoGeral: string;
  capitalProprio: string;
  coberturaJuros: string;
  giroAtivo: string;
  // Alavancagem
  dividaLiqEbitda: string;
  dividaLiqEbit: string;
  dividaLiqPl: string;
  amortizacaoPlPorLucro: string;
  paybackCapex: string;
  // Caixa / operação
  fcf: string;
  cagrReceitas12m: string;
  gao: string;
  gaf: string;
  qualidadeLucro: string;
  conversaoEbitdaCaixa: string;
  cicloFinanceiro: string;
  ncg: string;
  gapCapitalGiro: string;
  // RH / produtividade
  faturamentoPorColaborador: string;
  receitaPorColaborador: string;
  ebitdaPorColaborador: string;
  lucroPorColaborador: string;
  folhaSobreReceita: string;
  // Risco
  margemSeguranca: string;
  dscr: string;
  // Fiscal
  impostosSobreReceita: string;
  impostosSobreLucro: string;
  // Topo de páginas
  receitaLiquida12m: string;
  ebitda12m: string;
  lucroLiquido12m: string;
}

export function buildIndicatorCalcs(
  state: AppState,
  dre: DRE,
  ind: Indicators,
  cagrReceitas12m = NaN,
): IndicatorCalcs {
  // `dre` mantido na assinatura por compatibilidade com os consumidores (UI);
  // as bases da DRE já chegam anualizadas em `ind.bases`.
  // SSOT: TODAS as bases vêm de `ind.bases` (exatamente os números usados por
  // `calcIndicators`) e todos os resultados vêm do próprio card. Nada é
  // recalculado aqui — assim a memória nunca diverge do indicador exibido.
  const b = ind.bases;

  // --- Bases anualizadas (já normalizadas pela engine) ---
  const RL = ind.receitaLiquidaAnual;
  const RB = ind.receitaBrutaAnual;
  const EBITDA = ind.ebitdaAnual;
  const EBIT = ind.ebitAnual;
  const LL = ind.lucroLiquidoAnual;
  const LB = b.lucroBrutoAnual;
  const cv = b.custosVariaveisAnual;
  const cf = b.custosFixosSemDepAnual;
  const dep = b.depreciacaoAnual;
  // `juros` para DSCR / Cobertura de Juros = juros de CONTRATOS de dívida (SSOT com indicators.ts).
  // NÃO usa `custosFinanceirosTotal` da DRE (que inclui tarifas, IOF, cheque especial etc.).
  const juros = b.jurosDivida;
  // Custos financeiros TOTAIS da DRE — base do PE total e do Lucro Líquido.
  const custosFin = b.custosFinanceirosAnual;
  const impVendas = b.impostosVendasAnual;
  const impLucro = b.impostosLucroAnual;

  // --- Estrutura patrimonial (Balanço de Fechamento reconciliado) ---
  const PL = b.pl;
  const D = Math.max(0, ind.dividaOnerosa);
  const PLmedio = b.plMedio;
  const AT = b.ativoTotal;
  const ATmedio = b.ativoMedio;
  const AC = ind.ativoCirculante;
  const PC = ind.passivoCirculante;
  const disp = ind.caixaLiquidez; // SSOT: caixa do balanço; pode ser negativo (descoberto).
  const estoques = b.estoqueLiquidez;
  const dl = ind.dividaLiquida;
  const headcount = Math.max(0, state.numColaboradores ?? 0);

  /** Anota quando o card aplicou teto (cap) e o valor bruto da fórmula é maior. */
  const capNote = (raw: number, shown: number) =>
    Math.abs(raw - shown) > 0.005 ? `  (limitado a ${fmtRatio(shown)})` : "";
  /** Soma/subtração com o sinal visível ("+ R$ x" ou "− R$ x"). */
  const signed = (v: number) => (v < 0 ? `− ${fmtBRL(-v)}` : `+ ${fmtBRL(v)}`);

  // ----- Margens -----
  const margemBruta =
    RL > 0 ? line(`${fmtBRL(LB)} ÷ ${fmtBRL(RL)} × 100`, fmtPct(ind.margemBruta / 100)) : NA;
  const margemEbitda =
    RL > 0 ? line(`${fmtBRL(EBITDA)} ÷ ${fmtBRL(RL)} × 100`, fmtPct(ind.margemEbitda / 100)) : NA;
  // EVA = (ROIC − WACC) × Capital Investido. ROIC/WACC em % → divide por 100.
  const evaStr =
    ind.capitalInvestido > 0
      ? line(
          `(${fmtPct(ind.roic / 100)} − ${fmtPct(ind.wacc / 100)}) × ${fmtBRL(ind.capitalInvestido)}`,
          fmtBRL(ind.eva),
        )
      : NA;
  const margemLiquida =
    RL > 0 ? line(`${fmtBRL(LL)} ÷ ${fmtBRL(RL)} × 100`, fmtPct(ind.margemLiquida / 100)) : NA;
  const margemContribuicao =
    RL > 0
      ? line(
          `(${fmtBRL(RL)} − ${fmtBRL(cv)}) ÷ ${fmtBRL(RL)} × 100`,
          fmtPct(ind.margemContribuicao / 100),
        )
      : NA;

  // ----- Ponto de equilíbrio -----
  const mcFrac = b.mcFrac;
  const peOp =
    mcFrac > 0
      ? line(
          `(${fmtBRL(cf)} + ${fmtBRL(dep)}) ÷ ${fmtPct(mcFrac)}`,
          fmtBRL(ind.pontoEquilibrioOperacional),
        )
      : NA;
  const peFin =
    mcFrac > 0
      ? line(`${fmtBRL(cf)} ÷ ${fmtPct(mcFrac)}`, fmtBRL(ind.pontoEquilibrioFinanceiro))
      : NA;
  const peTot =
    mcFrac > 0
      ? line(
          `(${fmtBRL(cf)} + ${fmtBRL(dep)} + ${fmtBRL(custosFin)}) ÷ ${fmtPct(mcFrac)}  (custos fixos + depreciação + custos financeiros)`,
          fmtBRL(ind.pontoEquilibrio),
        )
      : NA;

  // ----- Retornos -----
  const roe =
    PLmedio > 0 && ind.roe != null
      ? line(`${fmtBRL(LL)} ÷ ${fmtBRL(PLmedio)} × 100`, fmtPct(ind.roe / 100))
      : NA;
  const roa =
    ATmedio > 0 ? line(`${fmtBRL(LL)} ÷ ${fmtBRL(ATmedio)} × 100`, fmtPct(ind.roa / 100)) : NA;
  const roic =
    ind.capitalInvestido > 0
      ? line(
          `${fmtBRL(ind.nopat)} ÷ ${fmtBRL(ind.capitalInvestido)} × 100  (IR efetivo: ${fmtNum(ind.aliquotaNopat, 1)}%)`,
          fmtPct(ind.roic / 100),
        )
      : NA;
  const wacc =
    b.pesoProprio + b.pesoDivida > 0
      ? line(
          `(${fmtPct(b.pesoProprio)} × ${fmtNum(b.ke, 1)}%) + (${fmtPct(b.pesoDivida)} × ${fmtNum(b.kd, 1)}% × (1 − ${fmtPct(b.irShield)}))`,
          `${fmtNum(ind.wacc, 1)}%`,
        )
      : NA;

  // ----- Liquidez -----
  const liquidezCorrente =
    PC > 1
      ? line(
          `${fmtBRL(AC)} ÷ ${fmtBRL(PC)}`,
          fmtRatio(ind.liquidezCorrente) + capNote(AC / PC, ind.liquidezCorrente),
        )
      : NA;
  const liquidezSeca =
    PC > 1
      ? line(
          `(${fmtBRL(AC)} − ${fmtBRL(estoques)}) ÷ ${fmtBRL(PC)}`,
          fmtRatio(ind.liquidezSeca) + capNote((AC - estoques) / PC, ind.liquidezSeca),
        )
      : NA;
  const liquidezImediata =
    PC > 1
      ? line(
          `${fmtBRL(disp)} ÷ ${fmtBRL(PC)}`,
          fmtRatio(ind.liquidezImediata) + capNote(disp / PC, ind.liquidezImediata),
        )
      : NA;
  const liquidezGeral =
    b.passivoTotalAprox > 1
      ? line(
          `${fmtBRL(AC)} ÷ (${fmtBRL(AT)} − ${fmtBRL(PL)})`,
          fmtRatio(ind.liquidezGeral) + capNote(AC / b.passivoTotalAprox, ind.liquidezGeral),
        )
      : NA;

  // ----- Estrutura -----
  // Passivo e ativo exatamente como usados pela engine (Balanço Detalhado quando
  // disponível — vide `indicators.ts`). Destaca o pedaço ONEROSO (dívida
  // financeira), o número que o banco lê.
  const endividamentoGeral =
    b.ativoEndividamento > 0
      ? line(
          `${fmtBRL(b.passivoEndividamento)} ÷ ${fmtBRL(b.ativoEndividamento)} × 100  (oneroso: ${fmtBRL(D)} = ${fmtPct(ind.endividamentoOneroso / 100)})`,
          fmtPct(ind.endividamentoGeral / 100),
        )
      : NA;
  const capitalProprio =
    PL + D > 0
      ? line(
          `${fmtBRL(PL)} ÷ (${fmtBRL(PL)} + ${fmtBRL(D)}) × 100`,
          fmtPct(ind.proprioPercent / 100),
        )
      : NA;
  const coberturaJuros =
    juros > 1 && ind.coberturaJuros != null
      ? line(`${fmtBRL(EBIT)} ÷ ${fmtBRL(juros)}`, `${fmtRatio(ind.coberturaJuros)}×`)
      : "Sem dívida onerosa — indicador não aplicável (N/A)";
  const giroAtivo =
    ATmedio > 0 ? line(`${fmtBRL(RL)} ÷ ${fmtBRL(ATmedio)}`, `${fmtRatio(ind.giroAtivo)}×`) : NA;

  // ----- Alavancagem -----
  const dividaLiqEbitda =
    EBITDA > 1
      ? line(
          `${fmtBRL(dl)} ÷ ${fmtBRL(EBITDA)}`,
          `${fmtRatio(ind.dividaLiqEbitda)}×${capNote(dl / EBITDA, ind.dividaLiqEbitda)}`,
        )
      : NA;
  const dividaLiqEbit =
    EBIT > 1
      ? line(
          `${fmtBRL(dl)} ÷ ${fmtBRL(EBIT)}`,
          `${fmtRatio(ind.dividaLiqEbit)}×${capNote(dl / EBIT, ind.dividaLiqEbit)}`,
        )
      : NA;
  const dividaLiqPl =
    PL > 1
      ? line(
          `${fmtBRL(dl)} ÷ ${fmtBRL(PL)}`,
          `${fmtRatio(ind.dividaLiqPl)}×${capNote(dl / PL, ind.dividaLiqPl)}`,
        )
      : NA;

  const amortizacaoPlPorLucro =
    LL > 1 && PL > 0
      ? line(`${fmtBRL(PL)} ÷ ${fmtBRL(LL)}`, fmtAnos(ind.amortizacaoPlPorLucro))
      : NA;
  const paybackCapex =
    ind.capexAnual > 0 && ind.fcf > 1
      ? line(`${fmtBRL(ind.capexAnual)} ÷ ${fmtBRL(ind.fcf)}`, fmtAnos(ind.paybackCapex))
      : NA;

  // ----- Caixa / operação -----
  const fcfStr = line(
    `NOPAT + Depreciação − Δ NCG = ${fmtBRL(ind.nopat)} + ${fmtBRL(dep)} ${signed(-b.deltaNcg)}`,
    fmtBRL(ind.fcf),
  );
  const cagrStr = Number.isFinite(cagrReceitas12m)
    ? line(`Receita_fim ÷ Receita_início, anualizado em 12 meses`, fmtPct(cagrReceitas12m))
    : NA;
  const gaoStr =
    Math.abs(EBIT) > 1 ? line(`${fmtBRL(RL - cv)} ÷ ${fmtBRL(EBIT)}`, `${fmtRatio(ind.gao)}×`) : NA;
  // LAIR da DRE (EBIT − juros + receitas financeiras + outras), mesmo de `indicators.ts`.
  const LAIR = b.lairAnual;
  const gafStr =
    Math.abs(EBIT) > 1 && LAIR > 1
      ? line(`${fmtBRL(EBIT)} ÷ ${fmtBRL(LAIR)}`, `${fmtRatio(ind.gaf)}×`)
      : NA;
  const qualidadeLucro =
    Math.abs(LL) > 1
      ? line(
          `${fmtBRL(ind.fcoAnual)} ÷ ${fmtBRL(LL)}  (FCO ÷ Lucro Líquido)`,
          `${fmtRatio(ind.qualidadeLucro)}×`,
        )
      : NA;
  const conversaoEbitdaCaixa =
    EBITDA > 0
      ? line(`${fmtBRL(ind.fcf)} ÷ ${fmtBRL(EBITDA)} × 100`, fmtPct(ind.conversaoEbitdaCaixa / 100))
      : NA;
  const cicloFinanceiroStr = line(
    `PMR + PME − PMP = ${fmtDays(state.revenue.pmr, 1)} + ${fmtDays(b.pme, 1)} − ${fmtDays(state.revenue.pmp, 1)}`,
    fmtDays(ind.cicloFinanceiro, 1),
  );
  const ncgStr = line(
    `Contas a Receber + Estoques − Passivo operacional = ${fmtBRL(b.contasReceber)} + ${fmtBRL(b.estoques)} − ${fmtBRL(b.passivoOperacional)}`,
    fmtBRL(ind.ncg),
  );
  const gapCgStr = line(
    `NCG − (PL + PNC − ANC) = ${fmtBRL(ind.ncg)} − (${fmtBRL(b.cdgPl)} + ${fmtBRL(b.cdgPnc)} − ${fmtBRL(b.cdgAnc)}) = ${fmtBRL(ind.ncg)} − ${fmtBRL(b.cdg)}`,
    fmtBRL(ind.gapCapitalGiro),
  );

  // ----- RH -----
  const fmtColab = (v: number) =>
    headcount > 0
      ? line(`${fmtBRL(v * headcount)} ÷ ${headcount} colaborador(es)`, fmtBRL(v))
      : "Informe o nº de colaboradores em Configurações Rápidas";
  const faturamentoPorColaborador = fmtColab(ind.faturamentoPorColaborador);
  const receitaPorColaborador = fmtColab(ind.receitaPorColaborador);
  const ebitdaPorColaborador = fmtColab(ind.ebitdaPorColaborador);
  const lucroPorColaborador = fmtColab(ind.lucroPorColaborador);
  const folhaSobreReceita =
    RB > 0 && ind.custoPessoalSobreReceita > 0
      ? line(
          `${fmtBRL((ind.custoPessoalSobreReceita / 100) * RB)} ÷ ${fmtBRL(RB)} × 100`,
          `${fmtNum(ind.custoPessoalSobreReceita, 1)}%`,
        )
      : NA;

  // ----- Risco -----
  const margemSeguranca =
    RL > 0 && ind.pontoEquilibrioOperacional > 0
      ? line(
          `(${fmtBRL(RL)} − ${fmtBRL(ind.pontoEquilibrioOperacional)}) ÷ ${fmtBRL(RL)} × 100`,
          `${fmtNum(ind.margemSeguranca, 1)}%`,
        )
      : NA;
  const dscr = (() => {
    const amort = b.amortizacaoAnual;
    return ind.dscr != null && juros + amort > 1
      ? line(`${fmtBRL(EBITDA)} ÷ (${fmtBRL(juros)} + ${fmtBRL(amort)})`, `${fmtRatio(ind.dscr)}×`)
      : "Sem serviço da dívida no período — indicador não aplicável (N/A)";
  })();

  // ----- Fiscal -----
  const impostosSobreReceita =
    RB > 0
      ? line(
          `(${fmtBRL(impVendas)} + ${fmtBRL(impLucro)}) ÷ ${fmtBRL(RB)} × 100`,
          `${fmtNum(ind.impostosSobreReceita, 1)}%`,
        )
      : NA;
  const impostosSobreLucro =
    LL > 1
      ? line(
          `(${fmtBRL(impVendas)} + ${fmtBRL(impLucro)}) ÷ ${fmtBRL(LL)} × 100`,
          `${fmtNum(ind.impostosSobreLucro, 1)}%`,
        )
      : NA;

  // ----- Topo de páginas (Dashboard) -----
  const receitaLiquida12m = line(
    `${fmtBRL(RB)} − ${fmtBRL(b.deducoesReceitaAnual)} − ${fmtBRL(impVendas)}  (receita bruta − deduções − impostos sobre vendas)`,
    fmtBRL(RL),
  );
  const ebitda12m = line(`${fmtBRL(EBIT)} + ${fmtBRL(dep)}`, fmtBRL(EBITDA));
  // LL = EBIT − custos financeiros da DRE ± receitas financeiras/não operacionais − IR/CSLL
  // (mesma cadeia da DRE; os juros de contratos são só parte dos custos financeiros).
  const lucroLiquido12m = line(
    `${fmtBRL(EBIT)} − ${fmtBRL(custosFin)} ${signed(b.outrosResultadosAnual)} − ${fmtBRL(impLucro)}  (EBIT − custos financeiros ± receitas financeiras/não operacionais − IR/CSLL)`,
    fmtBRL(LL),
  );

  return {
    margemBruta,
    margemEbitda,
    eva: evaStr,
    margemLiquida,
    margemContribuicao,
    pontoEquilibrioOperacional: peOp,
    pontoEquilibrioFinanceiro: peFin,
    pontoEquilibrioTotal: peTot,
    roe,
    roa,
    roic,
    wacc,
    liquidezCorrente,
    liquidezSeca,
    liquidezImediata,
    liquidezGeral,
    endividamentoGeral,
    capitalProprio,
    coberturaJuros,
    giroAtivo,
    dividaLiqEbitda,
    dividaLiqEbit,
    dividaLiqPl,
    amortizacaoPlPorLucro,
    paybackCapex,
    fcf: fcfStr,
    cagrReceitas12m: cagrStr,
    gao: gaoStr,
    gaf: gafStr,
    qualidadeLucro,
    conversaoEbitdaCaixa,
    cicloFinanceiro: cicloFinanceiroStr,
    ncg: ncgStr,
    gapCapitalGiro: gapCgStr,
    faturamentoPorColaborador,
    receitaPorColaborador,
    ebitdaPorColaborador,
    lucroPorColaborador,
    folhaSobreReceita,
    margemSeguranca,
    dscr,
    impostosSobreReceita,
    impostosSobreLucro,
    receitaLiquida12m,
    ebitda12m,
    lucroLiquido12m,
  };
}
