/**
 * Camada de tradução para `@formulajs/formulajs`.
 *
 * Mantemos apenas as funções efetivamente usadas no projeto:
 *  - vplExcel / vplClassico  → valuation.ts e forecast.ts
 *  - tir                     → cross-formulajs.test.ts
 *  - parcela                 → calculadoras/sacPrice.ts
 *
 * Convenção de fluxo de caixa para VPL/TIR:
 *   flows[0] = investimento inicial (negativo)
 *   flows[1..n] = entradas líquidas por período (positivas em geral)
 *
 * Atenção: formulajs.NPV segue a convenção do Excel — desconta TODOS os
 * fluxos inclusive o primeiro (período 1, não 0). Para o uso convencional
 * "VPL clássico" (fluxo[0] no presente), use `vplClassico`.
 */

import { NPV, IRR, PMT } from "@formulajs/formulajs";

/** VPL estilo Excel: desconta todos os fluxos a partir do período 1. */
export const vplExcel = NPV;

/**
 * VPL clássico: fluxos[0] está no presente (período 0, não descontado).
 * É o uso mais comum em valuation/CAPEX.
 */
export function vplClassico(taxa: number, fluxos: number[]): number {
  if (!fluxos.length) return 0;
  const [inicial, ...resto] = fluxos;
  const desc = NPV(taxa, ...resto);
  if (desc instanceof Error) throw desc;
  return inicial + desc;
}

/** TIR — fluxos com período 0 = investimento inicial (negativo). */
export const tir = IRR;

/** Parcela (PMT) — usada nas calculadoras de financiamento (SAC/Price). */
export const parcela = PMT;
