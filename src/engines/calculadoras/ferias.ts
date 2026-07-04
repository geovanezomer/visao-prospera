/**
 * Engine de cálculo de Férias CLT.
 *
 * Bases legais:
 *  - CLT arts. 129 a 153 (direito a férias após período aquisitivo de 12 meses).
 *  - CF art. 7º, XVII: adicional de 1/3 sobre a remuneração das férias.
 *  - CLT art. 143: abono pecuniário — venda de até 1/3 das férias (10 dias).
 *  - Tabelas INSS/IRRF versionadas em ./tabelas.ts (SSOT anual).
 *
 * Regras fiscais consolidadas:
 *  - Férias gozadas + 1/3 constitucional: incidem INSS e IRRF.
 *  - Abono pecuniário (10 dias vendidos) + 1/3 sobre o abono: ISENTOS de INSS
 *    e IRRF (Lei 7.713/88 art. 6º, V; IN RFB 1.500/2014 art. 11; Solução de
 *    Consulta COSIT 188/2015).
 *
 * Engine pura — sem dependência de UI.
 */
import { z } from "zod";
import { calcularINSS, calcularIRRF } from "./rescisao";
import { round2 } from "./utils";

// ============================================================================
// Schema de entrada
// ============================================================================

export const feriasInputSchema = z.object({
  salarioBruto: z.number().min(0),
  /** Vender 10 dias (abono pecuniário). Quando true, goza 20 dias. */
  abonoPecuniario: z.boolean().default(false),
  dependentesIR: z.number().int().min(0).default(0),
});

export type FeriasInput = z.infer<typeof feriasInputSchema>;

// ============================================================================
// Saída
// ============================================================================

export interface FeriasOutput {
  diasGozados: number;
  diasAbono: number;
  /** Férias proporcionais aos dias gozados (sem 1/3). */
  feriasBase: number;
  /** 1/3 constitucional sobre as férias gozadas. */
  tercoFerias: number;
  /** Valor do abono pecuniário (dias vendidos). */
  abonoValor: number;
  /** 1/3 sobre o abono pecuniário. */
  tercoAbono: number;
  /** Bruto total a pagar (férias + 1/3 + abono + 1/3 abono). */
  brutoTotal: number;
  /** Base de cálculo INSS/IRRF (férias + 1/3). */
  baseTributavel: number;
  inss: number;
  irrf: number;
  /** Base do IRRF após dedução de INSS e dependentes. */
  baseIRRF: number;
  liquido: number;
}

// ============================================================================
// Cálculo principal
// ============================================================================

export function calcularFerias(inputBruto: FeriasInput): FeriasOutput {
  const i = feriasInputSchema.parse(inputBruto);

  const diasGozados = i.abonoPecuniario ? 20 : 30;
  const diasAbono = i.abonoPecuniario ? 10 : 0;

  // Férias proporcionais aos dias gozados.
  const feriasBase = round2((i.salarioBruto / 30) * diasGozados);
  const tercoFerias = round2(feriasBase / 3);

  // Abono pecuniário + 1/3 (isentos).
  const abonoValor = round2((i.salarioBruto / 30) * diasAbono);
  const tercoAbono = round2(abonoValor / 3);

  // Base tributável: férias gozadas + 1/3 constitucional.
  const baseTributavel = round2(feriasBase + tercoFerias);

  const inss = calcularINSS(baseTributavel);
  const irrf = calcularIRRF(baseTributavel, inss, i.dependentesIR);
  const baseIRRF = Math.max(0, baseTributavel - inss - i.dependentesIR * 189.59);

  const brutoTotal = round2(feriasBase + tercoFerias + abonoValor + tercoAbono);
  const liquido = round2(brutoTotal - inss - irrf);

  return {
    diasGozados,
    diasAbono,
    feriasBase,
    tercoFerias,
    abonoValor,
    tercoAbono,
    brutoTotal,
    baseTributavel,
    inss,
    irrf,
    baseIRRF,
    liquido,
  };
}
