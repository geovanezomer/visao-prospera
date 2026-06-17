/**
 * Helpers compartilhados das calculadoras.
 *
 * Centraliza utilidades duplicadas entre os módulos de calculadora
 * (rescisão, custo de funcionário, SAC×PRICE, etc.).
 */

/**
 * Arredonda em centavos para evitar drift de ponto flutuante em
 * cálculos iterativos longos (ex: tabela de amortização de 360 meses).
 */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
