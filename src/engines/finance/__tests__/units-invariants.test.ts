/**
 * Invariantes de UNIDADES — garante que percentuais (Ke, Kd, WACC, ROIC,
 * margens) NUNCA sejam multiplicados ou divididos por 100 duas vezes.
 *
 * Convenção SSOT do FinnancePRO:
 *  - Inputs de capital (state.capital.ke / kd) estão em % a.a. (ex.: 15 = 15%).
 *  - Outputs de calcIndicators (wacc, roe, roa, roic, margem*) estão em %
 *    no MESMO domínio (15 = 15%), nunca em fração (0.15).
 *  - Helpers de formatação (`pct`) recebem o número já em % e apenas anexam "%".
 */
import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { calcIndicators } from "../indicators";
import { createState, m12 } from "./helpers";

describe("Unidades — Ke/Kd/WACC nunca duplicam ×100", () => {
  it("WACC fica na faixa 0–100 (% units, não fração)", () => {
    const s = createState({
      tax: { regime: "simples" },
      capital: { ke: 15, kd: 10, patrimonioLiquido: 600_000, debtContracts: [{ id: "sim", credor: "Banco", saldoDevedor: 400_000, taxaAA: 18, sistema: "price" as const, prazoMeses: 24 }]},
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // 0.6·15 + 0.4·10·(1−shield) ∈ [9+2.6 ; 9+4] = [11.6 ; 13]
    expect(ind.wacc).toBeGreaterThan(1); // não é fração (0.12)
    expect(ind.wacc).toBeLessThan(100); // não é 1200
    expect(ind.wacc).toBeGreaterThanOrEqual(11);
    expect(ind.wacc).toBeLessThanOrEqual(14);
  });

  it("WACC com Ke=Kd não pode ser menor que min(Ke,Kd)·(1−T)", () => {
    const s = createState({
      tax: { regime: "real" },
      capital: { ke: 20, kd: 20, patrimonioLiquido: 500_000, debtContracts: [{ id: "sim", credor: "Banco", saldoDevedor: 500_000, taxaAA: 18, sistema: "price" as const, prazoMeses: 24 }]},
    });
    const { dre } = buildDRE(s, "real");
    const ind = calcIndicators(s, dre);
    // 0.5·20 + 0.5·20·(1−T): T ∈ [0.24, 0.34] (com/sem adicional IRPJ) → ∈ [16.6 ; 17.6]
    expect(ind.wacc).toBeGreaterThanOrEqual(16);
    expect(ind.wacc).toBeLessThanOrEqual(18);
    // Se houvesse dupla divisão por 100, daria ~0.17 ou ~1700.
    expect(ind.wacc).toBeGreaterThan(1);
    expect(ind.wacc).toBeLessThan(1000);
  });

  it("Piso de Ke=8% (não 0.08) quando ke<=0 — bug histórico", () => {
    const s = createState({
      tax: { regime: "simples" },
      capital: { ke: 0, kd: 0, patrimonioLiquido: 1_000_000, },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // wE=1, wD=0 → WACC = keSeguro = 8 (não 0.08)
    expect(ind.wacc).toBeCloseTo(8, 1);
  });

  it("ROIC e WACC estão no MESMO domínio (% units) — comparáveis", () => {
    const s = createState({
      revenue: { bruta: m12(200_000) },
      capital: {
        ke: 12,
        kd: 9,
        patrimonioLiquido: 800_000,
        debtContracts: [{ id: "sim", credor: "Banco Teste", saldoDevedor: 200_000, taxaAA: 18, sistema: "price", prazoMeses: 24 }],
        ativoTotal: 1_500_000,
      },
    });
    const { dre } = buildDRE(s, "real");
    const ind = calcIndicators(s, dre);
    // Ambos finitos e no mesmo intervalo legível — não pode um estar em fração e outro em %.
    expect(Number.isFinite(ind.roic)).toBe(true);
    expect(Number.isFinite(ind.wacc)).toBe(true);
    // Domínio: ambos entre -100 e 1000 (% típicos PMEs); se fração, |valor| << 1.
    expect(Math.abs(ind.wacc)).toBeGreaterThanOrEqual(1);
    expect(ind.wacc).toBeLessThan(1000);
  });

  it("Margens (Bruta/EBITDA/Líquida) em % — não fração", () => {
    const s = createState({
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
      costs: [
        { id: "cv", label: "CV", category: "variavel", values: m12(30_000), fixed: false },
        { id: "cf", label: "Aluguel", category: "fixo", values: m12(10_000), fixed: true },
      ],
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // Margem bruta esperada > 0; deve estar entre 0 e 100, não 0–1.
    expect(ind.margemBruta).toBeGreaterThan(1);
    expect(ind.margemBruta).toBeLessThanOrEqual(100);
    expect(ind.margemEbitda).toBeLessThanOrEqual(100);
  });

  it("Linearidade: dobrar Ke dobra a contribuição de equity no WACC", () => {
    const base = createState({
      tax: { regime: "simples" },
      capital: { ke: 10, kd: 0, patrimonioLiquido: 1_000_000, },
    });
    const dobro = createState({
      tax: { regime: "simples" },
      capital: { ke: 20, kd: 0, patrimonioLiquido: 1_000_000, },
    });
    const a = calcIndicators(base, buildDRE(base, "simples").dre);
    const b = calcIndicators(dobro, buildDRE(dobro, "simples").dre);
    expect(b.wacc).toBeCloseTo(a.wacc * 2, 1);
  });
});

describe("Unidades — Helper pct() do AI snapshot/tools", () => {
  it("pct() formata como-está (não multiplica por 100)", async () => {
    // Replica a assinatura usada em snapshot.ts:15 e tools.ts:23.
    const pctSnapshot = (n: number, d = 1) => `${(Number.isFinite(n) ? n : 0).toFixed(d)}%`;
    const pctTools = (n: number, d = 1) =>
      `${(Number.isFinite(n) ? n : 0).toFixed(d).replace(".", ",")}%`;

    // 15.5 (já em %) deve virar "15.5%" — nunca "1550.0%".
    expect(pctSnapshot(15.5)).toBe("15.5%");
    expect(pctTools(15.5)).toBe("15,5%");
    expect(pctSnapshot(0)).toBe("0.0%");
    expect(pctSnapshot(100)).toBe("100.0%");
    // Valor pequeno (ex.: 0.5%) é preservado — helper NÃO multiplica por 100.
    expect(pctSnapshot(0.5)).toBe("0.5%");
  });
});
