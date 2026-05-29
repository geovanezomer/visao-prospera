import { AppState, TaxRegime } from "./types";
import { buildDRE, monthValues } from "./calculations";
import { MESES, sum, zeros12 } from "./format";

export interface CashFlow {
  saldoInicial: number[];
  recebimentos: number[];
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
  totais: {
    recebimentos: number;
    pagamentosTotais: number;
    fluxoOperacional: number;
    fluxoInvestimento: number;
    fluxoFinanciamento: number;
    variacao: number;
    saldoFinal: number;
    pioresMes: { mes: string; saldo: number } | null;
  };
}

/**
 * Desloca um array mensal por N dias (convertidos em meses).
 * Valores que cairiam após dezembro são truncados (simplificação de 1º ano).
 */
function shiftByDays(values: number[], lagDays: number): number[] {
  const lag = Math.max(0, Math.round(lagDays / 30));
  if (lag === 0) return values.slice();
  const out = zeros12();
  for (let i = 0; i < 12; i++) {
    const t = i + lag;
    if (t < 12) out[t] += values[i];
  }
  return out;
}

export function buildCashFlow(state: AppState, regime: TaxRegime = state.tax.regime): CashFlow {
  const { dre, tax } = buildDRE(state, regime);
  const { revenue, capital, cashflow } = state;

  // Recebimentos: receita líquida (já abate inadimplência) deslocada pelo PMR
  const recebimentos = shiftByDays(dre.receitaLiquida, revenue.pmr);

  // Pagamentos a fornecedores: Custo de Vendas (CPV) deslocado pelo PMP
  const pagamentosFornecedores = shiftByDays(dre.cpv, revenue.pmp);

  // Demais despesas operacionais: separar fixos (mesmo mês) e variáveis (mesmo mês)
  const pagamentosFixos = dre.custosFixos.slice();
  const pagamentosVariaveis = dre.custosVariaveis.map((tot, i) => tot - dre.cpv[i]); // CPV já contabilizado

  // Financeiros: mesmo mês
  const pagamentosFinanceiros = dre.custosFinanceirosTotal.slice();

  // Impostos: deslocados 1 mês (DAS / IRPJ apurados na competência são pagos no mês seguinte)
  const pagamentosImpostos = shiftByDays(tax.monthly, 30);

  // Itens não-operacionais (do CashFlowConfig)
  const aportes = cashflow.aportes.slice();
  const emprestimosCaptados = cashflow.emprestimosCaptados.slice();
  const amortizacoes = cashflow.amortizacoes.slice();
  const dividendos = cashflow.dividendos.slice();
  const capex = cashflow.capex.slice();

  const fluxoOperacional = zeros12();
  const fluxoInvestimento = zeros12();
  const fluxoFinanciamento = zeros12();
  const variacaoCaixa = zeros12();
  const saldoFinal = zeros12();
  const saldoInicial = zeros12();

  let saldo = capital.disponibilidades;
  for (let i = 0; i < 12; i++) {
    saldoInicial[i] = saldo;
    fluxoOperacional[i] =
      recebimentos[i] -
      pagamentosFornecedores[i] -
      pagamentosFixos[i] -
      pagamentosVariaveis[i] -
      pagamentosFinanceiros[i] -
      pagamentosImpostos[i];
    fluxoInvestimento[i] = -capex[i];
    fluxoFinanciamento[i] = aportes[i] + emprestimosCaptados[i] - amortizacoes[i] - dividendos[i];
    variacaoCaixa[i] = fluxoOperacional[i] + fluxoInvestimento[i] + fluxoFinanciamento[i];
    saldo = saldo + variacaoCaixa[i];
    saldoFinal[i] = saldo;
  }

  const alertas: CashFlow["alertas"] = [];
  for (let i = 0; i < 12; i++) {
    if (saldoFinal[i] < 0) alertas.push({ mes: MESES[i], saldo: saldoFinal[i], tipo: "negativo" });
    else if (saldoFinal[i] < cashflow.caixaMinimo)
      alertas.push({ mes: MESES[i], saldo: saldoFinal[i], tipo: "abaixoMinimo" });
  }

  let pior: { mes: string; saldo: number } | null = null;
  for (let i = 0; i < 12; i++) {
    if (!pior || saldoFinal[i] < pior.saldo) pior = { mes: MESES[i], saldo: saldoFinal[i] };
  }

  return {
    saldoInicial,
    recebimentos,
    pagamentosFornecedores,
    pagamentosFixos,
    pagamentosVariaveis,
    pagamentosFinanceiros,
    pagamentosImpostos,
    fluxoOperacional,
    aportes,
    emprestimosCaptados,
    amortizacoes,
    dividendos,
    fluxoFinanciamento,
    capex,
    fluxoInvestimento,
    variacaoCaixa,
    saldoFinal,
    alertas,
    totais: {
      recebimentos: sum(recebimentos),
      pagamentosTotais:
        sum(pagamentosFornecedores) +
        sum(pagamentosFixos) +
        sum(pagamentosVariaveis) +
        sum(pagamentosFinanceiros) +
        sum(pagamentosImpostos),
      fluxoOperacional: sum(fluxoOperacional),
      fluxoInvestimento: sum(fluxoInvestimento),
      fluxoFinanciamento: sum(fluxoFinanciamento),
      variacao: sum(variacaoCaixa),
      saldoFinal: saldoFinal[11],
      pioresMes: pior,
    },
  };
}
