import { AppState, TaxRegime } from "./types";
import { buildDRE, type DRE } from "./dre";
import { resolveEffectiveRegime } from "./regime";
import { splitReceitasFinanceiras, computeCapexMensal } from "./shared";
import type { MonthlyTax } from "./tax/shared";
import { MESES, sum, zeros12 } from "./format";

export interface CashFlow {
  saldoInicial: number[];
  recebimentos: number[];
  /** Rendimentos de aplicações financeiras realizados em caixa (operacional). */
  receitasFinanceiras: number[];
  pagamentosFornecedores: number[];
  pagamentosFixos: number[];
  pagamentosVariaveis: number[];
  pagamentosFinanceiros: number[];
  pagamentosImpostos: number[];
  fluxoOperacional: number[];
  aportes: number[];
  emprestimosCaptados: number[];
  amortizacoes: number[];
  dividendos: number[];
  fluxoFinanciamento: number[];
  capex: number[];
  fluxoInvestimento: number[];
  variacaoCaixa: number[];
  saldoFinal: number[];
  alertas: { mes: string; saldo: number; tipo: "negativo" | "abaixoMinimo" }[];
  contasReceberAnoSeguinte: number;
  fornecedoresAnoSeguinte: number;
  impostosAnoSeguinte: number;
  totais: {
    recebimentos: number;
    receitasFinanceiras: number;
    pagamentosTotais: number;
    fluxoOperacional: number;
    fluxoInvestimento: number;
    fluxoFinanciamento: number;
    variacao: number;
    saldoFinal: number;
    pioresMes: { mes: string; saldo: number } | null;
  };
}

// =====================================================================
// Funções puras — cada uma testável isoladamente, sem efeito colateral.
// =====================================================================

/**
 * Desloca um array mensal por N dias (arredondando para meses inteiros).
 * O que cairia em jan/ano+1 ou depois acumula em `transbordo`.
 *
 * Exemplo: lag=30, valores=[100,...12x]
 *   → inAno=[0, 100, 100, ..., 100] (11 meses)
 *   → transbordo = 100 (mês 12 cai em jan/ano+1)
 */
export function shiftByDaysSplit(
  values: number[],
  lagDays: number,
): { inAno: number[]; transbordo: number } {
  const lag = Math.max(0, Math.round(lagDays / 30));
  if (lag === 0) return { inAno: values.slice(), transbordo: 0 };
  const out = zeros12();
  let transbordo = 0;
  for (let i = 0; i < 12; i++) {
    const t = i + lag;
    if (t < 12) out[t] += values[i];
    else transbordo += values[i];
  }
  return { inAno: out, transbordo };
}

/**
 * Variante por mês: cada mês `i` tem seu próprio lag (em dias).
 * Útil quando o PMR/PMP varia ao longo do ano (sazonalidade, mix de clientes etc.).
 */
export function shiftByDaysSplitMonthly(
  values: number[],
  lagDaysByMonth: number[],
): { inAno: number[]; transbordo: number } {
  const out = zeros12();
  let transbordo = 0;
  for (let i = 0; i < 12; i++) {
    const lag = Math.max(0, Math.round((lagDaysByMonth[i] || 0) / 30));
    const t = i + lag;
    if (t < 12) out[t] += values[i];
    else transbordo += values[i];
  }
  return { inAno: out, transbordo };
}

/**
 * True quando o array tem variação real entre meses (sazonalidade).
 * Se for constante (todos iguais), preferimos o escalar `pmr`/`pmp`
 * — assim overrides do simulador / sensibilidade no escalar continuam efetivos.
 */
function hasMonthlyVariation(arr: number[] | undefined): boolean {
  if (!Array.isArray(arr) || arr.length !== 12) return false;
  const first = arr[0];
  return arr.some((v) => v !== first);
}

/**
 * Recebimentos = (Receita Bruta − Inadimplência) deslocados pelo PMR.
 * Usa `pmrMensal` quando há sazonalidade real; caso contrário, escalar `pmr`.
 */
export function computeRecebimentos(
  state: AppState,
  dre: DRE,
): { inAno: number[]; transbordo: number } {
  const recebivelMensal = dre.receitaBruta.map((r, i) => r - (dre.deducoesInadimplencia[i] ?? 0));
  if (hasMonthlyVariation(state.revenue.pmrMensal)) {
    return shiftByDaysSplitMonthly(recebivelMensal, state.revenue.pmrMensal!);
  }
  return shiftByDaysSplit(recebivelMensal, state.revenue.pmr);
}

/**
 * Pagamentos a fornecedores = CPV/CMV/CSP deslocados pelo PMP (mensal quando há sazonalidade).
 */
