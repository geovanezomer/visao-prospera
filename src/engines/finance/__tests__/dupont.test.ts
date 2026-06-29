import { describe, it, expect } from "vitest";
import { buildFinancialModel } from "../financialModel";
import { buildDupont } from "../dupont";
import { DEFAULT_STATE } from "../defaults";

describe("DuPont", () => {
  it("identidade 3F e 5F reconstroem ROE com ≤ 0.5 p.p. de erro", () => {
    const s = structuredClone(DEFAULT_STATE);
    const { dre, ind } = buildFinancialModel(s);
    const d = buildDupont(s, dre, ind);
    // Quando há base, identidades devem reconstruir ROE (decimal).
    if (Math.abs(d.roeEngine) > 0.001) {
      expect(Math.abs(d.roeReconstruido3F - d.roeEngine)).toBeLessThan(0.005);
      expect(Math.abs(d.roeReconstruido5F - d.roeEngine)).toBeLessThan(0.005);
    }
  });

  it("EBIT≤0 sinaliza ebitNegativo e não quebra", () => {
    const s = structuredClone(DEFAULT_STATE);
    // Força um cenário deficitário inflando custos fixos.
    s.costs.custosFixos = s.costs.custosFixos.map(() => 1e9);
    const { dre, ind } = buildFinancialModel(s);
    const d = buildDupont(s, dre, ind);
    expect(d.ebitNegativo).toBe(true);
    expect(Number.isFinite(d.margemEbit)).toBe(true);
  });

  it("Sem PL/AT informado, MAF cai para 0 (não NaN/Infinity)", () => {
    const s = structuredClone(DEFAULT_STATE);
    s.capital.patrimonioLiquido = 0;
    s.capital.patrimonioLiquidoAbertura = 0;
    s.capital.ativoTotal = 0;
    s.capital.ativoTotalAbertura = 0;
    const { dre, ind } = buildFinancialModel(s);
    const d = buildDupont(s, dre, ind);
    expect(Number.isFinite(d.maf)).toBe(true);
    expect(d.maf).toBe(0);
    expect(d.ativoEstimado).toBe(true);
  });
});
