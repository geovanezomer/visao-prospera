/**
 * Testes adicionais cobrindo:
 *  1. NCG — todas as branches de `estoqueMedio` em indicators.ts:312
 *     (a) ei>0 && ef>0  → média (ei+ef)/2
 *     (b) ei=0 && ef>0  → usa ef
 *     (c) ei=0 && ef=0  → fallback capital.estoques
 *  2. Reforma Tributária — comparação Real entre eras "atual" e "pleno" (2033+).
 */
import { describe, it, expect } from "vitest";
import { calcIndicators } from "../indicators";
import { buildDRE } from "../dre";
import { compareErasForRegime } from "../tax/compare";
import { createState, m12 } from "./helpers";
import type { CostLine } from "../types";

const cpvLine: CostLine = {
  id: "cpv",
  label: "CPV",
  category: "custo_vendas",
  values: m12(5_000),
  fixed: false,
};

const baseRevenue = { bruta: m12(10_000), pmr: 30, pmp: 30 };

// PME esperado: estoqueMedio / (cpvAnual/360) = 30k / (60k/360) = 30k / 166.67 ≈ 180 dias
// cicloOperacional = pmr(30) + pme(180) = 210 dias
const PME_ESPERADO = 180;
const CICLO_OP_ESPERADO = 30 + PME_ESPERADO;

describe("NCG — branches de estoqueMedio (indicators.ts:312)", () => {
  it("branch (a): ei>0 && ef>0 → média aritmética", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: [cpvLine],
      capital: { estoqueInicial: 20_000, estoqueFinal: 40_000, estoques: 99_999 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    // estoqueMedio = (20k+40k)/2 = 30k → ignora capital.estoques
    expect(ind.cicloOperacional).toBeCloseTo(CICLO_OP_ESPERADO, 0);
    expect(ind.ncg).toBeCloseTo(10_000 + 30_000 - 5_000, -2);
  });

  it("branch (b): ei=0 && ef>0 → usa ef puro", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: [cpvLine],
      capital: { estoqueInicial: 0, estoqueFinal: 30_000, estoques: 99_999 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    expect(ind.cicloOperacional).toBeCloseTo(CICLO_OP_ESPERADO, 0);
    expect(ind.ncg).toBeCloseTo(10_000 + 30_000 - 5_000, -2);
  });

  it("branch (c): ei=0 && ef=0 → fallback capital.estoques", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: [cpvLine],
      capital: { estoqueInicial: 0, estoqueFinal: 0, estoques: 30_000 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    expect(ind.cicloOperacional).toBeCloseTo(CICLO_OP_ESPERADO, 0);
    expect(ind.ncg).toBeCloseTo(10_000 + 30_000 - 5_000, -2);
  });

  it("sem estoque algum: PME=0 e NCG = CR − Fornecedores", () => {
    const s = createState({
      revenue: baseRevenue,
      costs: [cpvLine],
      capital: { estoqueInicial: 0, estoqueFinal: 0, estoques: 0 },
    });
    const { dre } = buildDRE(s, s.tax.regime);
    const ind = calcIndicators(s, dre);
    // PME=0 → cicloOperacional = pmr = 30
    expect(ind.cicloOperacional).toBeCloseTo(30, 0);
    expect(ind.ncg).toBeCloseTo(10_000 - 5_000, -2);
  });
});

describe("Reforma Tributária — comparação Real entre eras (atual vs pleno)", () => {
  const cenarioReal = () =>
    createState({
      businessType: "comercio",
      tax: { regime: "real" },
      revenue: { bruta: m12(50_000) },
      costs: [
        {
          id: "cpv",
          label: "CPV",
          category: "variavel",
          values: m12(25_000),
          fixed: false,
        },
      ],
    });

  it("compareErasForRegime devolve as 3 eras com valores finitos e não-negativos", () => {
    const eras = compareErasForRegime(cenarioReal(), "real");
    expect(eras).toHaveLength(3);
    expect(eras.map((e) => e.era).sort()).toEqual(["atual", "pleno", "transicao"]);
    for (const e of eras) {
      expect(Number.isFinite(e.effective)).toBe(true);
      expect(Number.isFinite(e.annual)).toBe(true);
      expect(e.annual).toBeGreaterThanOrEqual(0);
    }
  });

  it("era 'pleno' produz carga DIFERENTE de 'atual' (CBS+IBS substituem PIS/COFINS/ICMS/ISS)", () => {
    const eras = compareErasForRegime(cenarioReal(), "real");
    const atual = eras.find((e) => e.era === "atual")!;
    const pleno = eras.find((e) => e.era === "pleno")!;
    // A diferença pode ser positiva ou negativa dependendo do setor/alíquotas,
    // mas NÃO pode ser zero — a estrutura tributária mudou de fato.
    expect(Math.abs(pleno.annual - atual.annual)).toBeGreaterThan(0);
  });
});
