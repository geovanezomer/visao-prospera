import { describe, it, expect } from "vitest";
import { buildDRE } from "../calculations";
import { sum } from "../format";
import { createState, m12 } from "./helpers";

const approx = (a: number, b: number, tol = 0.01) =>
  Math.abs(a - b) / Math.max(1, Math.abs(b)) <= tol;

describe("buildDRE — Simples Nacional (default)", () => {
  it("Receita Bruta anual = soma dos 12 meses informados", () => {
    const s = createState({ revenue: { bruta: m12(10000) } });
    const { dre } = buildDRE(s, "simples");
    expect(sum(dre.receitaBruta)).toBe(120000);
  });

  it("Inadimplência como dedução reduz Receita Líquida e NÃO gera PDD", () => {
    const s = createState({
      revenue: { bruta: m12(10000), inadimplencia: m12(10), inadimplenciaComoPDD: false },
    });
    const { dre } = buildDRE(s, "simples");
    expect(sum(dre.deducoesInadimplencia)).toBeCloseTo(12000, 2); // 10% de 120k
    expect(sum(dre.pdd)).toBe(0);
  });

  it("Inadimplência como PDD vira despesa operacional, NÃO dedução", () => {
    const s = createState({
      revenue: { bruta: m12(10000), inadimplencia: m12(10), inadimplenciaComoPDD: true },
    });
    const { dre } = buildDRE(s, "simples");
    expect(sum(dre.deducoesInadimplencia)).toBe(0);
    expect(sum(dre.pdd)).toBeCloseTo(12000, 2);
  });

  it("Outras deduções (devoluções) reduzem Receita Líquida e a base de impostos", () => {
    const semDed = createState({ revenue: { bruta: m12(10000) } });
    const comDed = createState({
      revenue: {
        bruta: m12(10000),
        deducoes: [{ id: "dev", label: "Devoluções", valores: m12(500) }],
      },
    });
    const dreA = buildDRE(semDed, "simples").dre;
    const dreB = buildDRE(comDed, "simples").dre;
    expect(sum(dreB.outrasDeducoes)).toBeCloseTo(6000, 2);
    // Receita Líquida cai pelo menos o valor das deduções
    expect(sum(dreA.receitaLiquida) - sum(dreB.receitaLiquida)).toBeGreaterThanOrEqual(6000 - 1);
    // Impostos sobre venda também caem (base menor no Simples)
    expect(sum(dreB.impostosVendas)).toBeLessThan(sum(dreA.impostosVendas));
  });
});

describe("buildDRE — Lucro Real", () => {
  it("LL = LAIR − IRPJ/CSLL quando há lucro", () => {
    const s = createState({ tax: { regime: "real" } });
    const { dre } = buildDRE(s, "real");
    const lairAnual = sum(dre.lair);
    const llAnual = sum(dre.lucroLiquido);
    const impAnual = sum(dre.impostos);
    expect(approx(llAnual, lairAnual - impAnual)).toBe(true);
  });

  it("Sem lucro, não há IRPJ/CSLL", () => {
    // Estoura custos para garantir prejuízo
    const s = createState({
      revenue: { bruta: m12(1000) },
      tax: { regime: "real" },
    });
    const { dre } = buildDRE(s, "real");
    expect(sum(dre.impostos)).toBe(0);
  });
});

describe("buildDRE — Lucro Presumido", () => {
  it("Impostos sobre venda > 0 (PIS/COFINS/ISS ou ICMS) com receita > 0", () => {
    const s = createState({ tax: { regime: "presumido" } });
    const { dre } = buildDRE(s, "presumido");
    expect(sum(dre.impostosVendas)).toBeGreaterThan(0);
  });
});
