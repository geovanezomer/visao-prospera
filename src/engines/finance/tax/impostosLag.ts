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
 * Particiona o total mensal de tributos (`tax.monthly`) em duas séries que
 * consumidores podem deslocar com lags distintos:
 *   • `restante`  → recolhido com `LAG_DIAS_PADRAO` (mês seguinte).
 *   • `splitZero` → recolhido com `LAG_DIAS_SPLIT` (mesmo mês).
 * Sem Split ativo, `splitZero` é zero e `restante = tax.monthly`.
 */
export function partitionMonthlyTaxByLag(
  tax: MonthlyTax,
  splitPaymentAtivo: boolean,
): { restante: number[]; splitZero: number[] } {
  const total = tax.monthly ?? [];
  if (!splitPaymentAtivo) {
    return { restante: total.slice(), splitZero: new Array(total.length).fill(0) };
  }
  const cbsIbs = tax.monthlyCbsIbs ?? new Array(total.length).fill(0);
  const restante = total.map((m, i) => Math.max(0, m - (cbsIbs[i] ?? 0)));
  return { restante, splitZero: cbsIbs.slice() };
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
    regime === "simples"
      ? 0
      : (lucro[9] ?? 0) + (lucro[10] ?? 0) + (lucro[11] ?? 0);
  return Math.max(0, passivoVendas + passivoLucro);
}
