/**
 * Testes adicionais cobrindo:
 *  1. NCG — todas as branches de `estoqueMedio` em indicators.ts:312
 *     (a) ei>0 && ef>0  → média (ei+ef)/2
 *     (b) ei=0 && ef>0  → usa ef
 *     (c) ei=0 && ef=0  → fallback capital.estoques
 *  2. Reforma Tributária — comparação Real entre eras "atual" e "pleno" (2033+).
 *
 * Justificativa: as branches de estoqueMedio impactam NCG, PME e Ciclo
 * Financeiro; antes apenas a branch (a) era coberta indiretamente.
 * A era "pleno" precisa de teste end-to-end porque a transição multiplicativa
 * é o caso mais comum em produção, mas o regime-alvo (sem PIS/COFINS, com
 * CBS/IBS plenos) é o que governa decisões estratégicas pós-2033.
 */
import { describe, it, expect } from "vitest";
import { calcIndicators } from "../indicators";
import { buildDRE } from "../dre";
import { compareErasForRegime } from "../tax/compare";
import { createState, m12 } from "./helpers";

describe("NCG — branches de estoqueMedio (indicators.ts:312)", () => {
  // Cenário base: receita de R$ 120k/ano, CPV de 60k → cpvDiario = 60k/360 ≈ 166,67
  const baseRevenue = { bruta: m12(10_000), pmr: 30, pmp: 30 };
  const baseCosts = [
    {
      id: "cpv",
      nome: "CPV",
      tipo: "variavel" as const,
      categoria: "cpv" as const,
      valores: m12(5_000),
    },
  ];

  it("branch (a): ei>0 && ef>0 → média aritmética", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: baseCosts,
      capital: { estoqueInicial: 20_000, estoqueFinal: 40_000, estoques: 99_999 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    // estoqueMedio esperado = (20k+40k)/2 = 30k
    // pme = 30000 / (60000/360) = 30000 / 166.67 ≈ 180
    expect(ind.pme).toBeGreaterThan(170);
    expect(ind.pme).toBeLessThan(190);
    // NCG = CR(10k) + 30k - Forn(5k) = 35k (CR e Forn estimados de pmr/pmp)
    expect(ind.ncg).toBeCloseTo(10_000 + 30_000 - 5_000, -2);
  });

  it("branch (b): ei=0 && ef>0 → usa ef puro", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: baseCosts,
      capital: { estoqueInicial: 0, estoqueFinal: 30_000, estoques: 99_999 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    // estoqueMedio = ef = 30k (não usa capital.estoques)
    expect(ind.pme).toBeGreaterThan(170);
    expect(ind.pme).toBeLessThan(190);
    expect(ind.ncg).toBeCloseTo(10_000 + 30_000 - 5_000, -2);
  });

  it("branch (c): ei=0 && ef=0 → fallback capital.estoques", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: baseCosts,
      capital: { estoqueInicial: 0, estoqueFinal: 0, estoques: 30_000 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    // estoqueMedio = capital.estoques = 30k
    expect(ind.pme).toBeGreaterThan(170);
    expect(ind.pme).toBeLessThan(190);
    expect(ind.ncg).toBeCloseTo(10_000 + 30_000 - 5_000, -2);
  });

  it("sem estoque algum: PME=0 e NCG = CR − Fornecedores", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: baseCosts,
      capital: { estoqueInicial: 0, estoqueFinal: 0, estoques: 0 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    expect(ind.pme).toBe(0);
    expect(ind.ncg).toBeCloseTo(10_000 - 5_000, -2);
  });
});

describe("Reforma Tributária — comparação Real entre eras (atual vs pleno)", () => {
  it("compareErasForRegime devolve as 3 eras com cargas finitas e positivas", () => {
    const s = createState({
      businessType: "comercio",
      tax: { regime: "real" },
      revenue: { bruta: m12(50_000) },
      costs: [
        {
          id: "cpv",
          nome: "CPV",
          tipo: "variavel",
          categoria: "cpv",
          valores: m12(25_000),
        },
      ],
    });
    const eras = compareErasForRegime(s, "real");
    expect(eras).toHaveLength(3);
    const labels = eras.map((e) => e.era).sort();
    expect(labels).toEqual(["atual", "pleno", "transicao"]);
    for (const e of eras) {
      expect(Number.isFinite(e.effective)).toBe(true);
      expect(Number.isFinite(e.annual)).toBe(true);
      expect(e.annual).toBeGreaterThanOrEqual(0);
    }
  });

  it("era 'pleno' produz carga diferente de 'atual' (CBS+IBS substituem PIS/COFINS/ICMS/ISS)", () => {
    const s = createState({
      businessType: "comercio",
      tax: { regime: "real" },
      revenue: { bruta: m12(50_000) },
      costs: [
        {
          id: "cpv",
          nome: "CPV",
          tipo: "variavel",
          categoria: "cpv",
          valores: m12(25_000),
        },
      ],
    });
    const eras = compareErasForRegime(s, "real");
    const atual = eras.find((e) => e.era === "atual")!;
    const pleno = eras.find((e) => e.era === "pleno")!;
    // A diferença pode ser positiva ou negativa dependendo do setor/alíquotas,
    // mas NÃO pode ser zero — a estrutura tributária mudou de fato.
    expect(Math.abs(pleno.annual - atual.annual)).toBeGreaterThan(0);
  });
});
