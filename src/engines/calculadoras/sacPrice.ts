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

// Arredonda em centavos para evitar drift de ponto flutuante em prazos longos.
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const parcelaFixa = round2(
    i === 0 ? pv / n : (pv * (i * Math.pow(1 + i, n))) / (Math.pow(1 + i, n) - 1),
  );
  let saldo = pv;
  const parcelas: LinhaAmortizacao[] = [];
  let totalPago = 0;
  let totalJuros = 0;
  for (let m = 1; m <= n; m++) {
    const juros = round2(saldo * i);
    const amort = round2(parcelaFixa - juros);
    saldo = Math.max(0, saldo - amort);
    totalPago = round2(totalPago + parcelaFixa);
    totalJuros = round2(totalJuros + juros);
    parcelas.push({
      mes: m,
      parcela: parcelaFixa,
      amortizacao: amort,
      juros,
      saldoDevedor: round2(saldo),
    });
  }
  return {
    parcelas,
    primeiraParcela: parcelaFixa,
    ultimaParcela: parcelaFixa,
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
