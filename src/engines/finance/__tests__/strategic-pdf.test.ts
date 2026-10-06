// Resumo dos insights para o PDF: mesmos números do motor estratégico da tela.
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { DEFAULT_SIM } from "../simulator";
import { bridge, buildStrategicPdfInsights, stressTests, valueCreation } from "../strategic2";

describe("buildStrategicPdfInsights", () => {
  const s = createState();
  const p = { ...DEFAULT_SIM, priceDeltaPct: 5, fixedCutPct: 10 };

  it("ponte do lucro igual à da tela e fechando a diferença", () => {
    const r = buildStrategicPdfInsights(s, p);
    const b = bridge(s, p);
    expect(r.ponte!.base).toBeCloseTo(b.base.lucroLiquido, 6);
    expect(r.ponte!.simulado).toBeCloseTo(b.simulado.lucroLiquido, 6);
    const soma = r.ponte!.itens.reduce((a, i) => a + i.valor, 0);
    expect(r.ponte!.base + soma).toBeCloseTo(r.ponte!.simulado, 2);
    expect(r.cenario).not.toMatch(/sem alavancas/);
  });

  it("estresse e criação de valor iguais aos do motor; meses por nome", () => {
    const r = buildStrategicPdfInsights(s, p);
    const st = stressTests(s, p);
    expect(r.estresse.map((e) => e.caixaMinimo)).toEqual(st.map((e) => e.caixaMinimo));
    expect(r.estresse.every((e) => /^[A-Z][a-z]{2}$/.test(e.mes))).toBe(true);
    expect(r.valor.simulado.eva).toBeCloseTo(valueCreation(s, p).simulado.eva, 6);
    expect(r.tornado.length).toBeLessThanOrEqual(8);
  });

  it("sem alavancas: sem ponte, cenário base", () => {
    const r = buildStrategicPdfInsights(s, DEFAULT_SIM);
    expect(r.ponte).toBeNull();
    expect(r.cenario).toMatch(/cenário base/);
  });
});
