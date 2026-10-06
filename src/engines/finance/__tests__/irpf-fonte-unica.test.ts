/**
 * IRPF: motor financeiro (pró-labore) e calculadoras usam a mesma tabela.
 * Antes o motor tinha uma cópia parada na tabela de maio/2024.
 */
import { describe, expect, it } from "vitest";
import { calcIrpfMensal } from "../socios";
import { DEFAULT_STATE } from "../defaults";
import { IRPF_DESCONTO_SIMPLIFICADO_DEFAULT, IRPF_TABLE_DEFAULT } from "../taxDefaults";
import { calcularIRRF } from "@/engines/calculadoras/rescisao";

describe("IRPF — fonte única (Lei 15.191/2025 + redutor Lei 15.270/2025)", () => {
  it("tabela padrão do motor é a vigente", () => {
    expect(IRPF_TABLE_DEFAULT[0]).toEqual([2428.8, 0, 0]);
    expect(IRPF_TABLE_DEFAULT.at(-1)).toEqual([Number.POSITIVE_INFINITY, 27.5, 908.73]);
    expect(IRPF_DESCONTO_SIMPLIFICADO_DEFAULT).toBe(607.2);
  });

  it("pró-labore de R$ 6.000 (INSS 11% = R$ 660): IR de R$ 380,02", () => {
    // Tradicional: 6.000 − 660 = 5.340 → 27,5% − 908,73 = 559,77 (menor que o simplificado)
    // Redutor: 978,62 − 0,133145 × 6.000 = 179,75 → IR final 380,02
    const { valor } = calcIrpfMensal(6000, 660, 0, 0, DEFAULT_STATE.tax);
    expect(valor).toBeCloseTo(380.02, 2);
  });

  it.each([3000, 5000, 6000, 7350, 9000, 15000])(
    "motor e calculadora dão o mesmo IR para R$ %d",
    (bruto) => {
      const inss = Math.min(bruto * 0.11, 8475.55 * 0.11);
      const motor = calcIrpfMensal(bruto, inss, 0, 0, DEFAULT_STATE.tax).valor;
      expect(motor).toBeCloseTo(calcularIRRF(bruto, inss, 0), 2);
    },
  );
});
