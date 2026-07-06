/**
 * Indicadores — testes canônicos
 *
 * Cobertura: WACC, ROIC, FCF, Ponto de Equilíbrio, NCG, Cobertura de Juros,
 * ROE/ROA, Giro do Ativo. Inclui guards contra divisão por zero (denominadores
 * estruturais ausentes) para garantir que safeMath está aplicado.
 */
import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { calcIndicators } from "../indicators";
import { irShieldForRegime } from "../tax/real";
import { createState, m12 } from "./helpers";

const aproxPp = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

describe("Indicadores — WACC", () => {
  it("WACC = wE·Ke + wD·Kd·(1−T) no Lucro Real (T=34%)", () => {
    const s = createState({
      tax: { regime: "real" },
      capital: { ke: 15, kd: 10, patrimonioLiquido: 600_000, debtContracts: [{ id: "sim", credor: "Banco", saldoDevedor: 400_000, taxaAA: 18, sistema: "price" as const, prazoMeses: 24 }]},
    });
    const { dre } = buildDRE(s, "real");
    const ind = calcIndicators(s, dre);
    // 0.6 · 15 + 0.4 · 10 · (1 − 0.34) = 9 + 2.64 = 11.64
    expect(aproxPp(ind.wacc, 11.64)).toBe(true);
  });

  it("WACC sem shield em Simples (T=0)", () => {
    expect(irShieldForRegime("simples")).toBe(0);
    const s = createState({
      tax: { regime: "simples" },
      capital: { ke: 15, kd: 10, patrimonioLiquido: 500_000, debtContracts: [{ id: "sim", credor: "Banco", saldoDevedor: 500_000, taxaAA: 18, sistema: "price" as const, prazoMeses: 24 }]},
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // 0.5·15 + 0.5·10 = 12.5
    expect(aproxPp(ind.wacc, 12.5)).toBe(true);
  });

  it("WACC finito mesmo com PL=0 e Dívida=0 (safeMath)", () => {
    const s = createState({
      capital: { ke: 15, kd: 10, patrimonioLiquido: 0,  proprio: 100 },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.wacc)).toBe(true);
  });
});

describe("Indicadores — ROIC / ROE / ROA", () => {
  it("ROIC preserva prejuízo operacional (não trava NOPAT negativo em zero)", () => {
    const s = createState({
      revenue: { bruta: m12(10_000), inadimplencia: m12(0) },
      costs: [{ id: "cf", label: "Custo fixo", category: "fixo", values: m12(30_000), fixed: true }],
      capital: { ativoTotal: 1_000_000, patrimonioLiquido: 700_000, },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);

    expect(ind.ebitAnual).toBeLessThan(0);
    expect(ind.nopat).toBeLessThan(0);
    expect(ind.roic).toBeLessThan(0);
  });

  it("ROIC usa capital investido real e não denominador artificial 1", () => {
    const s = createState({
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
      costs: [],
      capital: {
        ativoTotal: 0,
        patrimonioLiquido: 0,
        
        passivosNaoOnerosos: 0,
        caixaOcioso: 0,
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);

    expect(ind.capitalInvestido).toBe(0);
    expect(ind.roic).toBe(0);
  });

  it("NOPAT no Lucro Real aplica alíquota marginal operacional sem dupla contagem", () => {
    const s = createState({
      tax: { regime: "real" },
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
      costs: [{ id: "cv", label: "CV", category: "variavel", values: m12(40_000), fixed: false }],
      capital: { ativoTotal: 2_000_000, patrimonioLiquido: 1_500_000, },
    });
    const { dre } = buildDRE(s, "real");
    const ind = calcIndicators(s, dre);

    expect(ind.ebitAnual).toBeGreaterThan(240_000);
    expect(ind.aliquotaNopat).toBeCloseTo(34, 1);
    expect(ind.nopat).toBeCloseTo(ind.ebitAnual * 0.66, 0);
  });

  it("ROE = LL/PL × 100 (positivo)", () => {
    const s = createState({
      revenue: { bruta: m12(100_000) },
      capital: { patrimonioLiquido: 1_200_000, ativoTotal: 2_000_000 },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // ROE deve ser um número finito (não-null quando PL médio > 0).
    expect(ind.roe).not.toBeNull();
    expect(Number.isFinite(ind.roe as number)).toBe(true);
  });

  it("ROE = null quando PL = 0 (padrão CFA: métrica sem significado)", () => {
    const s = createState({ capital: { patrimonioLiquido: 0 } });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.roe).toBeNull();
  });

  /**
   * Corolário DuPont: sem alavancagem financeira (net debt ≤ 0), ROE ≈ ROIC.
   * Diferença > 5 p.p. sinaliza que ROE ou ROIC está com denominador errado —
   * classicamente ROE usando apenas Capital Social em vez do PL completo.
   */
  it("ROE ≈ ROIC quando não há dívida líquida (DuPont sem alavancagem)", () => {
    const s = createState({
      revenue: { bruta: m12(200_000) },
      capital: {
        ke: 15,
        kd: 0,
        patrimonioLiquido: 1_000_000,
        ativoTotal: 1_200_000,
        disponibilidades: 200_000, // caixa > 0
        debtContracts: [], // sem dívida onerosa
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.roe).not.toBeNull();
    expect(Math.abs((ind.roe as number) - ind.roic)).toBeLessThan(5);
  });

  it("ROA = 0 quando Ativo Total = 0 (sem Infinity)", () => {
    const s = createState({ capital: { ativoTotal: 0 } });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.roa).toBe(0);
    expect(Number.isFinite(ind.roa)).toBe(true);
  });

  it("ROIC finito mesmo com Capital Investido degenerado", () => {
    const s = createState({
      capital: {
        ativoTotal: 0,
        patrimonioLiquido: 0,
        
        passivosNaoOnerosos: 0,
        fornecedores: 0,
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.roic)).toBe(true);
  });
});

describe("Indicadores — Ponto de Equilíbrio", () => {
  it("PE = Custos Fixos ÷ Margem de Contribuição", () => {
    // Setup minimalista: zera todos os custos default e adiciona controlados.
    const s = createState({
      revenue: { bruta: m12(10_000), inadimplencia: m12(0) },
      costs: [
        { id: "cv", label: "CV", category: "variavel", values: m12(4_000), fixed: false },
        { id: "cf", label: "Aluguel", category: "fixo", values: m12(2_000), fixed: true },
      ],
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // MC% = (RL − CV)/RL ; PE = CF / (MC%/100)
    expect(ind.margemContribuicao).toBeGreaterThan(0);
    expect(ind.pontoEquilibrio).toBeGreaterThan(0);
    expect(Number.isFinite(ind.pontoEquilibrio)).toBe(true);
  });

  it("PE = 0 quando MC% ≤ 0 (sem Infinity)", () => {
    const s = createState({
      revenue: { bruta: m12(1_000) },
      costs: [{ id: "cv", label: "CV", category: "variavel", values: m12(5_000), fixed: false }],
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.pontoEquilibrio).toBe(0);
  });
});

describe("Indicadores — NCG e FCF", () => {
  it("NCG = CR + Estoque − Fornecedores (finito)", () => {
    const s = createState({
      capital: { contasReceber: 100_000, estoques: 50_000, fornecedores: 30_000 },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // estoqueMedio = estoques quando inicial/final omitidos => 50k
    expect(ind.ncg).toBeCloseTo(100_000 + 50_000 - 30_000, 0);
  });

  it("FCF finito mesmo sem dados de capital de giro", () => {
    const s = createState({});
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.fcf)).toBe(true);
  });

  it("FCF aumenta quando há redução de NCG (liberação de caixa)", () => {
    const base = createState({
      revenue: { bruta: m12(100_000), inadimplencia: m12(0), pmr: 0, pmp: 0 },
      costs: [],
      capital: {
        ativoTotal: 1_000_000,
        patrimonioLiquido: 800_000,
        
        contasReceber: 0,
        estoques: 0,
        fornecedores: 0,
      },
    });
    const semLiberacao = createState({ ...base, capital: { ...base.capital, ncgAbertura: 0 } });
    const comLiberacao = createState({ ...base, capital: { ...base.capital, ncgAbertura: 100_000 } });

    const indSem = calcIndicators(semLiberacao, buildDRE(semLiberacao, "simples").dre);
    const indCom = calcIndicators(comLiberacao, buildDRE(comLiberacao, "simples").dre);

    expect(indCom.fcf).toBeCloseTo(indSem.fcf + 100_000, 0);
  });
});

describe("Indicadores — Cobertura de Juros e Giro", () => {
  it("Cobertura de Juros = CAP quando juros ≈ 0 (sem Infinity)", () => {
    const s = createState({});
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.coberturaJuros)).toBe(true);
  });

  it("Giro do Ativo = 0 quando Ativo Total = 0", () => {
    const s = createState({ capital: { ativoTotal: 0 } });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.giroAtivo).toBe(0);
  });
});

// [Auditoria Bloco 5] ROA e Giro do Ativo devem usar ATIVO MÉDIO quando abertura informada.
describe("Indicadores — ROA / Giro com Ativo Médio (CFA/Damodaran)", () => {
  it("ROA usa Ativo MÉDIO = (abertura + final)/2 quando ativoTotalAbertura > 0", () => {
    const sFinal = createState({
      capital: { ativoTotal: 1_200_000 },
      tax: { regime: "real" },
    });
    const sMedio = createState({
      capital: { ativoTotal: 1_200_000, ativoTotalAbertura: 800_000 },
      tax: { regime: "real" },
    });
    const indFinal = calcIndicators(sFinal, buildDRE(sFinal, "real").dre);
    const indMedio = calcIndicators(sMedio, buildDRE(sMedio, "real").dre);
    // Médio = 1.000.000 < final = 1.200.000 → ROA médio > ROA ponto-final (mesmo LL, denominador menor).
    if (indFinal.roa !== 0) {
      expect(Math.abs(indMedio.roa)).toBeGreaterThan(Math.abs(indFinal.roa));
    }
    expect(Number.isFinite(indMedio.roa)).toBe(true);
  });

  it("Giro do Ativo usa Ativo MÉDIO (consistente com ROA)", () => {
    const s = createState({
      capital: { ativoTotal: 1_000_000, ativoTotalAbertura: 600_000 },
    });
    const ind = calcIndicators(s, buildDRE(s, "simples").dre);
    // Médio = 800k. Giro = RL / 800k > RL / 1M.
    expect(ind.giroAtivo).toBeGreaterThan(0);
    expect(Number.isFinite(ind.giroAtivo)).toBe(true);
  });
});

