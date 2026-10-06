import { describe, it, expect } from "vitest";
import {
  safeDivide,
  safePct,
  safeNumber,
  safePositive,
  clampFinite,
  isMonths,
  coerceMonths,
} from "../safeMath";

describe("safeDivide — divisão protegida para indicadores", () => {
  it("divisão comum: margem 250k ÷ 1M = 0,25", () => {
    expect(safeDivide(250_000, 1_000_000)).toBe(0.25);
  });

  it("denominador zero → fallback (ex.: WACC com V = 0)", () => {
    expect(safeDivide(10, 0)).toBe(0);
    expect(safeDivide(10, 0, -1)).toBe(-1);
  });

  it("numerador/denominador não finitos → fallback", () => {
    expect(safeDivide(NaN, 2, 7)).toBe(7);
    expect(safeDivide(Infinity, 2, 7)).toBe(7);
    expect(safeDivide(2, NaN, 7)).toBe(7);
    expect(safeDivide(2, -Infinity, 7)).toBe(7);
  });

  it("resultado que estoura para Infinity → fallback", () => {
    // 1e308 / 1e-308 = Infinity (overflow)
    expect(safeDivide(1e308, 1e-308, 3)).toBe(3);
  });

  it("preserva sinal negativo (prejuízo ÷ receita)", () => {
    expect(safeDivide(-50, 200)).toBe(-0.25);
  });
});

describe("safePct", () => {
  it("ROE: LL 150k ÷ PL 1M = 15%", () => {
    expect(safePct(150_000, 1_000_000)).toBeCloseTo(15, 10);
  });
  it("denominador zero → fallback × 100", () => {
    expect(safePct(1, 0)).toBe(0);
    // fallback é multiplicado por 100 (documentado: equivalente a safeDivide × 100)
    expect(safePct(1, 0, 0.5)).toBe(50);
  });
});

describe("safeNumber", () => {
  it("número finito passa intacto", () => {
    expect(safeNumber(-12.5)).toBe(-12.5);
    expect(safeNumber(0, 9)).toBe(0);
  });
  it("NaN/Infinity/undefined/null → fallback", () => {
    expect(safeNumber(NaN, 4)).toBe(4);
    expect(safeNumber(Infinity)).toBe(0);
    expect(safeNumber(undefined, 2)).toBe(2);
    expect(safeNumber(null, 3)).toBe(3);
  });
});

describe("safePositive — denominadores estruturais (PL, Ativo)", () => {
  it("valor positivo passa", () => {
    expect(safePositive(500)).toBe(500);
  });
  it("zero, negativo ou não finito → fallback (default 1)", () => {
    expect(safePositive(0)).toBe(1);
    expect(safePositive(-10)).toBe(1);
    expect(safePositive(NaN, 5)).toBe(5);
    expect(safePositive(Infinity, 5)).toBe(5);
  });
});

describe("clampFinite", () => {
  it("dentro, abaixo e acima do range", () => {
    expect(clampFinite(5, 0, 10)).toBe(5);
    expect(clampFinite(-3, 0, 10)).toBe(0);
    expect(clampFinite(42, 0, 10)).toBe(10);
  });
  it("não finito → fallback", () => {
    expect(clampFinite(NaN, 0, 10, 7)).toBe(7);
    expect(clampFinite(-Infinity, 0, 10)).toBe(0);
  });
});

describe("isMonths — validação de série mensal de 12 posições", () => {
  it("array de 12 números finitos é válido", () => {
    expect(isMonths(Array(12).fill(1))).toBe(true);
  });
  it("comprimento errado, não-array, ou slot inválido → false", () => {
    expect(isMonths(Array(11).fill(1))).toBe(false);
    expect(isMonths(Array(13).fill(1))).toBe(false);
    expect(isMonths("abc")).toBe(false);
    expect(isMonths(null)).toBe(false);
    const comNaN = Array(12).fill(1);
    comNaN[5] = NaN;
    expect(isMonths(comNaN)).toBe(false);
    const comString = Array(12).fill(1) as unknown[];
    comString[0] = "1";
    expect(isMonths(comString)).toBe(false);
  });
});

describe("coerceMonths — normaliza para Months[12]", () => {
  it("número solto replica nos 12 meses (ex.: aluguel fixo)", () => {
    expect(coerceMonths(3000)).toEqual(Array(12).fill(3000));
  });
  it("número não finito cai no ramo genérico → array de fill", () => {
    expect(coerceMonths(NaN, 2)).toEqual(Array(12).fill(2));
  });
  it("não-array → array de fill", () => {
    expect(coerceMonths({}, 1)).toEqual(Array(12).fill(1));
    expect(coerceMonths(undefined)).toEqual(Array(12).fill(0));
  });
  it("array curto completa com fill; longo trunca; slots inválidos viram fill", () => {
    const curto = coerceMonths([1, 2, 3], 9);
    expect(curto).toEqual([1, 2, 3, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const longo = coerceMonths(Array.from({ length: 15 }, (_, i) => i));
    expect(longo).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const sujo = coerceMonths([1, NaN, "x", Infinity, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sujo).toEqual([1, 0, 0, 0, 5, 6, 7, 8, 9, 10, 11, 12]);
    // soma anual preservada nos slots válidos
    expect(sujo.reduce((a, b) => a + b, 0)).toBe(1 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12);
  });
});
