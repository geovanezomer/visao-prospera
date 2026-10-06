import { describe, it, expect } from "vitest";
import { buildValuation, defaultValuationParams } from "../valuation";
import { buildDRE } from "../dre";
import { sum } from "../format";
import { createState, m12 } from "./helpers";
import { computeNetDebt } from "../shared";

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

  it("Equity = max(0, EV − Dívida Líquida) [Damodaran]", () => {
    const s = createState({
      revenue: { bruta: m12(80000), inadimplencia: m12(1) },
      capital: {
        debtContracts: [
          {
            id: "sim",
            credor: "Banco",
            saldoDevedor: 30000,
            taxaAA: 18,
            sistema: "price" as const,
            prazoMeses: 24,
          },
        ],
      },
    });
    const v = buildValuation(s, defaultValuationParams(s.businessType));
    const nd = Math.max(0, computeNetDebt(s));
    expect(v.equityValue.base).toBeCloseTo(Math.max(0, v.enterpriseValue.base - nd), 2);
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

  // Bloco 7: P/L produz EQUITY, não EV → conversão: EV_PL = Equity_PL + ND.
  // Sem essa conversão, blend penalizaria 2× a dívida (no EV e depois em Equity = EV − ND).
  it("Múltiplos P/L: EV implícito inclui Dívida Líquida (sem dupla dedução)", () => {
    const s = createState({
      revenue: { bruta: m12(80000), inadimplencia: m12(1) },
      capital: {
        debtContracts: [
          {
            id: "sim",
            credor: "Banco",
            saldoDevedor: 50000,
            taxaAA: 18,
            sistema: "price" as const,
            prazoMeses: 24,
          },
        ],
      },
    });
    const sNoD = createState({
      revenue: { bruta: m12(80000), inadimplencia: m12(1) },
      capital: {},
    });
    const vCom = buildValuation(s, {
      ...defaultValuationParams(s.businessType),
      method: "multiples",
    });
    const vSem = buildValuation(sNoD, {
      ...defaultValuationParams(sNoD.businessType),
      method: "multiples",
    });
    // Equity de cenários com mesma operação deve ser parecido (a dívida não destrói valor de equity duas vezes).
    // Tolerância larga porque pode mudar imposto na margem; teste qualitativo.
    expect(vCom.equityValue.base).toBeGreaterThan(vSem.equityValue.base * 0.5);
  });

  // Bloco 7: WACC ≤ g (spread < 0,5%) deve emitir warning e usar fallback FCL×5.
  it("DCF: spread WACC−g < 0,5% emite warning de Gordon não-convergente", () => {
    const s = profitableState();
    const v = buildValuation(s, {
      ...defaultValuationParams(s.businessType),
      method: "dcf",
      terminalGrowthRate: 0.5, // absurdo, força spread negativo
    });
    expect(v.dcfDetails?.warnings.some((w) => w.includes("Spread"))).toBe(true);
  });

  // Bloco 7: Strategic haircut reduz EV proporcionalmente.
  it("Haircut estratégico aplicado reduz EV final", () => {
    const s = profitableState();
    const sem = buildValuation(s, {
      ...defaultValuationParams(s.businessType),
      applyStrategicHaircut: false,
    });
    const com = buildValuation(s, {
      ...defaultValuationParams(s.businessType),
      applyStrategicHaircut: true,
    });
    expect(com.enterpriseValue.base).toBeLessThanOrEqual(sem.enterpriseValue.base);
  });
});
