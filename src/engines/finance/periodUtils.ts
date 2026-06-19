// ============================================================================
// periodUtils.ts — Detecção de meses preenchidos e anualização correta.
//
// Problema resolvido: dividir totais anuais por 12 quando o consultor só
// preencheu parte do ano (ex: Jan-Mar) distorce indicadores para baixo,
// pois trata 9 meses futuros como 9 meses operando com R$ 0.
//
// SSOT para qualquer cálculo que precise "média mensal" ou "anualização"
// a partir de séries Months[12].
// ============================================================================

type Months = number[];

/**
 * Retorna o número de meses efetivamente operados, identificado pelo
 * ÚLTIMO mês com qualquer valor não-zero em QUALQUER série passada.
 *
 * Conta do fim para o início (e não somando não-zeros) porque:
 *  - empresa sazonal com Jan=100, Fev=0, Mar=0, Abr=80 tem 4 meses
 *    de operação, não 2. Contar não-zeros distorce ao contrário.
 *
 * Aceita múltiplas séries (receita + custos + impostos): assim, se o
 * consultor zerou faturamento de um mês mas tem custo fixo registrado,
 * o mês ainda conta como operado.
 *
 * Fallback: se todas as séries estão zeradas, retorna 12 (não distorce
 * silenciosamente — mantém comportamento atual).
 */
export function mesesPreenchidos(...series: Months[]): number {
  let lastFilled = -1;
  for (const s of series) {
    if (!Array.isArray(s)) continue;
    for (let i = 11; i >= 0; i--) {
      if (s[i] !== 0 && Number.isFinite(s[i])) {
        if (i > lastFilled) lastFilled = i;
        break;
      }
    }
  }
  return lastFilled === -1 ? 12 : lastFilled + 1;
}

/**
 * Anualiza um total acumulado de N meses para escala 12 meses.
 * Ex: total Jan-Mar = 300 → anualizar(300, 3) = 1200.
 */
export function anualizar(valor: number, meses: number): number {
  if (!Number.isFinite(valor) || meses <= 0) return 0;
  return (valor / meses) * 12;
}

/**
 * Média mensal correta: divide total pelo número de meses EFETIVOS,
 * não pelos 12 do calendário. Usar em runway, burn, médias de inadimplência.
 */
export function mediaMensal(valor: number, meses: number): number {
  if (!Number.isFinite(valor) || meses <= 0) return 0;
  return valor / meses;
}
