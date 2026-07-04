/**
 * Testes das tabelas 2026 — Portaria Interministerial MPS/MF nº 13/2026.
 * Garante que calcularINSS respeite as novas faixas e o novo teto.
 */
import { describe, expect, it } from "vitest";
import { calcularINSS } from "../rescisao";
import { getTabelas, ANO_VIGENTE, TABELAS } from "../tabelas";

describe("Tabelas 2026 — INSS", () => {
  it("ANO_VIGENTE = 2026", () => {
    expect(ANO_VIGENTE).toBe(2026);
  });

  it("salário mínimo (R$ 1.621) — apenas 7,5% na 1ª faixa", () => {
    // 1621 × 0,075 = 121,575 → 121,58
    expect(calcularINSS(1621.0)).toBeCloseTo(121.58, 2);
  });

  it("salário R$ 3.000 — atravessa 3 faixas", () => {
    // 121,575 + (2902,84-1621)×0,09 + (3000-2902,84)×0,12 = 248,5998
    expect(calcularINSS(3000.0)).toBeCloseTo(248.6, 2);
  });

  it("salário acima do teto — cap em R$ 8.475,55 (INSS = R$ 988,09)", () => {
    expect(calcularINSS(10_000)).toBeCloseTo(988.09, 2);
  });

  it("contribuinte individual 11% sobre o mínimo = R$ 178,31", () => {
    const min = getTabelas().salarioMinimo;
    expect(Math.round(min * 0.11 * 100) / 100).toBeCloseTo(178.31, 2);
  });

  it("cobertura histórica: getTabelas(2025) preserva teto antigo R$ 8.157,41", () => {
    expect(TABELAS[2025].inssTeto).toBe(8157.41);
    expect(calcularINSS(1518.0, 2025)).toBeCloseTo(113.85, 2);
  });
});
