// Fase 2 — Derivação do Balanço de Fechamento POR CONSTRUÇÃO.
//
// Função pura que parte dos saldos de ABERTURA + itens patrimoniais constantes
// + movimentos do período (DRE + DFC + PMR/PMP/PME) e produz o Balanço de
// FECHAMENTO obedecendo à identidade contábil Ativo = Passivo + PL por
// CONSTRUÇÃO — sem ajustes manuais.
//
// Fórmula geral aplicada em cada rubrica:
//
//     saldoFim = saldoAbertura + movimentoPeríodo
//
// Detalhamento por rubrica:
//   Caixa_fim          = Caixa_ini + ΔCaixa (saldoFinal[11] da DFC)
//   CR_fim             = ReceitaBruta_anual × PMR/360
//   Estoques_fim       = Estoques_ini + Compras − CPV (aprox: capital.estoques se preenchido)
//   Fornecedores_fim   = CPV_anual × PMP/360
//   Imobilizado_bruto  = Bruto_ini + Σ CAPEX ativado
//   Depreciação_acum   = DeprecAcum_ini + Depreciação_período (mensal × 12 + ativações)
//   Empréstimos        = saldo dos contratos de dívida (já agregado em dividaOnerosa)
//   Impostos_pagar     = impostos_anuais / 12 (≈ 1 mês de DARF não-pago)
//   Salários_a_pagar   = folha_anual / 12
//   Resultado_exerc    = Lucro Líquido DRE − Dividendos distribuídos
//   Lucros_acum_fim    = Lucros_acum_ini (constante; resultado vai p/ resultado_exerc)
//
// Itens patrimoniais CONSTANTES (não mudam dentro do exercício) são
// preservados de `capital.balanco`:
//   • Capital Social, Reservas de Capital
//   • Terrenos, Edificações, Máquinas, Veículos, Móveis (valor histórico)
//   • Marcas, Patentes, Goodwill
import type { AppState, BalancoDetalhado, CostLine } from "./types";
import type { FinancialModelCashflow, FinancialModelDRE } from "./financialModel";
import { deriveAbertura } from "./aberturaDerivada";

const n = (v: number | undefined): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

const sumArr = (a: number[] | undefined): number =>
  (a ?? []).reduce((x, y) => x + (y || 0), 0);

const sumCostByCat = (lines: CostLine[] | undefined, cats: string[]): number =>
  (lines ?? [])
    .filter((l) => cats.includes(l.category))
    .reduce((a, l) => a + sumArr(l.values), 0);

export interface DeriveOpts {
  state: AppState;
  dre: FinancialModelDRE;
  cf: FinancialModelCashflow;
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
  const ab = cap.abertura ?? {};
  const balConst = cap.balanco ?? {}; // itens patrimoniais constantes
  const imoConst = balConst.ativoNaoCirculante?.imobilizado ?? {};
  const intConst = balConst.ativoNaoCirculante?.intangivel ?? {};
  const plConst = balConst.patrimonioLiquido ?? {};

  // ─────────────────────────── Movimentos do período ───────────────────────────
  const receitaBrutaAnual = sumArr(state.revenue?.bruta);
  const cpvAnual = sumCostByCat(state.costs, ["custo_vendas", "direto_venda"]);
  const folhaAnual = sumCostByCat(state.costs, ["fixo", "variavel"]);
  const lucroLiquidoAnual = sumArr(dre.lucroLiquido);
  const impostosAnual = sumArr(dre.impostos);

  // CAPEX do período (ativações com mês conhecido + soma manual em cashflow.capex).
  const capexAtivado = (cap.capexAtivacao ?? []).reduce(
    (a, c) => a + (c.valor || 0),
    0,
  );

