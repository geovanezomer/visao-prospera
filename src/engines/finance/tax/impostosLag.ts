// =====================================================================
// TAX/IMPOSTOS-LAG — SSOT das regras de lag de recolhimento tributário.
// Compartilhado entre cashflow.ts (série de pagamentos deslocada) e
// balancoFechamento.ts (passivo de fechamento em dezembro).
//
// Motivação: manter UMA fonte para as premissas:
//   • Componentes de VENDAS (PIS/COFINS/ISS/ICMS/DAS): lag ~30 dias.
//   • Componente CBS/IBS: se Split Payment ativo (LC 214/2025) → retido
//     no ato (lag 0); senão, entra no lag padrão de 30 dias.
//   • Componente LUCRO (IRPJ/CSLL): Simples já está no DAS (0); no
//     Presumido/Real é TRIMESTRAL — o Q4 (out+nov+dez) fica provisionado
//     no fechamento (DARF vence ao fim de janeiro).
//
// Toda mudança nessas premissas deve viver AQUI para evitar drift entre
// o cashflow e o balanço patrimonial.
// =====================================================================

import type { TaxRegime } from "../types";
import type { MonthlyTax } from "./shared";

/** Lag padrão de recolhimento (apuração + DARF do mês seguinte). */
export const LAG_DIAS_PADRAO = 30;
/** Lag do Split Payment (CBS/IBS retidos no ato). */
export const LAG_DIAS_SPLIT = 0;

/**
 * Particiona o total mensal de tributos em três séries que consumidores
 * podem deslocar com lags distintos, respeitando o regime:
 *   • `vendasLag30`  → PIS/COFINS/ISS/ICMS/CBS não-split/DAS — lag 30 dias.
 *   • `splitZero`    → CBS/IBS retidos no ato (Split Payment ativo) — lag 0.
 *   • `lucroTri`     → IRPJ/CSLL agrupados por trimestre no ÚLTIMO mês (mar/
 *      jun/set/dez) — o consumidor aplica lag 30 e o DARF cai em abr/jul/out/
 *      jan. No Simples esta série é toda zero (IRPJ/CSLL já estão no DAS).
 *
 * `vendasLag30 + splitZero + lucroTri = tax.monthly` (invariante).
 */
export function partitionMonthlyTaxByLag(
  tax: MonthlyTax,
  splitPaymentAtivo: boolean,
  regime: TaxRegime,
): { vendasLag30: number[]; splitZero: number[]; lucroTri: number[] } {
  const vendas = tax.monthlyVendas ?? [];
  const cbsIbs = tax.monthlyCbsIbs ?? [];
  const lucro = tax.monthlyLucro ?? [];
  const N = Math.max(vendas.length, cbsIbs.length, lucro.length, 12);
  const zeros = () => new Array(N).fill(0);

  // Vendas ex-CBS/IBS (quando split ativo, CBS/IBS sai para lag 0).
  const splitZero = splitPaymentAtivo ? cbsIbs.slice() : zeros();
  const vendasLag30 = splitPaymentAtivo
    ? vendas.map((v, i) => Math.max(0, v - (cbsIbs[i] ?? 0)))
    : vendas.slice();

  // Lucro trimestral: soma Q e coloca no último mês do trimestre.
  // Simples: `monthlyLucro` já é zero (tributo está no DAS), então lucroTri = 0.
  const lucroTri = zeros();
  if (regime !== "simples") {
    // Cobre TODOS os trimestres do horizonte (ceil(N/3)), não só os 4 do 1º ano.
    // Trimestre final incompleto: soma o que existe e lança no último mês disponível.
    const trimestres = Math.ceil(N / 3);
    for (let q = 0; q < trimestres; q++) {
      const m0 = q * 3;
      const fim = Math.min(m0 + 2, N - 1);
      let soma = 0;
      for (let m = m0; m <= fim; m++) soma += lucro[m] ?? 0;
      lucroTri[fim] = soma;
    }
  } else {
    // Fallback seguro: se por algum motivo o Simples tiver monthlyLucro > 0
    // (regressão), trata como mensal (lag 30) para não perder o pagamento.
    for (let i = 0; i < N; i++) lucroTri[i] = lucro[i] ?? 0;
  }
  return { vendasLag30, splitZero, lucroTri };
}

/**
 * Passivo tributário de fechamento (dezembro), coerente com a partição
 * usada pelo cashflow:
 *   • VENDAS ex-CBS/IBS de dez → sempre entra (lag 30, DARF em jan).
 *   • CBS/IBS de dez → entra somente se Split INATIVO (lag 0 = zera passivo).
 *   • LUCRO: Simples = 0; Presumido/Real = out+nov+dez (Q4 provisionado).
 */
export function computeImpostosPagarFechamento(args: {
  tax: MonthlyTax;
  regime: TaxRegime;
  splitAtivo: boolean;
}): number {
  const { tax, regime, splitAtivo } = args;
  const vendas = tax.monthlyVendas ?? [];
  const cbsIbs = tax.monthlyCbsIbs ?? [];
  const lucro = tax.monthlyLucro ?? [];
  const cbsIbsDez = cbsIbs[11] ?? 0;
  let passivoVendas = vendas[11] ?? 0;
  if (splitAtivo) passivoVendas = Math.max(0, passivoVendas - cbsIbsDez);
  const passivoLucro =
    regime === "simples" ? 0 : (lucro[9] ?? 0) + (lucro[10] ?? 0) + (lucro[11] ?? 0);
  return Math.max(0, passivoVendas + passivoLucro);
}
