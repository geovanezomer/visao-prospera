/**
 * Engine de cálculo do 13º Salário (Gratificação Natalina).
 *
 * Bases legais:
 *  - Lei 4.090/1962 e Lei 4.749/1965: instituição e regulamentação.
 *  - CF art. 7º, VIII: direito ao 13º.
 *  - IN RFB 1.500/2014 art. 14: tributação em separado do salário mensal.
 *  - Tabelas INSS/IRRF versionadas em ./tabelas.ts (SSOT anual).
 *
 * Regras consolidadas:
 *  - 13º proporcional = (salário bruto ÷ 12) × meses trabalhados.
 *    Mês com mais de 15 dias conta como mês inteiro (CLT art. 1º Lei 4.090).
 *  - 1ª parcela: 50% do 13º bruto, paga até 30/nov, SEM INSS e SEM IRRF.
 *  - 2ª parcela: paga até 20/dez = (50% do bruto) − INSS − IRRF.
 *    INSS incide sobre o TOTAL do 13º (não sobre a metade) — tabela progressiva.
 *    IRRF é calculado em SEPARADO do salário mensal, com tabela própria do 13º,
 *    permitindo dedução por dependentes (R$ 189,59 cada).
 *
 * Engine pura — sem dependência de UI.
 */
import { z } from "zod";
import { calcularINSS, calcularIRRF } from "./rescisao";
import { round2 } from "./utils";

// ============================================================================
// Schema de entrada
// ============================================================================

export const decimoTerceiroInputSchema = z.object({
  salarioBruto: z.number().min(0),
  /** Meses trabalhados no ano (1–12). Mês com >15 dias = inteiro. */
  mesesTrabalhados: z.number().int().min(0).max(12).default(12),
  dependentesIR: z.number().int().min(0).default(0),
});

export type DecimoTerceiroInput = z.infer<typeof decimoTerceiroInputSchema>;

// ============================================================================
// Saída
// ============================================================================

export interface DecimoTerceiroOutput {
  /** 13º bruto proporcional aos meses trabalhados. */
  bruto: number;
  /** 1ª parcela = 50% do bruto, sem descontos. */
  primeiraParcela: number;
  /** 2ª parcela líquida = (50% do bruto) − INSS − IRRF. */
  segundaParcela: number;
  /** INSS calculado sobre o total do 13º. */
  inss: number;
  /** Alíquota efetiva do INSS sobre o bruto. */
  inssAliquota: number;
  /** IRRF calculado em separado (tabela do 13º). */
  irrf: number;
  /** Alíquota efetiva do IRRF sobre a base (bruto − INSS). */
  irrfAliquota: number;
  /** Base de cálculo do IRRF = bruto − INSS − (dep × 189,59). */
  baseIRRF: number;
  /** Líquido total = 1ª parcela + 2ª parcela. */
  liquido: number;
}

// ============================================================================
// Cálculo principal
// ============================================================================

export function calcularDecimoTerceiro(inputBruto: DecimoTerceiroInput): DecimoTerceiroOutput {
  const i = decimoTerceiroInputSchema.parse(inputBruto);

  // Proporcional aos meses trabalhados (1/12 por mês completo).
  const bruto = round2((i.salarioBruto / 12) * i.mesesTrabalhados);

  // 1ª parcela: 50%, sem descontos (paga até 30/nov).
  const primeiraParcela = round2(bruto / 2);

  // INSS e IRRF incidem sobre o TOTAL do 13º, descontados integralmente na 2ª parcela.
  const inss = calcularINSS(bruto);
  const irrf = calcularIRRF(bruto, inss, i.dependentesIR);
  const baseIRRF = Math.max(0, bruto - inss - i.dependentesIR * 189.59);

  // 2ª parcela líquida = (50% do bruto) − INSS − IRRF.
  const segundaParcela = round2(bruto / 2 - inss - irrf);

  const liquido = round2(primeiraParcela + segundaParcela);

  return {
    bruto,
    primeiraParcela,
    segundaParcela,
    inss,
    inssAliquota: bruto > 0 ? inss / bruto : 0,
    irrf,
    irrfAliquota: baseIRRF > 0 ? irrf / baseIRRF : 0,
    baseIRRF,
    liquido,
  };
}
