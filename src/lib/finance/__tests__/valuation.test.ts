import { describe, it, expect } from "vitest";
import { buildValuation, defaultValuationParams } from "../valuation";
import { createState, m12 } from "./helpers";

describe("buildValuation", () => {
  it("Empresa com EBITDA positivo → enterpriseValue.base > 0", () => {
    const s = createState();
    const params = defaultValuationParams(s.businessType);
    const v = buildValuation(s, params);
    expect(v.enterpriseValue.base).toBeGreaterThan(0);
  });

  it("low ≤ base ≤ high sempre", () => {
    const s = createState();
    const params = defaultValuationParams(s.businessType);
    const v = buildValuation(s, params);
    expect(v.enterpriseValue.low).toBeLessThanOrEqual(v.enterpriseValue.base);
    expect(v.enterpriseValue.base).toBeLessThanOrEqual(v.enterpriseValue.high);
  });

  it("Equity = EV − Dívida Onerosa (clampado em ≥ 0)", () => {
    const s = createState({ capital: { dividaOnerosa: 30000 } });
    const params = defaultValuationParams(s.businessType);
    const v = buildValuation(s, params);
    const expectedBase = Math.max(0, v.enterpriseValue.base - 30000);
    expect(v.equityValue.base).toBeCloseTo(expectedBase, 2);
  });

  it("Liquidity discount reduz o EV proporcionalmente", () => {
    const s = createState();
    const sem = buildValuation(s, { ...defaultValuationParams(s.businessType), liquidityDiscount: 0 });
    const com = buildValuation(s, { ...defaultValuationParams(s.businessType), liquidityDiscount: 0.3 });
    expect(com.enterpriseValue.base).toBeLessThan(sem.enterpriseValue.base);
  });

  it("Receita zero → EV blendado ≈ 0 (sem múltiplos aplicáveis)", () => {
    const s = createState({ revenue: { bruta: m12(0) } });
    const params = defaultValuationParams(s.businessType);
    const v = buildValuation(s, params);
    expect(v.multiplesDetails.blendedEnterpriseValue).toBeCloseTo(0, 2);
  });
});
