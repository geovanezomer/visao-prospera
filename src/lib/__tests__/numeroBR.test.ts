import { describe, expect, it } from "vitest";
import { lerNumeroBR, numeroParaCampo } from "../numeroBR";

describe("lerNumeroBR", () => {
  it.each([
    ["150.000", 150_000],
    ["1.500,00", 1500],
    ["1.234,56", 1234.56],
    ["12.345.678,9", 12_345_678.9],
    ["12,5", 12.5],
    ["1.5", 1.5],
    ["0.25", 0.25],
    ["13000", 13000],
    ["R$ 2.500,10", 2500.1],
    ["-1.200,50", -1200.5],
    ["1,234,567", 1_234_567],
    ["8 %", 8],
    ["", 0],
    ["-", 0],
    ["abc", 0],
  ])("%s → %d", (txt, n) => expect(lerNumeroBR(txt)).toBeCloseTo(n, 9));

  it("ida e volta pelo texto do campo preserva o valor", () => {
    for (const n of [1500, 1500.75, 0.125, 1234567.89, -42.5, 1.234])
      expect(lerNumeroBR(numeroParaCampo(n))).toBeCloseTo(n, 9);
    expect(numeroParaCampo(0)).toBe("");
    expect(numeroParaCampo(150000)).toBe("150.000");
  });
});
