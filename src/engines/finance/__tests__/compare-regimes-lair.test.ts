/**
 * compareRegimes: o IRPJ/CSLL do Lucro Real usa o LAIR do próprio Real.
 */
import { describe, expect, it } from "vitest";
import { compareRegimes } from "../tax/compare";
import { calcReal } from "../tax/real";
import { buildDRE } from "../dre";
import { createState, m12 } from "./helpers";

describe("compareRegimes — Lucro Real", () => {
  const s = createState({
    tax: { regime: "presumido" },
    businessType: "servicos",
    revenue: { bruta: m12(500_000) },
  });

  it("usa o LAIR do Real (PIS/COFINS 9,25%), não o do Presumido", () => {
    const { real } = compareRegimes(s);
    const lairReal = buildDRE(s, "real").dre.lair;
    const lairPresumido = buildDRE(s, "presumido").dre.lair;
    expect(real.annual).toBeCloseTo(calcReal(s, lairReal).annual, 2);
    // Sanidade: as duas bases diferem, então o bug antigo daria outro número.
    expect(lairReal.reduce((a, b) => a + b, 0)).not.toBeCloseTo(
      lairPresumido.reduce((a, b) => a + b, 0),
      0,
    );
  });

  it("best é o regime de maior lucro líquido", () => {
    const r = compareRegimes(s);
    const max = Math.max(r.llBy.simples, r.llBy.presumido, r.llBy.real);
    expect(r.llBy[r.best]).toBe(max);
  });
});
