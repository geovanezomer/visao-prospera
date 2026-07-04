// Balanço de Fechamento POR CONSERVAÇÃO DE MASSA (SSOT).
//
// Refatoração (2026-07-04): substituídas as fórmulas paralelas de "regime
// permanente" (CR = Receita×PMR/360, Forn. = CPV×PMP/360, Impostos = rotina
// própria) pela identidade fundamental:
//
//     saldoFim = saldoAbertura + competência_período − caixa_período
//
// Assim o balanço herda os efeitos de PMR/PMP/lag tributário DIRETAMENTE da
// DFC, garantindo Ativo ≡ Passivo + PL por construção mesmo em cenários com
// sazonalidade, contratos de dívida, Split Payment, aportes e dividendos.
//
// Detalhamento por rubrica:
//   Caixa_fim          = saldoFinal[11] da DFC (fluxo real)
//   CR_fim             = CR_ini      + Recebível          − Recebimentos DFC
//   Estoques_fim       = Estoques_ini (compras ≈ CPV → estoque steady-state)
//   Fornecedores_fim   = Forn_ini    + Compras (dre.cpv)  − PagFornec DFC
//   ImpostosPagar_fim  = ImpPagar_ini + dre.impostosTotal  − PagImpostos DFC
//   Empréstimos_fim    = Emprést_ini + Captações           − Amortizações DFC
//   Depreciação_acum   = DepAcum_ini + Σ dre.depreciacao (SSOT da DRE)
//   Capital_social_fim = Cap_ini + Σ cf.aportes
//   Resultado_exerc    = Lucro Líquido − Dividendos
//
// A DFC (cashflow.ts) faz a contrapartida: liquida os saldos de abertura de
// CR/Fornec/Impostos nos primeiros meses via `distributeByPrazo`, senão os
// saldos ficariam eternamente inflados no fechamento.
import type { AppState, BalancoDetalhado, CostLine } from "./types";
import type { FinancialModelCashflow, FinancialModelDRE } from "./financialModel";
import type { MonthlyTax } from "./tax/shared";
import { deriveAbertura } from "./aberturaDerivada";
import { safeNumber as n } from "./safeMath";
import { buildRecebivelMensal } from "./cashflow";
import { isFolhaCost, effectiveMonthValues } from "./costs";
import { resolveEffectiveRegime } from "./regime";


const sumArr = (a: number[] | undefined): number =>
  (a ?? []).reduce((x, y) => x + (y || 0), 0);

// (sumCostByCat removido — folha agora sai de `isFolhaCost` via SSOT.)

export interface DeriveOpts {
  state: AppState;
  dre: FinancialModelDRE;
  cf: FinancialModelCashflow;
  /** Mantido por retro-compatibilidade — não é mais consumido diretamente.
   *  A conservação de massa via `cf.pagamentosImpostos` já respeita o regime
   *  (Simples/Presumido/Real) e Split Payment automaticamente. */
  tax?: MonthlyTax;
}

export interface BalancoFechamentoResult {
  /** Balanço de fechamento derivado por construção. */
  balanco: BalancoDetalhado;
  /** Totais e diferença (deve ser ≈ 0 por construção). */
  totals: {
    ativo: number;
    passivo: number;
    pl: number;
    diferenca: number;
    fechado: boolean;
  };
}