export function computeFornecedores(
  state: AppState,
  dre: DRE,
): { inAno: number[]; transbordo: number } {
  if (hasMonthlyVariation(state.revenue.pmpMensal)) {
    return shiftByDaysSplitMonthly(dre.cpv, state.revenue.pmpMensal!);
  }
  return shiftByDaysSplit(dre.cpv, state.revenue.pmp);
}

/**
 * Pagamentos de impostos = total mensal de tributos deslocado 30 dias (apuração + DARF).
 */
export function computeImpostos(tax: MonthlyTax): { inAno: number[]; transbordo: number } {
  return shiftByDaysSplit(tax.monthly, 30);
}

/**
 * Pagamentos operacionais não-fornecedor: fixos, variáveis (excluindo CPV), financeiros.
 * PDD é removida dos fixos pois é não-caixa (CPC 47/IFRS 9) — a perda já está nos recebimentos.
 */
export function computePagamentosOperacionais(dre: DRE): {
  fixos: number[];
  variaveis: number[];
  financeiros: number[];
} {
  return {
    fixos: dre.custosFixos.slice(),
    // PDD agora é classificada em custosVariaveis (escala com receita). Continua removida do
    // desembolso operacional pois é não-caixa (CPC 47/IFRS 9 — a perda já está nos recebimentos).
    variaveis: dre.custosVariaveis.map((tot, i) => tot - dre.cpv[i] - (dre.pdd?.[i] ?? 0)),
    financeiros: dre.custosFinanceirosTotal.slice(),
  };
}

/**
 * Compõe os três fluxos mensais a partir de seus componentes.
 */
export function computeFluxos(args: {
  recebimentos: number[];
  receitasFinanceiras: number[];
  fornecedores: number[];
  fixos: number[];
  variaveis: number[];
  financeiros: number[];
  impostos: number[];
  capex: number[];
  aportes: number[];
  emprestimosCaptados: number[];
  amortizacoes: number[];
  dividendos: number[];
}): {
  fluxoOperacional: number[];
  fluxoInvestimento: number[];
  fluxoFinanciamento: number[];
  variacaoCaixa: number[];
} {
  const fluxoOperacional = zeros12();
  const fluxoInvestimento = zeros12();
  const fluxoFinanciamento = zeros12();
  const variacaoCaixa = zeros12();
  for (let i = 0; i < 12; i++) {
    fluxoOperacional[i] =
      args.recebimentos[i] +
      args.receitasFinanceiras[i] -
      args.fornecedores[i] -
      args.fixos[i] -
      args.variaveis[i] -
      args.financeiros[i] -
      args.impostos[i];
    fluxoInvestimento[i] = -args.capex[i];
    fluxoFinanciamento[i] =
      args.aportes[i] + args.emprestimosCaptados[i] - args.amortizacoes[i] - args.dividendos[i];
    variacaoCaixa[i] = fluxoOperacional[i] + fluxoInvestimento[i] + fluxoFinanciamento[i];
  }
  return { fluxoOperacional, fluxoInvestimento, fluxoFinanciamento, variacaoCaixa };
}

/**
 * Acumula saldo mês a mês: saldoInicial[i+1] = saldoFinal[i].
 */
export function computeSaldos(
  saldoInicial0: number,
  variacaoCaixa: number[],
): {
  saldoInicial: number[];
  saldoFinal: number[];
} {
  const saldoInicial = zeros12();
  const saldoFinal = zeros12();
  let saldo = saldoInicial0;
  for (let i = 0; i < 12; i++) {
    saldoInicial[i] = saldo;
    saldo += variacaoCaixa[i];
    saldoFinal[i] = saldo;
  }
  return { saldoInicial, saldoFinal };
}

/**
 * Lista meses com saldo final < 0 (negativo) ou < caixa mínimo (abaixoMinimo).
 */
export function computeAlertas(saldoFinal: number[], caixaMinimo: number): CashFlow["alertas"] {
  const out: CashFlow["alertas"] = [];
  for (let i = 0; i < 12; i++) {
    if (saldoFinal[i] < 0) out.push({ mes: MESES[i], saldo: saldoFinal[i], tipo: "negativo" });
    else if (saldoFinal[i] < caixaMinimo)
      out.push({ mes: MESES[i], saldo: saldoFinal[i], tipo: "abaixoMinimo" });
  }
  return out;
}

/**
 * Encontra o mês com menor saldo final do ano. Retorna null se vetor vazio.
 */
