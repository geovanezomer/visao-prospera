/**
 * Camada de tradução para bibliotecas externas de matemática financeira.
 *
 * Centralizamos aqui as funções importadas de `@formulajs/formulajs` e
 * `simple-statistics` reexportadas com nomes em PT-BR. Vantagens:
 *  - Tree-shaking: só sobe no bundle o que é realmente reexportado.
 *  - Trocar de lib no futuro = mexer só neste arquivo.
 *  - Comentários e convenções (sinal do investimento inicial, períodos)
 *    ficam num único lugar.
 *
 * Convenção de fluxo de caixa para VPL/TIR:
 *   flows[0] = investimento inicial (negativo)
 *   flows[1..n] = entradas líquidas por período (positivas em geral)
 *
 * Atenção: formulajs.NPV segue a convenção do Excel — desconta TODOS os
 * fluxos inclusive o primeiro (período 1, não 0). Para o uso convencional
 * "VPL clássico" (fluxo[0] no presente), use `vplClassico`.
 */

import {
  NPV,
  IRR,
  MIRR,
  XNPV,
  XIRR,
  PMT,
  PV,
  FV,
  NPER,
  RATE,
  IPMT,
  PPMT,
  CUMIPMT,
  CUMPRINC,
  SLN,
  DB,
  DDB,
  SYD,
  VDB,
} from "@formulajs/formulajs";

import {
  mean,
  median,
  standardDeviation,
  variance,
  quantile,
  sampleCorrelation,
  linearRegression,
  linearRegressionLine,
  min as ssMin,
  max as ssMax,
  sum as ssSum,
} from "simple-statistics";

// ─────────────────────────────────────────────────────────────────────
// Funções financeiras (estilo Excel)
// ─────────────────────────────────────────────────────────────────────

/** VPL estilo Excel: desconta todos os fluxos a partir do período 1. */
export const vplExcel = NPV;

/**
 * VPL clássico: fluxos[0] está no presente (período 0, não descontado).
 * É o uso mais comum em valuation/CAPEX.
 */
export function vplClassico(taxa: number, fluxos: number[]): number {
  if (!fluxos.length) return 0;
  const [inicial, ...resto] = fluxos;
  return inicial + NPV(taxa, ...resto);
}

/** TIR — fluxos com período 0 = investimento inicial (negativo). */
export const tir = IRR;

/** TIR Modificada: separa taxa de financiamento e taxa de reinvestimento. */
export const tirModificada = MIRR;

/** VPL com datas irregulares (fluxos + datas em paralelo). */
export const vplDatasIrregulares = XNPV;

/** TIR com datas irregulares. */
export const tirDatasIrregulares = XIRR;

// Amortização / financiamento
export const parcela = PMT;
export const valorPresente = PV;
export const valorFuturo = FV;
export const numeroPeriodos = NPER;
export const taxaJuros = RATE;
export const jurosParcela = IPMT;
export const amortizacaoParcela = PPMT;
export const jurosAcumulados = CUMIPMT;
export const amortizacaoAcumulada = CUMPRINC;

// Depreciação
export const depreciacaoLinear = SLN;          // Straight-line
export const depreciacaoSaldoFixo = DB;         // Fixed-declining balance
export const depreciacaoSaldoDuplo = DDB;       // Double-declining balance
export const depreciacaoSomaDigitos = SYD;      // Sum-of-years' digits
export const depreciacaoVariavel = VDB;         // Variable declining balance

// ─────────────────────────────────────────────────────────────────────
// Estatística (Monte Carlo, sensitivity, análise de cenários)
// ─────────────────────────────────────────────────────────────────────

export const media = mean;
export const mediana = median;
export const desvioPadrao = standardDeviation;
export const variancia = variance;
/** Quantil: 0.05 = P5, 0.5 = mediana, 0.95 = P95 */
export const quantil = quantile;
export const correlacao = sampleCorrelation;
export const regressaoLinear = linearRegression;
export const linhaRegressao = linearRegressionLine;
export const minimo = ssMin;
export const maximo = ssMax;
export const somatorio = ssSum;
