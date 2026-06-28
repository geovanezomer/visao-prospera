/**
 * mutuosPassivos.ts — Engine pura para mútuos PF→PJ (sócio empresta para a empresa).
 *
 * Espelho simétrico de mutuosSocios.ts, porém invertido:
 *  - captacao[12]: entradas de caixa (mês da captação)
 *  - amortizacao[12]: saídas de caixa (devolução do principal)
 *  - juros[12]: juros pagos ao sócio (Despesa Financeira, informativo)
 *  - saldoFinal: saldo devedor remanescente (Passivo) ao fim do horizonte
 *
 * Conservador: parcelas após o mês 12 ficam fora do horizonte e somam ao saldoFinal.
 */
import type { MutuoPassivo, Months } from "./types";

const zeros12 = (): Months => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as Months;

/** Parcela Price. Quando i=0, retorna PV/n (amortização linear sem juros). */
function pmtPrice(pv: number, i: number, n: number): number {
  if (n <= 0) return 0;
  if (i <= 0) return pv / n;
  return (pv * i) / (1 - Math.pow(1 + i, -n));
}

export interface MutuosPassivosAgregados {
  captacao: Months;
  amortizacao: Months;
  juros: Months;
  saldoFinal: number;
  totalCaptado: number;
  totalJurosAno: number;
}

export function aggregateMutuosPassivos(
  mutuos: MutuoPassivo[] | undefined,
): MutuosPassivosAgregados {
  const captacao = zeros12();
  const amortizacao = zeros12();
  const juros = zeros12();
  let saldoFinal = 0;
  let totalCaptado = 0;

  for (const m of mutuos ?? []) {
    const pv = Math.max(0, m.valorCaptado);
    if (pv <= 0) continue;
    const i = Math.max(0, m.taxaMensalPct) / 100;
    const n = Math.max(1, Math.floor(m.prazoMeses));
    const inicio = Math.min(12, Math.max(1, Math.floor(m.mesInicioDevolucao)));
    const mesCap = Math.min(12, Math.max(1, Math.floor(m.mesCaptacao)));

    captacao[mesCap - 1] += pv;
    totalCaptado += pv;

    const pmt = pmtPrice(pv, i, n);
    let saldo = pv;
    for (let k = 0; k < n; k++) {
      const mesAbs = inicio + k;
      const jurosMes = saldo * i;
      const amortMes = Math.min(saldo, pmt - jurosMes);
      saldo = Math.max(0, saldo - amortMes);
      if (mesAbs >= 1 && mesAbs <= 12) {
        amortizacao[mesAbs - 1] += amortMes;
        juros[mesAbs - 1] += jurosMes;
      }
    }
    saldoFinal += saldo;
  }

  const totalJurosAno = juros.reduce((a, b) => a + b, 0);
  return { captacao, amortizacao, juros, saldoFinal, totalCaptado, totalJurosAno };
}

/** SELIC mensal aproximada (reaproveitada de mutuosSocios). */
export const SELIC_MENSAL_REFERENCIA_PASSIVO = 0.9;