/** Deriva o Balanço de Fechamento a partir da abertura + período. PURE. */
export function deriveBalancoFechamento({
  state,
  dre,
  cf,
}: DeriveOpts): BalancoFechamentoResult {
  const cap = state.capital;
  // Saldos de abertura — fonte única em `aberturaSSOT` (abaixo).
  const balConst = cap.balanco ?? {}; // itens patrimoniais constantes
  const imoConst = balConst.ativoNaoCirculante?.imobilizado ?? {};
  const intConst = balConst.ativoNaoCirculante?.intangivel ?? {};
  const plConst = balConst.patrimonioLiquido ?? {};

  // SSOT — saldos de abertura derivados (sem duplicar inputs do usuário).
  // Usa `dre.impostosTotal` (vendas + lucro) para alinhar com o kick da DFC.
  const aberturaSSOT = deriveAbertura({
    state,
    impostosMensais: dre.impostosTotal,
  });

  // ─────────────────────────── Movimentos do período ───────────────────────────
  // Folha anual — SSOT `isFolhaCost` (mesma regra usada por Fator R e por
  // aberturaDerivada). Usa `effectiveMonthValues` (com encargos) para casar
  // com o que a DRE lançou em custosFixos/variáveis e com o desembolso da
  // DFC (pagamentosFolha) — garantindo Sal_fim = Sal_ini + folhaAnual −
  // folhaPaga_DFC por conservação.
  const regime = resolveEffectiveRegime(state);
  const folhaAnual = (state.costs ?? [])
    .filter(isFolhaCost)
    .reduce((acc: number, l: CostLine) => acc + sumArr(effectiveMonthValues(l, regime)), 0);
  const lucroLiquidoAnual = sumArr(dre.lucroLiquido);

  // CAPEX ativado no período (base para imobilizado bruto).
  const capexAtivado = (cap.capexAtivacao ?? []).reduce(
    (a, c) => a + (c.valor || 0),
    0,
  );

  // Depreciação do período: SSOT único = dre.depreciacao (removido recálculo
  // local). Se a DRE mudar a regra de depreciação, o balanço acompanha.
  const depPeriodo = sumArr(dre.depreciacao);

  // Dividendos pagos e aportes recebidos no período (DFC — SSOT).
  const dividendosPagos = sumArr(cf.dividendos);
  const aportesPeriodo = sumArr(cf.aportes);

  // ─────────────────────────────── Ativo ───────────────────────────────
  // Caixa final: saldo de dez da DFC (fluxo real, considerando kick de abertura).
  const caixaFim = n(cf.saldoFinal?.[11]);

  // CR final — CONSERVAÇÃO DE MASSA:
  //   CR_fim = CR_ini + Recebível_período − Recebimentos DFC
  // Como a DFC recebeu no início o kick de CR_ini (via distributeByPrazo), o
  // resultado converge para o "transbordo" natural do PMR — sem inflar CR.
  const recebivelAnual = sumArr(buildRecebivelMensal(state, dre));
  const crFim = Math.max(
    0,
    aberturaSSOT.contasReceber.value +
      recebivelAnual -
      sumArr(cf.recebimentos),
  );

  // Estoques: compras ≈ CPV → estoque em steady-state = abertura.
  const estoquesFim =
    cap.estoques > 0 ? cap.estoques : aberturaSSOT.estoques.value;

  // Impostos a recuperar: assume constante (sem modelo de geração de crédito).
  const impostosRecuperarFim = aberturaSSOT.impostosRecuperar.value;

  // Imobilizado bruto = bruto_ini (subkeys constantes) + CAPEX ativado período.
  const imobBrutoIni =
    n(imoConst.terrenos) +
    n(imoConst.edificacoes) +
    n(imoConst.maquinasEquipamentos) +
    n(imoConst.veiculos) +
    n(imoConst.moveisUtensilios) +
    n(imoConst.outrosImobilizados);
  const outrosImobFim = n(imoConst.outrosImobilizados) + capexAtivado;

  // Depreciação acumulada = abertura + período (SSOT da DRE).
  const depAcumFim = aberturaSSOT.depreciacaoAcumulada.value + depPeriodo;

  // Amortização acumulada: sem fluxo modelado — mantém abertura.
  const amortAcumFim = aberturaSSOT.amortizacaoAcumulada.value;

  // ─────────────────────────────── Passivo ───────────────────────────────
  // Fornecedores final — CONSERVAÇÃO DE MASSA:
  //   Fornec_fim = Fornec_ini + Compras (CPV) − PagFornecedores DFC
  const comprasAnual = sumArr(dre.cpv);
  const fornecedoresFim = Math.max(
    0,
    aberturaSSOT.fornecedores.value +
      comprasAnual -
      sumArr(cf.pagamentosFornecedores),
  );

  // Empréstimos: saldo de abertura ± movimentos do período (DFC).
  const emprestimosIniTotal =
    aberturaSSOT.emprestimosCP.value + aberturaSSOT.emprestimosLP.value;
  const captacoesPeriodo = sumArr(cf.emprestimosCaptados);
  const amortizacoesPeriodo = sumArr(cf.amortizacoes);
  const emprestimosFimTotal = Math.max(
    0,
    emprestimosIniTotal + captacoesPeriodo - amortizacoesPeriodo,
  );
  const cpShare =
    emprestimosIniTotal > 0
      ? aberturaSSOT.emprestimosCP.value / emprestimosIniTotal
      : 0.3;
  const emprestimosCPFim = emprestimosFimTotal * cpShare;
  const emprestimosLPFim = emprestimosFimTotal * (1 - cpShare);

  // Impostos a pagar — CONSERVAÇÃO DE MASSA:
  //   ImpPagar_fim = ImpPagar_ini + Competência − Pagamentos DFC
  // A rotina paralela `computeImpostosPagarFechamento` foi removida daqui —
  // o efeito do regime + Split Payment é herdado automaticamente via
  // `cf.pagamentosImpostos` (que já respeita `partitionMonthlyTaxByLag`).
  const impostosCompetencia = sumArr(dre.impostosTotal);
  const impostosPagarFim = Math.max(
    0,
    aberturaSSOT.impostosPagar.value +
      impostosCompetencia -
      sumArr(cf.pagamentosImpostos),
  );

  // Salários a pagar — CONSERVAÇÃO DE MASSA:
  //   Sal_fim = Sal_ini + folhaAnual (competência) − folhaPaga_DFC
  // A DFC agora aplica lag 30d na folha (`isFolhaCost`) e liquida `Sal_ini`
  // no mês 1 — assim o resíduo em Sal_fim corresponde a ~1 mês da folha
  // (o mês 12 vira transbordo, provisionado no passivo).
  const salariosPagarFim = Math.max(
    0,
    aberturaSSOT.salariosEncargos.value +
      folhaAnual -
      sumArr(cf.pagamentosFolha),
  );

  // ─────────────────────────────── PL ───────────────────────────────
  // Aportes do período somam ao capital social (contrapartida contábil).
  const capitalSocial = n(plConst.capitalSocial) + aportesPeriodo;
  const reservasCapital = n(plConst.reservasCapital);
  const reservasLucros = n(plConst.reservasLucros);
  const lucrosAcumIni = aberturaSSOT.lucrosAcumulados.value;
  // Resultado do exercício = Lucro Líquido − Dividendos distribuídos.
  const resultadoExercicio = lucroLiquidoAnual - dividendosPagos;

  // ─────────────────────────── Monta BalancoDetalhado ───────────────────────────
  const balanco: BalancoDetalhado = {
    ativoCirculante: {
      caixaEquivalentes: caixaFim,
      contasReceberClientes: crFim,
      estoques: estoquesFim,
      impostosRecuperar: impostosRecuperarFim,
    },
    ativoNaoCirculante: {
      imobilizado: {
        terrenos: n(imoConst.terrenos),
        edificacoes: n(imoConst.edificacoes),
        maquinasEquipamentos: n(imoConst.maquinasEquipamentos),
        veiculos: n(imoConst.veiculos),
        moveisUtensilios: n(imoConst.moveisUtensilios),
        outrosImobilizados: outrosImobFim,
        depreciacaoAcumulada: depAcumFim,
      },
      intangivel: {
        marcasPatentes: n(intConst.marcasPatentes),
        goodwill: n(intConst.goodwill),
        outrosIntangiveis: n(intConst.outrosIntangiveis),
        amortizacaoAcumulada: amortAcumFim,
      },
    },
    passivoCirculante: {
      fornecedores: fornecedoresFim,
      emprestimosFinanciamentosCP: emprestimosCPFim,
      impostosPagar: impostosPagarFim,
      salariosEncargos: salariosPagarFim,
    },
    passivoNaoCirculante: {
      emprestimosFinanciamentosLP: emprestimosLPFim,
    },
    patrimonioLiquido: {
      capitalSocial,
      reservasCapital,
      reservasLucros,
      lucrosPrejuizosAcumulados: lucrosAcumIni,
      resultadoExercicio,
    },
    // Preserva snapshot N-1 se já existia (não-destrutivo).
    anterior: balConst.anterior,
  };

  // ─────────────────────────────── Totais ───────────────────────────────
  const ativoCirc = caixaFim + crFim + estoquesFim + impostosRecuperarFim;
  const imobLiq = imobBrutoIni + capexAtivado - depAcumFim;
  const intangLiq =
    n(intConst.marcasPatentes) +
    n(intConst.goodwill) +
    n(intConst.outrosIntangiveis) -
    amortAcumFim;
  const ativo = ativoCirc + imobLiq + intangLiq;

  const passivo =
    fornecedoresFim +
    emprestimosCPFim +
    emprestimosLPFim +
    impostosPagarFim +
    salariosPagarFim;

  const pl =
    capitalSocial +
    reservasCapital +
    reservasLucros +
    lucrosAcumIni +
    resultadoExercicio;

  const diferenca = ativo - (passivo + pl);
  const fechado = Math.abs(diferenca) < Math.max(100, ativo * 0.005);

  return {
    balanco,
    totals: { ativo, passivo, pl, diferenca, fechado },
  };
}
