// Cálculo de cronograma de contratos de dívida (Price e SAC) + SSOT da
// DÍVIDA ONEROSA. Contratos cadastrados aqui são a ÚNICA fonte de dívida
// do sistema — o campo agregado `capital.dividaOnerosa` foi removido.
//
// Alimenta:
// - state.cashflow.amortizacoes (saída de caixa de principal)
// - custo financeiro (juros) via linha sintética "financeiro"
// - Empréstimos CP/LP na abertura (aberturaDerivada.splitDebtByMaturity)
// - Dívida onerosa total (totalDividaOnerosa) p/ WACC/ROIC/covenants
// - Kd anual ponderado por saldo (avgKdAnual) p/ WACC/valuation
import type { AppState, DebtContract } from "./types";


export const DEBT_CONTRACTS_COST_ID = "__debt_contracts_juros";

export interface ContractSchedule {
  juros: number[]; // 12 meses
  amort: number[]; // 12 meses
  parcelaMes: number; // valor representativo da parcela
  totalJurosAno: number;
  totalAmortAno: number;
}

/** Gera cronograma 12 meses do contrato.
 *  Auditoria F-02: usa taxa mensal EQUIVALENTE (juros compostos) — `taxaAA` é
 *  efetiva anual; `i_m = (1+i_a)^(1/12) − 1`. Antes usava nominal/linear
 *  (`i_a/12`), o que subestimava juros em ~5–10% para taxas altas. */
export function scheduleContract(c: DebtContract): ContractSchedule {
  const juros: number[] = new Array(12).fill(0);
  const amort: number[] = new Array(12).fill(0);
  const saldoIni = Math.max(0, c.saldoDevedor || 0);
  const n = Math.max(1, Math.floor(c.prazoMeses || 0));
  const ia = Math.max(0, (c.taxaAA || 0) / 100);
  const im = ia > 0 ? Math.pow(1 + ia, 1 / 12) - 1 : 0;
  if (saldoIni <= 0 || n <= 0) {
    return { juros, amort, parcelaMes: 0, totalJurosAno: 0, totalAmortAno: 0 };
  }

  let saldo = saldoIni;
  const parcelaPrice =
    im > 0 ? (saldo * im) / (1 - Math.pow(1 + im, -n)) : saldo / n;
  const amortSAC = saldo / n;
  const meses = Math.min(12, n);
  for (let m = 0; m < meses; m++) {
    const j = saldo * im;
    let a = c.sistema === "price" ? parcelaPrice - j : amortSAC;
    if (a > saldo) a = saldo;
    if (a < 0) a = 0;
    juros[m] = j;
    amort[m] = a;
    saldo -= a;
  }

  const parcelaMes =
    c.sistema === "price" ? parcelaPrice : amortSAC + saldoIni * im;
  const totalJurosAno = juros.reduce((s, v) => s + v, 0);
  const totalAmortAno = amort.reduce((s, v) => s + v, 0);
  return { juros, amort, parcelaMes, totalJurosAno, totalAmortAno };
}

/** Agrega os cronogramas de todos os contratos. */
export function aggregateContracts(contracts: DebtContract[]) {
  const juros = new Array(12).fill(0);
  const amort = new Array(12).fill(0);
  const captacao = new Array(12).fill(0);
  let saldoTotal = 0;
  let parcelaMesTotal = 0;
  for (const c of contracts) {
    const s = scheduleContract(c);
    for (let i = 0; i < 12; i++) {
      juros[i] += s.juros[i];
      amort[i] += s.amort[i];
    }
    saldoTotal += Math.max(0, c.saldoDevedor || 0);
    parcelaMesTotal += s.parcelaMes;
    // Captação: novo desembolso no mês informado (1..12).
    const m = Math.floor(c.mesCaptacao || 0);
    const v = Math.max(0, c.valorCaptado || 0);
    if (m >= 1 && m <= 12 && v > 0) captacao[m - 1] += v;
  }
  return {
    juros,
    amort,
    captacao,
    saldoTotal,
    parcelaMesTotal,
    totalJurosAno: juros.reduce((s, v) => s + v, 0),
    totalAmortAno: amort.reduce((s, v) => s + v, 0),
    totalCaptacaoAno: captacao.reduce((s, v) => s + v, 0),
  };
}


/** Converte prazo em meses (a partir de hoje) para rótulo "Mmm/AAAA". */
export function vencimentoLabel(prazoMeses: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + Math.max(0, prazoMeses), 1);
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[d.getMonth()]}/${d.getFullYear()}`;
}
