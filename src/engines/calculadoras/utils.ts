/**
 * Helpers compartilhados das calculadoras.
 *
 * Centraliza utilidades duplicadas entre os módulos de calculadora
 * (rescisão, custo de funcionário, SAC×PRICE, etc.).
 */

import { Decimal } from "tributos-br/precision";

/**
 * Arredonda em centavos para evitar drift de ponto flutuante em
 * cálculos iterativos longos (ex: tabela de amortização de 360 meses).
 *
 * Usa `Decimal` (aritmética decimal arbitrária da `tributos-br`) com
 * arredondamento monetário HALF_UP (padrão SEFAZ), eliminando o erro
 * residual de IEEE 754 que se acumulava no `Math.round(n * 100) / 100`.
 */
export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return n; // preserva NaN/Infinity sem explodir
  return Decimal.from(n.toString()).toMoney().toNumber();
};