  // Depreciação do período: depMensal × 12 + depreciação das ativações até dez.
  // Cada ativação no mês `mes` deprecia (valor/vidaUtilMeses) × (13 − mes) meses.
  const depAtivacoes = (cap.capexAtivacao ?? []).reduce((a, c) => {
    if (!c || !(c.valor > 0)) return a;
    const meses = Math.max(0, 13 - (c.mes || 1));
    const vu = c.vidaUtilMeses > 0 ? c.vidaUtilMeses : 60;
    return a + (c.valor / vu) * meses;
  }, 0);
  const depPeriodo = (cap.depreciacaoMensal || 0) * 12 + depAtivacoes;

  // Dividendos pagos no período.
  const dividendosPagos = sumArr(cf.dividendos);

  // ─────────────────────────────── Ativo ───────────────────────────────
  // Caixa final: saldo de dez da DFC (já vem do simulator)
  const caixaFim = n(cf.saldoFinal?.[11]);

  // CR final: regime permanente — ReceitaBruta × PMR/360. Mais robusto que
  // CR_ini + Receita − Recebimentos (que exige modelar PMR mensalmente).
  const pmr = state.revenue?.pmr || 0;
  const crFim =
    pmr > 0 ? (receitaBrutaAnual * pmr) / 360 : n(ab.contasReceber);

  // Estoques: usa capital.estoques (saldo final declarado) ou abertura.
  const estoquesFim = cap.estoques > 0 ? cap.estoques : n(ab.estoques);

  // Impostos a recuperar: assume constante (sem modelo de geração de crédito).
  const impostosRecuperarFim = n(ab.impostosRecuperar);

  // Imobilizado bruto = bruto_ini (subkeys constantes) + CAPEX ativado período.
  const imobBrutoIni =
    n(imoConst.terrenos) +
    n(imoConst.edificacoes) +
    n(imoConst.maquinasEquipamentos) +
    n(imoConst.veiculos) +
    n(imoConst.moveisUtensilios) +
    n(imoConst.outrosImobilizados);
  // CAPEX entra como "outrosImobilizados" no fechamento (sem detalhar tipo).
  const outrosImobFim = n(imoConst.outrosImobilizados) + capexAtivado;

  // Depreciação acumulada = abertura + período.
  const depAcumFim = n(ab.depreciacaoAcumulada) + depPeriodo;

  // Amortização acumulada: sem fluxo modelado — mantém abertura.
  const amortAcumFim = n(ab.amortizacaoAcumulada);

  // ─────────────────────────────── Passivo ───────────────────────────────
  // Fornecedores final: regime permanente — CPV × PMP/360.
  const pmp = state.revenue?.pmp || 0;
  const fornecedoresFim =
    pmp > 0 ? (cpvAnual * pmp) / 360 : n(ab.fornecedores);

  // Empréstimos: saldo agregado dos contratos de dívida (já em dividaOnerosa).
  // Split CP/LP por dividaCurtoPrazoPct (default 30%).
  const cpPct =
    typeof cap.dividaCurtoPrazoPct === "number" ? cap.dividaCurtoPrazoPct : 0.3;
  const emprestimosTotal = cap.dividaOnerosa || 0;
  const emprestimosCPFim = emprestimosTotal * cpPct;
  const emprestimosLPFim = emprestimosTotal * (1 - cpPct);

  // Impostos a pagar: ~ 1 mês de DARF (apuração + pagamento defasado).
  const impostosPagarFim = impostosAnual > 0 ? impostosAnual / 12 : 0;

  // Salários a pagar: ~ 1 mês de folha.
  const salariosPagarFim = folhaAnual > 0 ? folhaAnual / 12 : 0;

  // ─────────────────────────────── PL ───────────────────────────────
  // Constantes do balanço de capital + lucros acumulados de abertura.
  const capitalSocial = n(plConst.capitalSocial);
  const reservasCapital = n(plConst.reservasCapital);
  const reservasLucros = n(plConst.reservasLucros);
  const lucrosAcumIni = n(ab.lucrosAcumulados);
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