export function computePiorMes(saldoFinal: number[]): { mes: string; saldo: number } | null {
  let pior: { mes: string; saldo: number } | null = null;
  for (let i = 0; i < 12; i++) {
    if (!pior || saldoFinal[i] < pior.saldo) pior = { mes: MESES[i], saldo: saldoFinal[i] };
  }
  return pior;
}

/**
 * Burn rate (consumo médio mensal de caixa pela operação) e runway estimado.
 * - burnMedio12: média do ano inteiro
 * - burnMedio3: média dos últimos 3 meses (mais sensível ao momento atual)
 * - runwayMeses: (caixa atual + recebíveis) ÷ burnMedio3, Infinity se operação gera caixa
 */
export function computeBurnRunway(args: {
  fluxoOperacional: number[];
  caixaAtual: number;
  recebiveis: number;
}): { burnMedio12: number; burnMedio3: number; runwayMeses: number; queimando: boolean } {
  const burnMensal = args.fluxoOperacional.map((v) => -v); // positivo = queima
  const burnMedio12 = burnMensal.reduce((a, b) => a + b, 0) / 12;
  const burnMedio3 = burnMensal.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const colchao = args.caixaAtual + args.recebiveis;
  const queimando = burnMedio3 > 0;
  const runwayMeses = queimando ? colchao / burnMedio3 : Infinity;
  return { burnMedio12, burnMedio3, runwayMeses, queimando };
}

// =====================================================================
// Orquestrador — mesma assinatura e retorno do legado.
// =====================================================================
export function buildCashFlow(
  state: AppState,
  regime: TaxRegime = resolveEffectiveRegime(state),
): CashFlow {
  const { dre, tax } = buildDRE(state, regime);
  const { capital, cashflow } = state;

  const rec = computeRecebimentos(state, dre);
  const fornec = computeFornecedores(state, dre);
  const imp = computeImpostos(tax);
  const op = computePagamentosOperacionais(dre);
  // B2: rendimentos de aplicações financeiras realizam-se em caixa no mês de competência
  const { financeiras: receitasFinanceiras } = splitReceitasFinanceiras(state);

  const aportes = cashflow.aportes.slice();
  const emprestimosCaptados = cashflow.emprestimosCaptados.slice();
  const amortizacoes = cashflow.amortizacoes.slice();
  const dividendos = cashflow.dividendos.slice();
  // SSOT: CAPEX = manual (cashflow.capex) + ativações de imobilizado (capital.capexAtivacao).
  const capex = computeCapexMensal(state);

  const fluxos = computeFluxos({
    recebimentos: rec.inAno,
    receitasFinanceiras,
    fornecedores: fornec.inAno,
    fixos: op.fixos,
    variaveis: op.variaveis,
    financeiros: op.financeiros,
    impostos: imp.inAno,
    capex,
    aportes,
    emprestimosCaptados,
    amortizacoes,
    dividendos,
  });

  const { saldoInicial, saldoFinal } = computeSaldos(
    capital.disponibilidades,
    fluxos.variacaoCaixa,
  );
  const alertas = computeAlertas(saldoFinal, cashflow.caixaMinimo);
  const pior = computePiorMes(saldoFinal);

  return {
    saldoInicial,
    recebimentos: rec.inAno,
    receitasFinanceiras,
    pagamentosFornecedores: fornec.inAno,
    pagamentosFixos: op.fixos,
    pagamentosVariaveis: op.variaveis,
    pagamentosFinanceiros: op.financeiros,
    pagamentosImpostos: imp.inAno,
    fluxoOperacional: fluxos.fluxoOperacional,
    aportes,
    emprestimosCaptados,
    amortizacoes,
    dividendos,
    fluxoFinanciamento: fluxos.fluxoFinanciamento,
    capex,
    fluxoInvestimento: fluxos.fluxoInvestimento,
    variacaoCaixa: fluxos.variacaoCaixa,
    saldoFinal,
    alertas,
    contasReceberAnoSeguinte: rec.transbordo,
    fornecedoresAnoSeguinte: fornec.transbordo,
    impostosAnoSeguinte: imp.transbordo,
    totais: {
      recebimentos: sum(rec.inAno),
      receitasFinanceiras: sum(receitasFinanceiras),
      pagamentosTotais:
        sum(fornec.inAno) +
        sum(op.fixos) +
        sum(op.variaveis) +
        sum(op.financeiros) +
        sum(imp.inAno),
      fluxoOperacional: sum(fluxos.fluxoOperacional),
      fluxoInvestimento: sum(fluxos.fluxoInvestimento),
      fluxoFinanciamento: sum(fluxos.fluxoFinanciamento),
      variacao: sum(fluxos.variacaoCaixa),
      saldoFinal: saldoFinal[11],
      pioresMes: pior,
    },
  };
}
