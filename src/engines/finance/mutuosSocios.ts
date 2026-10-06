/**
 * mutuosSocios.ts — Engine pura para Empréstimos PJ→PF (mútuo ativo).
 *
 * Trata cada `MutuoSocio` como contrato Price (parcela fixa) e gera:
 *  - concessao[12]: saídas de caixa (mês da concessão)
 *  - devolucao[12]: entradas de caixa de PRINCIPAL amortizado
 *  - juros[12]:     juros recebidos (Receita Financeira, informativo)
 *  - saldoFinal:    saldo devedor no fim do horizonte de 12 meses
 *
 * Conservador: amortização e juros que cairiam após o mês 12 ficam fora
 * do horizonte e contribuem para o saldoFinal (vão para Balanço como
 * Mútuos a Receber).
 */
import type { MutuoSocio, Months } from "./types";

const zeros12 = (): Months => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as Months;

/** Parcela Price. Quando i=0, retorna PV/n (amortização linear sem juros). */
function pmtPrice(pv: number, i: number, n: number): number {
  if (n <= 0) return 0;
  if (i <= 0) return pv / n;
  return (pv * i) / (1 - Math.pow(1 + i, -n));
}

export interface MutuosAgregados {
  concessao: Months;
  devolucao: Months;
  juros: Months;
  saldoFinal: number; // saldo devedor agregado ao fim do mês 12
  totalConcedido: number; // somatório do principal concedido (todos os contratos)
  totalJurosAno: number; // juros que entram dentro do horizonte (12 meses)
}

export function aggregateMutuos(mutuos: MutuoSocio[] | undefined): MutuosAgregados {
  const concessao = zeros12();
  const devolucao = zeros12();
  const juros = zeros12();
  let saldoFinal = 0;
  let totalConcedido = 0;

  for (const m of mutuos ?? []) {
    const pv = Math.max(0, m.valorConcedido);
    if (pv <= 0) continue;
    const i = Math.max(0, m.taxaMensalPct) / 100;
    const n = Math.max(1, Math.floor(m.prazoMeses));
    const inicio = Math.min(12, Math.max(1, Math.floor(m.mesInicioDevolucao)));
    const mesConc = Math.min(12, Math.max(1, Math.floor(m.mesConcessao)));

    // Saída de caixa pela concessão (mês cadastrado).
    concessao[mesConc - 1] += pv;
    totalConcedido += pv;

    // Simula evolução do saldo devedor (Price) ao longo de até `n` meses,
    // mas só registra dentro do horizonte 1..12. Tudo após mês 12 fica no saldoFinal.
    const pmt = pmtPrice(pv, i, n);
    let saldo = pv;
    // Só até o fim do ano (mês 12): o que vence depois continua no saldo.
    for (let k = 0; k < n && inicio + k <= 12; k++) {
      const mesAbs = inicio + k; // 1..12
      const jurosMes = saldo * i;
      const amortMes = Math.min(saldo, pmt - jurosMes);
      saldo = Math.max(0, saldo - amortMes);
      devolucao[mesAbs - 1] += amortMes;
      juros[mesAbs - 1] += jurosMes;
    }
    // Saldo remanescente (parcelas após mês 12) vai para o saldoFinal.
    saldoFinal += saldo;
  }

  const totalJurosAno = juros.reduce((a, b) => a + b, 0);
  return { concessao, devolucao, juros, saldoFinal, totalConcedido, totalJurosAno };
}

/** SELIC mensal aproximada — usada apenas para alerta de "juros baixos"
 *  no card (Receita Federal pode reclassificar como distribuição disfarçada). */
export const SELIC_MENSAL_REFERENCIA = 0.9; // ~10.75% a.a. ≈ 0.85%/mês — atualizar via taxDefaults futuramente
