// =====================================================================
// INDICADORES — margens, PE, ROIC/WACC, liquidez, endividamento, FCF.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// Função única `calcIndicators`; sem extração de sub-blocos nesta fase.
// =====================================================================

import { AppState } from "./types";
import { sum } from "./format";
import { safeDivide, safePct, safeNumber } from "./safeMath";
import { computeNetDebt, computeCapexMensal } from "./shared";
import { folhaAnual, resolveEffectiveRegime } from "./regime";
import { irShieldForRegime } from "./tax/real";
import type { DRE } from "./dre";
import { buildCashFlow } from "./cashflow";
import { mesesPreenchidos, anualizar } from "./periodUtils";

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
  /** FCO ÷ Lucro Líquido — quanto do lucro contábil virou caixa operacional (CPC 03/IAS 7). */
  qualidadeLucro: number;
  /** Receita Líquida Anual ÷ nº de colaboradores. */
  receitaPorColaborador: number;
  /** Receita BRUTA Anual ÷ nº de colaboradores — métrica clássica de benchmarking ("Faturamento/Colab"). */
  faturamentoPorColaborador: number;
  /** EBITDA Anual ÷ nº de colaboradores. */
  ebitdaPorColaborador: number;
  /** Lucro Líquido Anual ÷ nº de colaboradores. */
  lucroPorColaborador: number;
  /**
   * Folha/Receita = Folha Total Anual ÷ Receita BRUTA Anual × 100.
   * Folha Total inclui: pró-labore + salários CLT (c/ encargos) + benefícios + PLR +
   * mão de obra terceirizada. NÃO inclui comissões (custo comercial). Ver `folhaAnual`
   * em `regime.ts` para a regra exata de classificação.
   */
  custoPessoalSobreReceita: number;
  /**
   * Margem de Segurança = (Receita Líquida − Ponto de Equilíbrio OPERACIONAL) ÷ Receita Líquida × 100.
   * Base: Receita Líquida ANUAL (receita bruta − deduções − tributos sobre venda) — mesma
   * base usada no cálculo da Margem de Contribuição e do PE (custosFixos ÷ MC%).
   * Usa o PE OPERACIONAL (sem juros) — folga genuína de OPERAÇÃO antes do prejuízo;
   * incluir juros mistura risco financeiro com risco operacional.
   */
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
  /** Dívida Líquida (D − caixa). Negativa = posição líquida de caixa (cash-rich). */
  dividaLiquida: number;
  passivoCirculante: number;
  ativoCirculante: number;
  /** (Impostos sobre Vendas + IRPJ/CSLL) ÷ Receita Bruta × 100 — carga tributária total sobre a receita. */
  impostosSobreReceita: number;
  /** (Impostos sobre Vendas + IRPJ/CSLL) ÷ Lucro Líquido × 100 — quanto de imposto para cada R$ de lucro. */
  impostosSobreLucro: number;
}

