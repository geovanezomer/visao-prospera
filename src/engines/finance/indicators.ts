// =====================================================================
// INDICADORES — margens, PE, ROIC/WACC, liquidez, endividamento, FCF.
// Extraído de calculations.ts (Fase 3) — comportamento idêntico.
// Função única `calcIndicators`; sem extração de sub-blocos nesta fase.
// =====================================================================

import { AppState } from "./types";
import { sum } from "./format";
import { safeDivide, safePct, safeNumber } from "./safeMath";
import { computeNetDebt } from "./shared";
import { folhaAnual, resolveEffectiveRegime } from "./regime";
import { irShieldForRegime } from "./tax/real";
import type { DRE } from "./dre";

export interface Indicators {
  /** Lucro Bruto ÷ Receita Líquida × 100 */
  margemBruta: number;
  /** EBITDA ÷ Receita Líquida × 100 */
  margemEbitda: number;
  /** EBIT ÷ Receita Líquida × 100 */
  margemEbit: number;
  /** Lucro Líquido ÷ Receita Líquida × 100 */
  margemLiquida: number;
  /** (Receita Líquida − Custos Variáveis) ÷ Receita Líquida × 100 */
  margemContribuicao: number;
  /**
   * PE TOTAL (cobertura financeira completa): (Custos Fixos + Depreciação + Juros) ÷ MC.
   * Inclui juros porque, para a PME, juros são custo fixo financeiro recorrente.
   */
  pontoEquilibrio: number;
  /**
   * PE OPERACIONAL CLÁSSICO (Garrison/Horngren): Custos Fixos Operacionais (com depreciação,
   * SEM juros) ÷ MC. Juros e impostos ficam abaixo do EBIT — não pertencem ao PE contábil.
   */
  pontoEquilibrioOperacional: number;
  /**
   * PE FINANCEIRO clássico (caixa): Custos Fixos Operacionais SEM depreciação e SEM juros ÷ MC.
   * Receita mínima para cobrir os desembolsos OPERACIONAIS.
   */
  pontoEquilibrioFinanceiro: number;
  /** Lucro Líquido ÷ Patrimônio Líquido × 100 */
  roe: number;
  /** Lucro Líquido ÷ Ativo Total × 100 */
  roa: number;
  /** NOPAT ÷ Capital Investido × 100 */
  roic: number;
  /** (Capital Próprio/V × Ke) + (Dívida/V × Kd × (1 − IR Shield)) */
  wacc: number;
  /** PMR + PME − PMP */
  cicloFinanceiro: number;
  /** Contas a Receber + Estoques − Fornecedores */
  ncg: number;
  /** NCG − Capital de Giro Disponível */
  gapCapitalGiro: number;
  /** Ativo Circulante ÷ Passivo Circulante */
  liquidezCorrente: number;
  /** (Ativo Circulante − Estoques) ÷ Passivo Circulante */
  liquidezSeca: number;
  /** Disponibilidades ÷ Passivo Circulante */
  liquidezImediata: number;
  /** Passivo Total ÷ Ativo Total × 100. Quando `endividamentoGeralDadosCompletos=false`, é estimativa de fallback. */
  endividamentoGeral: number;
  /**
   * true quando Ativo Total foi informado pelo consultor — `endividamentoGeral` é valor real.
   * false quando faltou Ativo Total: a engine usa fallback (Dívida Onerosa + PNO) ÷ proxy de
   * Ativo (PL + D + PNO), evitando exibir "0%" silenciosamente como se fosse "sem dívida".
   */
  endividamentoGeralDadosCompletos: boolean;
  /** Dívida Onerosa ÷ Patrimônio Líquido × 100 */
  grauEndividamento: number;
  /** EBIT ÷ Despesas Financeiras */
  coberturaJuros: number;
  /** Receita Líquida ÷ Ativo Total */
  giroAtivo: number;
  /** (Dívida Total − Caixa) ÷ EBITDA */
  dividaLiqEbitda: number;
  /** (Dívida Total − Caixa) ÷ EBIT */
  dividaLiqEbit: number;
  /** (Dívida Total − Caixa) ÷ Patrimônio Líquido */
  dividaLiqPl: number;
  /**
   * Tempo (em anos) para o Lucro Líquido acumulado recuperar o Patrimônio Líquido.
   * NÃO é o payback clássico (CAPEX ÷ FCF) — é o período de amortização do PL pelo lucro
   * contábil. Mantido por compatibilidade. Para o payback clássico use `paybackCapex`.
   */
  amortizacaoPlPorLucro: number;
  /**
   * Payback clássico (anos): CAPEX inicial ÷ FCF anual. Mede tempo para o investimento
   * inicial ser recuperado pela geração de caixa. `Infinity` quando FCF ≤ 0 ou CAPEX inicial = 0.
   */
  paybackCapex: number;
  /** @deprecated Use `amortizacaoPlPorLucro` (mesma fórmula). Mantido para retrocompat. */
  payback: number;
  /** FCF Operacional (CFO): EBITDA − Impostos − Δ NCG. ANTES do CAPEX. */
  fcf: number;
  /** CAPEX anual total: plano mensal + ativações do ano. */
  capexAnual: number;
  /** FCF após CAPEX (≈ FCFF): CFO − CAPEX. Caixa livre real. */
  fcfAposCapex: number;
  /** FCF ÷ EBITDA × 100 */
  conversaoEbitdaCaixa: number;
  /** Margem de Contribuição (R$) ÷ EBIT — elasticidade do lucro à receita. */
  gao: number;
  /** FCF ÷ Lucro Líquido — quanto do lucro contábil vira caixa. */
  qualidadeLucro: number;
  /** Receita Líquida Anual ÷ nº de colaboradores. */
  receitaPorColaborador: number;
  /** Receita BRUTA Anual ÷ nº de colaboradores — métrica clássica de benchmarking ("Faturamento/Colab"). */
  faturamentoPorColaborador: number;
  /** EBITDA Anual ÷ nº de colaboradores. */
  ebitdaPorColaborador: number;
  /** Lucro Líquido Anual ÷ nº de colaboradores. */
  lucroPorColaborador: number;
  /** Folha total anual (com encargos) ÷ Receita Líquida × 100. */
  custoPessoalSobreReceita: number;
  /** (Receita − Ponto de Equilíbrio) ÷ Receita × 100 — folga de receita antes do prejuízo. */
  margemSeguranca: number;
  /** EBITDA ÷ (Juros + Amortizações de Principal) — métrica bancária de cobertura do serviço da dívida. */
  dscr: number;
  /**
   * true quando `state.cashflow.amortizacoes` traz algum valor > 0 no ano.
   * Se false, o DSCR colapsa para a Cobertura de Juros (EBITDA ÷ Juros) — o consultor
   * precisa saber que o resultado pode estar superestimado por falta do cronograma.
   */
  dscrAmortizacoesInformadas: boolean;
  dividaOnerosa: number;
  passivoCirculante: number;
  ativoCirculante: number;
}

