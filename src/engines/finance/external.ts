/**
 * Funções financeiras na convenção do Excel (NPV e PMT).
 *
 * Implementação local, conferida contra `@formulajs/formulajs` nos testes
 * (cross-formulajs.test.ts): a biblioteca carregava ~160 KB (jStat) no
 * navegador para duas fórmulas de uma linha.
 *  - vplExcel / vplClassico  → valuation.ts e forecast.ts
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

/** VPL estilo Excel (NPV): desconta todos os fluxos a partir do período 1. */
export function vplExcel(taxa: number, ...fluxos: number[]): number {
  let v = 0;
  for (let i = 0; i < fluxos.length; i++) v += fluxos[i] / Math.pow(1 + taxa, i + 1);
  return v;
}

/**
 * VPL clássico: fluxos[0] está no presente (período 0, não descontado).
 * É o uso mais comum em valuation/CAPEX.
 */
export function vplClassico(taxa: number, fluxos: number[]): number {
  if (!fluxos.length) return 0;
  const [inicial, ...resto] = fluxos;
  return inicial + vplExcel(taxa, ...resto);
}

/**
 * Parcela (PMT do Excel) — calculadoras de financiamento (SAC/Price).
 * `tipo` 0 = pagamento no fim do período; 1 = no início. Sinal do Excel:
 * valor presente positivo gera parcela negativa (saída).
 */
export function parcela(taxa: number, nper: number, vp: number, vf = 0, tipo: 0 | 1 = 0): number {
  if (taxa === 0) return -(vp + vf) / nper;
  const f = Math.pow(1 + taxa, nper);
  return -(taxa * (vf + vp * f)) / ((1 + taxa * tipo) * (f - 1));
}