export function calcIndicators(state: AppState, dre: DRE): Indicators {
  const { capital, revenue } = state;
  // ─── Janela efetiva preenchida (Fase 1) ──────────────────────────────
  // Indicadores que comparam fluxo (DRE) com estoque (BP) ou per-capita
  // devem usar valores ANUALIZADOS — se o consultor só preencheu 3 meses,
  // dividir por 12 subestima EBITDA/Colab, DL/EBITDA, ROIC etc.
  // Margens (ratios fluxo/fluxo do mesmo período) cancelam — não precisam,
  // mas anualizamos por consistência (resultado idêntico).
  const meses = mesesPreenchidos(
    dre.receitaBruta,
    dre.receitaLiquida,
    dre.custosVariaveis,
    dre.custosFixos,
    dre.depreciacao,
    dre.impostos,
    dre.impostosVendas,
  );
  const an = (v: number) => anualizar(v, meses);

  const receitaLiqAnual = an(sum(dre.receitaLiquida));
  const receitaBrutaAnual = an(sum(dre.receitaBruta));
  const lucroBrutoAnual = an(sum(dre.lucroBruto));
  const ebitdaAnual = an(sum(dre.ebitda));
  const ebitAnual = an(sum(dre.ebit));
  const lairAnual = an(sum(dre.lair));
  const llAnual = an(sum(dre.lucroLiquido));
  const custosVarAnual = an(sum(dre.custosVariaveis));
  const custosFixosAnual = an(sum(dre.custosFixos) + sum(dre.depreciacao));
  const jurosAnual = an(sum(dre.custosFinanceirosTotal));
  const impostosAnual = an(sum(dre.impostos));
  const impostosVendasAnual = an(sum(dre.impostosVendas));
  const cpvAnual = an(sum(dre.cpv));

  // SSOT: safeMath previne NaN/Infinity em qualquer divisão de indicador.
  const depreciacaoAnual = an(sum(dre.depreciacao));
  const custosFixosOperacionaisSemDep = custosFixosAnual - depreciacaoAnual;
  const custosFixosComJuros = custosFixosAnual + jurosAnual;
  const margemContribuicao = safePct(receitaLiqAnual - custosVarAnual, receitaLiqAnual);
  const mcFrac = margemContribuicao / 100;
  const pontoEquilibrioOperacional =
    margemContribuicao > 0 ? safeDivide(custosFixosAnual, mcFrac) : 0;
  const pontoEquilibrio = margemContribuicao > 0 ? safeDivide(custosFixosComJuros, mcFrac) : 0;
  const pontoEquilibrioFinanceiro =
    margemContribuicao > 0 ? safeDivide(custosFixosOperacionaisSemDep, mcFrac) : 0;

  // ---- Estrutura de capital baseada em campos REAIS ----
  const PL = Math.max(0, capital.patrimonioLiquido);
  const D = Math.max(0, capital.dividaOnerosa);
  const V = PL + D;
  // CONTRATO: `capital.proprio` é PERCENTUAL no intervalo [0, 100], NÃO fração.
  // Validado em Zod no schema do capital. Se mudar para fração, ajustar aqui também.
  const wE = V > 0 ? PL / V : capital.proprio / 100;
  const wD = V > 0 ? D / V : 1 - capital.proprio / 100;

  // SSOT: WACC usa shield do regime EFETIVO. Ke piso 8% (Selic neutra).
  const irShield = irShieldForRegime(resolveEffectiveRegime(state), lairAnual);
  const keSeguro = capital.ke > 0 ? capital.ke : 8;
  const wacc = wE * keSeguro + wD * capital.kd * (1 - irShield);

  // ---- NOPAT e ROIC com alíquota EFETIVA observada ----
  // Lucro Real: IR + CSLL incidem sobre o LAIR — usar dre.impostos / receita bruta.
  // Lucro Presumido / Simples: IR/CSLL/DAS incidem sobre RECEITA (base presumida),
  // não sobre o LAIR. Se a carga tributária consumir mais que o LAIR (lucro
  // contábil baixo ou negativo, mas tributos altos sobre receita), o NOPAT
  // calculado por (1 − t_marginal_receita) fica artificialmente alto e o ROIC
  // dispara. Para refletir a realidade, nesses regimes usamos a alíquota
  // EFETIVA sobre o LAIR, limitada a 100% para zerar o NOPAT em vez de inverter o sinal.
  const impostosLucroAnual = impostosAnual;
  const dasAnual = impostosVendasAnual;
  const regimeEfetivo = resolveEffectiveRegime(state);
  const impostosParaAliquota = regimeEfetivo === "simples" ? dasAnual : impostosLucroAnual;

  let aliquotaEfetiva: number;
  if (regimeEfetivo === "presumido" || regimeEfetivo === "simples") {
    // t efetivo sobre o LAIR; se LAIR ≤ 0 e há tributos, t = 1 (NOPAT = 0).
    if (lairAnual > 1) {
      aliquotaEfetiva = Math.min(1, impostosParaAliquota / lairAnual);
    } else {
      aliquotaEfetiva = impostosParaAliquota > 0 ? 1 : 0;
    }
  } else {
    aliquotaEfetiva =
      receitaBrutaAnual > 0
        ? Math.max(0, Math.min(0.5, impostosParaAliquota / receitaBrutaAnual))
        : 0;
  }
  const nopat = Math.max(0, ebitAnual * (1 - aliquotaEfetiva));

  // Capital Investido — preferimos lado financiamento (PL + D − caixa ocioso).
  const pno = Math.max(0, capital.passivosNaoOnerosos ?? capital.fornecedores ?? 0);
  const caixaOcioso = Math.max(0, capital.caixaOcioso ?? 0);
  const ciFinanciamento = PL + D;
  const ciAtivo = capital.ativoTotal > 0 ? capital.ativoTotal - pno : 0;
  // Se nenhum dos dois lados está disponível, usa 0 — o `Math.max(1, …)` abaixo
  // garante denominador mínimo para evitar divisão por zero no ROIC.
  const ciBase = ciFinanciamento > 0 ? ciFinanciamento : ciAtivo > 0 ? ciAtivo : 0;
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
  const estoqueMedio = ei > 0 && ef > 0 ? (ei + ef) / 2 : ef > 0 ? ef : capital.estoques;
  const cpvDiario = cpvAnual / 360;
  const pme = estoqueMedio > 0 && cpvDiario > 0 ? estoqueMedio / cpvDiario : 0;
  const cicloFinanceiro = revenue.pmr + pme - revenue.pmp;
  const crEstimado =
    capital.contasReceber > 0 ? capital.contasReceber : (receitaLiqAnual / 360) * revenue.pmr;
  const fornecEstimado =
    capital.fornecedores > 0 ? capital.fornecedores : (cpvAnual / 360) * revenue.pmp;
  const ncg = crEstimado + estoqueMedio - fornecEstimado;
  // SSOT: caixa disponível imediato = `disponibilidades` (Caixa+Bancos do BP).
  // O campo legado `capitalGiroDisponivel` foi descontinuado na UI; usamos
  // como fallback apenas para estados antigos sem `disponibilidades`.
  const caixaImediato = capital.disponibilidades > 0
    ? capital.disponibilidades
    : (capital.capitalGiroDisponivel ?? 0);
  const gapCapitalGiro = ncg - caixaImediato;

  // ---- Liquidez ----
  const ativoCirculante =
    capital.ativoCirculante > 0
      ? capital.ativoCirculante
      : capital.disponibilidades + crEstimado + capital.estoques;
  // Auditoria #10: a fração da dívida onerosa que vence em CP é configurável
  // (`capital.dividaCurtoPrazoPct`, default 0.30). Estimativa só é usada quando
  // o consultor não informou `passivoCirculante` real.
  const dividaCpFrac = Math.min(1, Math.max(0, capital.dividaCurtoPrazoPct ?? 0.3));
  const passivoCirculante =
    capital.passivoCirculante > 0
      ? capital.passivoCirculante
      : Math.max(0, fornecEstimado + D * dividaCpFrac);

  const CAP_LIQ = 99;
  const liquidezCorrente =
    passivoCirculante > 1 ? Math.min(CAP_LIQ, ativoCirculante / passivoCirculante) : CAP_LIQ;
  const liquidezSeca =
    passivoCirculante > 1
      ? Math.min(CAP_LIQ, (ativoCirculante - estoqueMedio) / passivoCirculante)
      : CAP_LIQ;
  const liquidezImediata =
    passivoCirculante > 1
      ? Math.min(CAP_LIQ, capital.disponibilidades / passivoCirculante)
      : CAP_LIQ;

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
  const coberturaJuros =
    jurosAnual > 1 ? Math.min(CAP_COB, safeDivide(ebitAnual, jurosAnual, CAP_COB)) : CAP_COB;
  const giroAtivo = capital.ativoTotal > 0 ? safeDivide(receitaLiqAnual, capital.ativoTotal) : 0;
  const dividaLiq = computeNetDebt(state); // SSOT-1: helper único.
  // Cash-rich (dividaLiq < 0) com base ≤ 1: usa sentinela negativa para PRESERVAR o sinal
  // (antes retornava 0 e escondia a posição líquida de caixa).
  const dividaLiqEbitda =
    ebitdaAnual > 1
      ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitdaAnual))
      : dividaLiq < 0
        ? -CAP_DL_EBITDA
        : dividaLiq === 0
          ? 0
          : CAP_DL_EBITDA;
  const dividaLiqEbit =
    ebitAnual > 1
      ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitAnual))
      : dividaLiq < 0
        ? -CAP_DL_EBITDA
        : dividaLiq === 0
          ? 0
          : CAP_DL_EBITDA;
  const dividaLiqPl =
    PL > 1
      ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / PL))
      : dividaLiq < 0
        ? -CAP_DL_EBITDA
        : dividaLiq === 0
          ? 0
          : CAP_DL_EBITDA;
  const amortizacaoPlPorLucro =
    llAnual > 1 ? Math.min(CAP_PAYBACK, PL / llAnual) : PL <= 0 ? 0 : CAP_PAYBACK;
  const payback = amortizacaoPlPorLucro; // @deprecated alias

  // Auditoria #3: ΔNCG (variação anual) em vez do gap total.
  // Usa `ncgAbertura` quando informada; senão `disponibilidades` (caixa+bancos)
  // como proxy da NCG já financiada na abertura — fonte única de caixa.
  const ncgAbertura = Math.max(0, capital.ncgAbertura ?? capital.disponibilidades ?? 0);
  const deltaNcgAnual = Math.max(0, ncg - ncgAbertura);
  // FCFF (Free Cash Flow to the Firm) padrão Damodaran/Koller:
  //   FCFF = NOPAT + D&A − ΔNCG − CAPEX
  // `nopat` já calculado acima com a alíquota efetiva observada do regime.
  const depAnual = depreciacaoAnual;
  const fcf = nopat + depAnual - deltaNcgAnual;
  // SSOT: mesmo CAPEX usado no FCI do buildCashFlow (manual + ativações de imobilizado).
  // Anualizado: se só 3 meses preenchidos, o CAPEX projetado para o ano também escala.
  const capexAnual = an(sum(computeCapexMensal(state)));
  const fcfAposCapex = fcf - capexAnual;
  // Auditoria #2: payback do CAPEX usa o CAPEX ANUAL TOTAL, não apenas o do mês 1.
  // CAPEX distribuído ao longo do ano (obras, implantações) era subestimado em até 10×.
  const paybackCapex =
    capexAnual > 0 && fcf > 1
      ? Math.min(CAP_PAYBACK, capexAnual / fcf)
      : capexAnual <= 0
        ? 0
        : CAP_PAYBACK;

  const mcReais = receitaLiqAnual - custosVarAnual;
  const gao = Math.abs(ebitAnual) > 1 ? Math.max(-99, Math.min(99, mcReais / ebitAnual)) : 0;
  // Qualidade do Lucro = FCO / Lucro Líquido (CPC 03/IAS 7).
  // Usa o MESMO FCO do FluxoCaixaTab (buildCashFlow.fluxoOperacional),
  // não o FCFF estimado — caixa operacional realizado vs. lucro contábil.
  // Edge cases: LL ≈ 0 → 0 (UI deve renderizar "N/A").
  // SSOT: mesma chamada do FluxoCaixaTab — `buildCashFlow(state)` resolve o regime efetivo
  // internamente. `totais.fluxoOperacional` é exatamente `sum(fluxoOperacional)`.
  const fcoAnual = an(buildCashFlow(state).totais.fluxoOperacional);
  const qualidadeLucro =
    Math.abs(llAnual) > 1 ? Math.max(-9, Math.min(9, fcoAnual / llAnual)) : 0;

  const headcount = Math.max(0, state.numColaboradores ?? 0);
  const receitaPorColaborador = headcount > 0 ? receitaLiqAnual / headcount : 0;
  const faturamentoPorColaborador = headcount > 0 ? receitaBrutaAnual / headcount : 0;
  const ebitdaPorColaborador = headcount > 0 ? ebitdaAnual / headcount : 0;
  const lucroPorColaborador = headcount > 0 ? llAnual / headcount : 0;
  // Folha/Receita: divide pela Receita BRUTA (padrão de benchmarking PME) — não a líquida.
  // folhaAnual já é total acumulado da janela preenchida → anualizar.
  const folha = an(folhaAnual(state));
  const custoPessoalSobreReceita = receitaBrutaAnual > 0 ? (folha / receitaBrutaAnual) * 100 : 0;

  // Margem de Segurança OPERACIONAL: usa o PE operacional (sem juros) sobre a Receita Líquida.
  // Mesma base do PE (custosFixos ÷ MC%, onde MC% = (RL − custosVar) ÷ RL).
  const margemSeguranca =
    receitaLiqAnual > 0 && pontoEquilibrioOperacional > 0
      ? Math.max(
          -999,
          Math.min(999, ((receitaLiqAnual - pontoEquilibrioOperacional) / receitaLiqAnual) * 100),
        )
      : 0;

  const amortizPrincipalAnual = an(sum(state.cashflow.amortizacoes));
  const dscrAmortizacoesInformadas = amortizPrincipalAnual > 0;
  const servicoDivida = jurosAnual + amortizPrincipalAnual;
  const CAP_DSCR = 99;
  const dscr =
    servicoDivida > 1
      ? Math.max(-CAP_DSCR, Math.min(CAP_DSCR, ebitdaAnual / servicoDivida))
      : ebitdaAnual <= 0
        ? 0
        : CAP_DSCR;

  return {
    margemBruta: safePct(lucroBrutoAnual, receitaLiqAnual),
    margemEbitda: safePct(ebitdaAnual, receitaLiqAnual),
    margemEbit: safePct(ebitAnual, receitaLiqAnual),
    margemLiquida: safePct(llAnual, receitaLiqAnual),
    margemContribuicao,
    pontoEquilibrio,
    pontoEquilibrioOperacional,
    pontoEquilibrioFinanceiro,
    roe,
    roa,
    roic,
    wacc: safeNumber(wacc),
    cicloFinanceiro,
    ncg,
    gapCapitalGiro,
    liquidezCorrente,
    liquidezSeca,
    liquidezImediata,
    endividamentoGeral,
    endividamentoGeralDadosCompletos,
    grauEndividamento,
    coberturaJuros,
    giroAtivo,
    dividaLiqEbitda,
    dividaLiqEbit,
    dividaLiqPl,
    payback,
    amortizacaoPlPorLucro,
    paybackCapex,
    fcf: safeNumber(fcf),
    capexAnual: safeNumber(capexAnual),
    fcfAposCapex: safeNumber(fcfAposCapex),
    conversaoEbitdaCaixa: ebitdaAnual > 0 ? safePct(fcf, ebitdaAnual) : 0,
    gao,
    qualidadeLucro,
    receitaPorColaborador,
    faturamentoPorColaborador,
    ebitdaPorColaborador,
    lucroPorColaborador,
    custoPessoalSobreReceita,
    margemSeguranca,
    dscr,
    dscrAmortizacoesInformadas,
    dividaOnerosa: D,
    dividaLiquida: dividaLiq,
    passivoCirculante,
    ativoCirculante,
    impostosSobreReceita:
      receitaBrutaAnual > 0
        ? ((impostosVendasAnual + impostosAnual) / receitaBrutaAnual) * 100
        : 0,
    impostosSobreLucro:
      llAnual > 1 ? ((impostosVendasAnual + impostosAnual) / llAnual) * 100 : 0,
  };
}