export function calcIndicators(state: AppState, dre: DRE): Indicators {
  const { capital, revenue } = state;
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const receitaBrutaAnual = sum(dre.receitaBruta);
  const lucroBrutoAnual = sum(dre.lucroBruto);
  const ebitdaAnual = sum(dre.ebitda);
  const ebitAnual = sum(dre.ebit);
  const lairAnual = sum(dre.lair);
  const llAnual = sum(dre.lucroLiquido);
  const custosVarAnual = sum(dre.custosVariaveis);
  const custosFixosAnual = sum(dre.custosFixos) + sum(dre.depreciacao);
  const jurosAnual = sum(dre.custosFinanceirosTotal);
  const impostosAnual = sum(dre.impostos);

  // SSOT: safeMath previne NaN/Infinity em qualquer divisão de indicador.
  const depreciacaoAnual = sum(dre.depreciacao);
  const custosFixosOperacionaisSemDep = custosFixosAnual - depreciacaoAnual;
  const custosFixosComJuros = custosFixosAnual + jurosAnual;
  const margemContribuicao = safePct(receitaLiqAnual - custosVarAnual, receitaLiqAnual);
  const mcFrac = margemContribuicao / 100;
  const pontoEquilibrioOperacional = margemContribuicao > 0 ? safeDivide(custosFixosAnual, mcFrac) : 0;
  const pontoEquilibrio = margemContribuicao > 0 ? safeDivide(custosFixosComJuros, mcFrac) : 0;
  const pontoEquilibrioFinanceiro = margemContribuicao > 0 ? safeDivide(custosFixosOperacionaisSemDep, mcFrac) : 0;

  // ---- Estrutura de capital baseada em campos REAIS ----
  const PL = Math.max(0, capital.patrimonioLiquido);
  const D = Math.max(0, capital.dividaOnerosa);
  const V = PL + D;
  const wE = V > 0 ? PL / V : capital.proprio / 100;
  const wD = V > 0 ? D / V : 1 - capital.proprio / 100;

  // SSOT: WACC usa shield do regime EFETIVO. Ke piso 8% (Selic neutra).
  const irShield = irShieldForRegime(resolveEffectiveRegime(state), lairAnual);
  const keSeguro = capital.ke > 0 ? capital.ke : 8;
  const wacc = wE * keSeguro + wD * capital.kd * (1 - irShield);

  // ---- NOPAT e ROIC com alíquota MARGINAL (Damodaran/Koller) ----
  const tcMarginal = Math.max(0, Math.min(0.5, irShield));
  const nopat = Math.max(0, ebitAnual * (1 - tcMarginal));

  // Capital Investido — preferimos lado financiamento (PL + D − caixa ocioso).
  const pno = Math.max(0, capital.passivosNaoOnerosos ?? capital.fornecedores ?? 0);
  const caixaOcioso = Math.max(0, capital.caixaOcioso ?? 0);
  const ciFinanciamento = PL + D;
  const ciAtivo = capital.ativoTotal > 0 ? capital.ativoTotal - pno : 0;
  const ciBase = ciFinanciamento > 0 ? ciFinanciamento : (ciAtivo > 0 ? ciAtivo : (PL + D + pno) - pno);
  const capitalInvestido = Math.max(1, ciBase - caixaOcioso);
  const roic = safePct(nopat, capitalInvestido);

  // ROE com PL MÉDIO (CFA/Damodaran).
  const plAbertura = Math.max(0, capital.patrimonioLiquidoAbertura ?? 0);
  const plMedio = plAbertura > 0 ? (plAbertura + PL) / 2 : PL;
  const roe = plMedio > 0 ? safePct(llAnual, plMedio) : 0;
  const roa = capital.ativoTotal > 0 ? safePct(llAnual, capital.ativoTotal) : 0;

  // ---- Ciclo / NCG / Gap ----
  const ei = Math.max(0, capital.estoqueInicial ?? 0);
  const ef = Math.max(0, capital.estoqueFinal ?? 0);
  const estoqueMedio = ei > 0 && ef > 0 ? (ei + ef) / 2 : (ef > 0 ? ef : capital.estoques);
  const cpvDiario = sum(dre.cpv) / 360;
  const pme = estoqueMedio > 0 && cpvDiario > 0 ? estoqueMedio / cpvDiario : 0;
  const cicloFinanceiro = revenue.pmr + pme - revenue.pmp;
  const crEstimado = capital.contasReceber > 0 ? capital.contasReceber : (receitaLiqAnual / 360) * revenue.pmr;
  const fornecEstimado = capital.fornecedores > 0 ? capital.fornecedores : (sum(dre.cpv) / 360) * revenue.pmp;
  const ncg = crEstimado + estoqueMedio - fornecEstimado;
  const gapCapitalGiro = ncg - capital.capitalGiroDisponivel;

  // ---- Liquidez ----
  const ativoCirculante = capital.ativoCirculante > 0
    ? capital.ativoCirculante
    : capital.disponibilidades + crEstimado + capital.estoques;
  const passivoCirculante = capital.passivoCirculante > 0
    ? capital.passivoCirculante
    : Math.max(0, fornecEstimado + D * 0.3); // estimativa: 30% da dívida vence em CP

  const CAP_LIQ = 99;
  const liquidezCorrente = passivoCirculante > 1 ? Math.min(CAP_LIQ, ativoCirculante / passivoCirculante) : CAP_LIQ;
  const liquidezSeca = passivoCirculante > 1 ? Math.min(CAP_LIQ, (ativoCirculante - estoqueMedio) / passivoCirculante) : CAP_LIQ;
  const liquidezImediata = passivoCirculante > 1 ? Math.min(CAP_LIQ, capital.disponibilidades / passivoCirculante) : CAP_LIQ;

  // ---- Endividamento ----
  const endividamentoGeralDadosCompletos = capital.ativoTotal > 0;
  let endividamentoGeral = 0;
  if (endividamentoGeralDadosCompletos) {
    const passivoTotalEstim = Math.max(0, capital.ativoTotal - PL);
    endividamentoGeral = (passivoTotalEstim / capital.ativoTotal) * 100;
  } else {
    const passivoConhecido = D + pno;
    const ativoProxy = PL + D + pno;
    endividamentoGeral = ativoProxy > 0 ? (passivoConhecido / ativoProxy) * 100 : 0;
  }
  const grauEndividamento = PL > 0 ? (D / PL) * 100 : 0;
  const CAP_COB = 999;
  const CAP_DL_EBITDA = 99;
  const CAP_PAYBACK = 99;
  const coberturaJuros = jurosAnual > 1 ? Math.min(CAP_COB, safeDivide(ebitAnual, jurosAnual, CAP_COB)) : CAP_COB;
  const giroAtivo = capital.ativoTotal > 0 ? safeDivide(receitaLiqAnual, capital.ativoTotal) : 0;
  const dividaLiq = computeNetDebt(state); // SSOT-1: helper único.
  const dividaLiqEbitda = ebitdaAnual > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitdaAnual))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const dividaLiqEbit = ebitAnual > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitAnual))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const dividaLiqPl = PL > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / PL))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const amortizacaoPlPorLucro = llAnual > 1 ? Math.min(CAP_PAYBACK, PL / llAnual) : (PL <= 0 ? 0 : CAP_PAYBACK);
  const payback = amortizacaoPlPorLucro; // @deprecated alias

  const fcf = ebitdaAnual - impostosAnual - Math.max(0, ncg - capital.capitalGiroDisponivel);
  const capexAnual = sum(state.cashflow.capex ?? [])
    + (capital.capexAtivacao ?? []).reduce((acc, ca) => acc + ((ca && (ca.valor || 0) > 0) ? (ca.valor || 0) : 0), 0);
  const fcfAposCapex = fcf - capexAnual;
  const capexMes1 = (state.cashflow.capex?.[0] ?? 0)
    + (capital.capexAtivacao ?? []).reduce((acc, ca) => acc + (ca && ca.mes === 1 ? (ca.valor || 0) : 0), 0);
  const paybackCapex = capexMes1 > 0 && fcf > 1
    ? Math.min(CAP_PAYBACK, capexMes1 / fcf)
    : (capexMes1 <= 0 ? 0 : CAP_PAYBACK);

  const mcReais = receitaLiqAnual - custosVarAnual;
  const gao = Math.abs(ebitAnual) > 1 ? Math.max(-99, Math.min(99, mcReais / ebitAnual)) : 0;
  const qualidadeLucro = Math.abs(llAnual) > 1 ? Math.max(-9, Math.min(9, fcfAposCapex / llAnual)) : 0;

  const headcount = Math.max(0, state.numColaboradores ?? 0);
  const receitaPorColaborador = headcount > 0 ? receitaLiqAnual / headcount : 0;
  const faturamentoPorColaborador = headcount > 0 ? receitaBrutaAnual / headcount : 0;
  const ebitdaPorColaborador = headcount > 0 ? ebitdaAnual / headcount : 0;
  const lucroPorColaborador = headcount > 0 ? llAnual / headcount : 0;
  const folha = folhaAnual(state);
  const custoPessoalSobreReceita = receitaLiqAnual > 0 ? (folha / receitaLiqAnual) * 100 : 0;

  const margemSeguranca = receitaLiqAnual > 0 && pontoEquilibrio > 0
    ? Math.max(-999, Math.min(999, ((receitaLiqAnual - pontoEquilibrio) / receitaLiqAnual) * 100))
    : 0;

  const amortizPrincipalAnual = sum(state.cashflow.amortizacoes);
  const dscrAmortizacoesInformadas = amortizPrincipalAnual > 0;
  const servicoDivida = jurosAnual + amortizPrincipalAnual;
  const CAP_DSCR = 99;
  const dscr = servicoDivida > 1
    ? Math.max(-CAP_DSCR, Math.min(CAP_DSCR, ebitdaAnual / servicoDivida))
    : (ebitdaAnual <= 0 ? 0 : CAP_DSCR);

  return {
    margemBruta: safePct(lucroBrutoAnual, receitaLiqAnual),
    margemEbitda: safePct(ebitdaAnual, receitaLiqAnual),
    margemEbit: safePct(ebitAnual, receitaLiqAnual),
    margemLiquida: safePct(llAnual, receitaLiqAnual),
    margemContribuicao, pontoEquilibrio, pontoEquilibrioOperacional, pontoEquilibrioFinanceiro,
    roe, roa, roic, wacc: safeNumber(wacc),
    cicloFinanceiro, ncg, gapCapitalGiro,
    liquidezCorrente, liquidezSeca, liquidezImediata,
    endividamentoGeral, endividamentoGeralDadosCompletos, grauEndividamento, coberturaJuros, giroAtivo,
    dividaLiqEbitda, dividaLiqEbit, dividaLiqPl, payback, amortizacaoPlPorLucro, paybackCapex, fcf: safeNumber(fcf),
    capexAnual: safeNumber(capexAnual), fcfAposCapex: safeNumber(fcfAposCapex),
    conversaoEbitdaCaixa: ebitdaAnual > 0 ? safePct(fcf, ebitdaAnual) : 0,
    gao, qualidadeLucro,
    receitaPorColaborador, faturamentoPorColaborador, ebitdaPorColaborador, lucroPorColaborador, custoPessoalSobreReceita,
    margemSeguranca, dscr, dscrAmortizacoesInformadas,
    dividaOnerosa: D, passivoCirculante, ativoCirculante,
  };
}
