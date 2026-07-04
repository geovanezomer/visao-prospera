/**
 * Testes do redutor IRRF Lei 15.270/2025 (vigência 01/01/2026).
 * Vetores da orientação oficial RFB (dez/2025).
 */
import { describe, expect, it } from "vitest";
import {
  calcularINSS,
  calcularIRRF,
  redutorLei15270,
} from "../rescisao";
import { calcularDecimoTerceiro } from "../decimoTerceiro";

describe("Lei 15.270/2025 — redutor IRRF mensal", () => {
  it("redutorLei15270(6000, 999) ≈ 179,75", () => {
    // 978,62 − 0,133145 × 6.000 = 179,75
    expect(redutorLei15270(6000, 999)).toBeCloseTo(179.75, 2);
  });

  it("rendimento ≤ 5.000 → redutor = imposto (IR final = 0)", () => {
    // Exemplo Maria/RFB: bruto 5.000, INSS calc para 2026, IR = 0.
    const inss = calcularINSS(5000);
    expect(calcularIRRF(5000, inss, 0)).toBe(0);
  });

  it("bruto 3.500 → sempre isento (abaixo do teto do redutor)", () => {
    const inss = calcularINSS(3500);
    expect(calcularIRRF(3500, inss, 0)).toBe(0);
  });

  it("bruto 7.607,20 → sem redutor (>7.350) → IR = 1.016,27 (via desconto simplificado)", () => {
    // Exemplo Vera/RFB — INSS 0 e simplificado (R$ 607,20) é escolhido.
    expect(calcularIRRF(7607.2, 0, 0)).toBeCloseTo(1016.27, 2);
  });

  it("redutor não gera IR negativo (limitado ao apurado)", () => {
    expect(redutorLei15270(5001, 10)).toBeLessThanOrEqual(10);
    expect(redutorLei15270(6000, 50)).toBeLessThanOrEqual(50);
  });

  it("13º de R$ 5.000 → IR exclusivo na fonte zerado pelo redutor", () => {
    const r = calcularDecimoTerceiro({
      salarioBruto: 5000,
      mesesTrabalhados: 12,
      dependentesIR: 0,
    });
    expect(r.irrf).toBe(0);
  });
});
