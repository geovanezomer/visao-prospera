// Valores no teto técnico do motor (99) não aparecem como resultado.
import { describe, expect, it } from "vitest";
import { fmtAnos, fmtLiquidez, fmtTimes, indicadorValido } from "../format";
import { calcKanitz } from "../kanitz";
import { createState } from "./helpers";
import { buildFinancialModel } from "../financialModel";

describe("formatação de indicadores no teto", () => {
  it("liquidez: teto e negativa viram —; normal em pt-BR", () => {
    expect(fmtLiquidez(99)).toBe("—");
    expect(fmtLiquidez(-1.33)).toBe("—");
    expect(fmtLiquidez(1.5)).toBe("1,50");
  });
  it("anos: teto (lucro ≤ 0) vira —", () => {
    expect(fmtAnos(99)).toBe("—");
    expect(fmtAnos(3.25)).toBe("3,3 anos");
  });
  it("vezes: limites explícitos e vírgula decimal", () => {
    expect(fmtTimes(150, 1)).toBe("> 99×");
    expect(fmtTimes(-120, 1)).toBe("< −99×");
    expect(fmtTimes(2.5, 1)).toBe("2,5×");
    expect(fmtTimes(null, 1)).toBe("N/A");
  });
  it("indicadorValido", () => {
    expect(indicadorValido(98.9)).toBe(true);
    expect(indicadorValido(99)).toBe(false);
    expect(indicadorValido(NaN)).toBe(false);
    expect(indicadorValido(null)).toBe(false);
  });
});

describe("Kanitz com liquidez no teto", () => {
  it("sem passivo circulante (liquidez = teto) → base insuficiente, não FI 159", () => {
    const s = createState();
    const m = buildFinancialModel(s);
    const k = calcKanitz(s, {
      ...m.ind,
      liquidezGeral: 99,
      liquidezSeca: 99,
      liquidezCorrente: 99,
    });
    expect(k.baseInsuficiente).toBe(true);
    expect(k.label).toBe("Base insuficiente");
  });
  it("liquidez negativa → base insuficiente", () => {
    const s = createState();
    const m = buildFinancialModel(s);
    const k = calcKanitz(s, { ...m.ind, liquidezCorrente: -1.33 });
    expect(k.baseInsuficiente).toBe(true);
  });
});

describe("nota de saúde única", () => {
  it("o modelo expõe a mesma nota que o Diagnóstico calcula", async () => {
    const { computeHealth, HEALTH_LABEL } = await import("../health");
    const s = createState();
    const m = buildFinancialModel(s);
    const h = computeHealth(s);
    expect(m.health.total).toBeCloseTo(h.total, 9);
    expect(HEALTH_LABEL[h.grade]).toBeTruthy();
  });
});
