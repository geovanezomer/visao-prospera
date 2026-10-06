/**
 * Simulador de financiamento — SAC vs PRICE.
 *
 * SAC (Sistema de Amortização Constante):
 *   amortização = PV / n; juros_t = saldo_{t-1} × i; parcela_t = amort + juros_t.
 *
 * PRICE (Tabela Price / Sistema Francês):
 *   parcela = PV × [i × (1+i)^n] / [(1+i)^n − 1]
 *   juros_t = saldo_{t-1} × i; amortização_t = parcela − juros_t.
 *
 * Conversão taxa anual → mensal: (1 + ia)^(1/12) − 1.
 */

export type LinhaAmortizacao = {
  mes: number;
  parcela: number;
  amortizacao: number;
  juros: number;
  saldoDevedor: number;
};

export type ResultadoSistema = {
  parcelas: LinhaAmortizacao[];
  primeiraParcela: number;
  ultimaParcela: number;
  totalPago: number;
  totalJuros: number;
};

export type ResultadoSimulacao = {
  taxaMensal: number;
  sac: ResultadoSistema;
  price: ResultadoSistema;
  economiaJurosSac: number;
};

/** Converte taxa anual (% a.a.) em mensal equivalente. */
export function taxaAnualParaMensal(taxaAnualPct: number): number {
  return Math.pow(1 + taxaAnualPct / 100, 1 / 12) - 1;
}

import { parcela } from "@/engines/finance/external";
import { round2 } from "./utils";

export function calcularSAC(pv: number, taxaMensal: number, n: number): ResultadoSistema {
  const amort = pv / n;
  let saldo = pv;
  const parcelas: LinhaAmortizacao[] = [];
  let totalPago = 0;
  let totalJuros = 0;
  for (let m = 1; m <= n; m++) {
    const juros = round2(saldo * taxaMensal);
    const parcela = round2(amort + juros);
    saldo = Math.max(0, saldo - amort);
    totalPago = round2(totalPago + parcela);
    totalJuros = round2(totalJuros + juros);
    parcelas.push({
      mes: m,
      parcela,
      amortizacao: round2(amort),
      juros,
      saldoDevedor: round2(saldo),
    });
  }
  return {
    parcelas,
    primeiraParcela: parcelas[0]?.parcela ?? 0,
    ultimaParcela: parcelas[parcelas.length - 1]?.parcela ?? 0,
    totalPago,
    totalJuros,
  };
}

export function calcularPRICE(pv: number, taxaMensal: number, n: number): ResultadoSistema {
  const i = taxaMensal;
  // PMT na convenção do Excel: negativo para PV positivo (saída de caixa);
  // invertemos o sinal para obter a parcela como valor positivo.
  const pmt = parcela(i, n, pv);
  const parcelaFixa = round2(Number.isFinite(pmt) ? -pmt : pv / n);
  let saldo = pv;
  const parcelas: LinhaAmortizacao[] = [];
  let totalPago = 0;
  let totalJuros = 0;
  for (let m = 1; m <= n; m++) {
    const juros = round2(saldo * i);
    // Última parcela: ajusta amortização para liquidar o saldo residual
    // (drift inerente ao arredondamento de centavos do PMT — bancos quitam
    // a dívida ajustando a última prestação).
    const ehUltima = m === n;
    const amort = ehUltima ? round2(saldo) : round2(parcelaFixa - juros);
    const parcelaMes = ehUltima ? round2(amort + juros) : parcelaFixa;
    saldo = Math.max(0, round2(saldo - amort));
    totalPago = round2(totalPago + parcelaMes);
    totalJuros = round2(totalJuros + juros);
    parcelas.push({
      mes: m,
      parcela: parcelaMes,
      amortizacao: amort,
      juros,
      saldoDevedor: round2(saldo),
    });
  }
  return {
    parcelas,
    primeiraParcela: parcelas[0]?.parcela ?? 0,
    ultimaParcela: parcelas[parcelas.length - 1]?.parcela ?? 0,
    totalPago,
    totalJuros,
  };
}

export function simularSacPrice(pv: number, taxaAnualPct: number, n: number): ResultadoSimulacao {
  const taxaMensal = taxaAnualParaMensal(taxaAnualPct);
  const sac = calcularSAC(pv, taxaMensal, n);
  const price = calcularPRICE(pv, taxaMensal, n);
  return { taxaMensal, sac, price, economiaJurosSac: price.totalJuros - sac.totalJuros };
}
