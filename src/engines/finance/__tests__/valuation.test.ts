import { describe, it, expect } from "vitest";
import { buildValuation, defaultValuationParams } from "../valuation";
import { buildDRE } from "../calculations";
import { sum } from "../format";
import { createState, m12 } from "./helpers";

// Cria um cenário lucrativo (EBITDA > 0) para testar valuation positiva.
// O DEFAULT_STATE tem custos altos → EBITDA negativo, inadequado para esses testes.
function profitableState() {
  return createState({
    revenue: { bruta: m12(80000), inadimplencia: m12(1), pmr: 30 },
  });
}

describe("buildValuation — cenário lucrativo", () => {
  it("Sanidade: cenário gera EBITDA positivo", () => {
    const s = profitableState();
    const { dre } = buildDRE(s, s.tax.regime);
    expect(sum(dre.ebitda)).toBeGreaterThan(0);
  });

  it("Empresa com EBITDA positivo → enterpriseValue.base > 0", () => {
    const s = profitableState();
    const v = buildValuation(s, defaultValuationParams(s.businessType));
    expect(v.enterpriseValue.base).toBeGreaterThan(0);
  });

  it("low ≤ base ≤ high sempre", () => {
    const s = profitableState();
    const v = buildValuation(s, defaultValuationParams(s.businessType));
    expect(v.enterpriseValue.low).toBeLessThanOrEqual(v.enterpriseValue.base);
    expect(v.enterpriseValue.base).toBeLessThanOrEqual(v.enterpriseValue.high);
  });

  it("Equity = max(0, EV − Dívida Onerosa)", () => {
    const s = createState({
      revenue: { bruta: m12(80000), inadimplencia: m12(1) },
      capital: { dividaOnerosa: 30000 },
    });
    const v = buildValuation(s, defaultValuationParams(s.businessType));
    expect(v.equityValue.base).toBeCloseTo(Math.max(0, v.enterpriseValue.base - 30000), 2);
  });

  it("Liquidity discount reduz o EV proporcionalmente", () => {
    const s = profitableState();
    const sem = buildValuation(s, {
      ...defaultValuationParams(s.businessType),
      liquidityDiscount: 0,
    });
    const com = buildValuation(s, {
      ...defaultValuationParams(s.businessType),
      liquidityDiscount: 0.3,
    });
    expect(com.enterpriseValue.base).toBeLessThan(sem.enterpriseValue.base);
  });

  it("Receita zero → EV blendado ≈ 0 (sem múltiplos aplicáveis)", () => {
    const s = createState({ revenue: { bruta: m12(0) } });
    const v = buildValuation(s, defaultValuationParams(s.businessType));
    expect(v.multiplesDetails.blendedEnterpriseValue).toBeCloseTo(0, 2);
  });
});
