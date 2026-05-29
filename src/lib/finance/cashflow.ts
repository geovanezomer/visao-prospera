import { AppState, TaxRegime } from "./types";
import { buildDRE } from "./calculations";
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
  // ----- Fase 3: buffers para o ano+1 -----
  contasReceberAnoSeguinte: number;
  fornecedoresAnoSeguinte: number;
  impostosAnoSeguinte: number;
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
 * Desloca array mensal por N dias. Retorna {dentroDoAno, transbordoAno+1}.
 * Não trunca mais — o que cairia em jan/ano+1 vira saldo a receber/pagar.
 */
function shiftByDaysSplit(values: number[], lagDays: number): { inAno: number[]; transbordo: number } {
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

export function buildCashFlow(state: AppState, regime: TaxRegime = state.tax.regime): CashFlow {
  const { dre, tax } = buildDRE(state, regime);
  const { revenue, capital, cashflow } = state;

  const rec = shiftByDaysSplit(dre.receitaLiquida, revenue.pmr);
  const recebimentos = rec.inAno;
  const fornec = shiftByDaysSplit(dre.cpv, revenue.pmp);
  const pagamentosFornecedores = fornec.inAno;

  const pagamentosFixos = dre.custosFixos.slice();
  const pagamentosVariaveis = dre.custosVariaveis.map((tot, i) => tot - dre.cpv[i]);

  const pagamentosFinanceiros = dre.custosFinanceirosTotal.slice();

  const imp = shiftByDaysSplit(tax.monthly, 30);
  const pagamentosImpostos = imp.inAno;

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
      recebimentos[i] - pagamentosFornecedores[i] - pagamentosFixos[i] -
      pagamentosVariaveis[i] - pagamentosFinanceiros[i] - pagamentosImpostos[i];
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
    saldoInicial, recebimentos, pagamentosFornecedores, pagamentosFixos,
    pagamentosVariaveis, pagamentosFinanceiros, pagamentosImpostos, fluxoOperacional,
    aportes, emprestimosCaptados, amortizacoes, dividendos, fluxoFinanciamento,
    capex, fluxoInvestimento, variacaoCaixa, saldoFinal, alertas,
    contasReceberAnoSeguinte: rec.transbordo,
    fornecedoresAnoSeguinte: fornec.transbordo,
    impostosAnoSeguinte: imp.transbordo,
    totais: {
      recebimentos: sum(recebimentos),
      pagamentosTotais: sum(pagamentosFornecedores) + sum(pagamentosFixos) + sum(pagamentosVariaveis) + sum(pagamentosFinanceiros) + sum(pagamentosImpostos),
      fluxoOperacional: sum(fluxoOperacional),
      fluxoInvestimento: sum(fluxoInvestimento),
      fluxoFinanciamento: sum(fluxoFinanciamento),
      variacao: sum(variacaoCaixa),
      saldoFinal: saldoFinal[11],
      pioresMes: pior,
    },
  };
}
