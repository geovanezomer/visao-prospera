import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
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
    // Receita Líquida cai (parte vira menos imposto, então a queda é < 6000 mas > 0)
    expect(sum(dreA.receitaLiquida)).toBeGreaterThan(sum(dreB.receitaLiquida));
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

// [Auditoria Bloco 2] Identidades fundamentais da DRE — travam contra regressão.
describe("buildDRE — identidades estruturais (CPC/IFRS)", () => {
  it("Receita Líquida ≡ Bruta − Inadimpl − OutrasDeduções − ImpostosVendas", () => {
    const s = createState({
      revenue: {
        bruta: m12(10000),
        inadimplencia: m12(5),
        inadimplenciaComoPDD: false,
        deducoes: [{ id: "dev", label: "Devoluções", valores: m12(200) }],
      },
      tax: { regime: "presumido" },
    });
    const { dre } = buildDRE(s, "presumido");
    for (let i = 0; i < 12; i++) {
      const esperado =
        dre.receitaBruta[i] -
        dre.deducoesInadimplencia[i] -
        dre.outrasDeducoes[i] -
        dre.impostosVendas[i];
      expect(approx(dre.receitaLiquida[i], esperado)).toBe(true);
    }
  });

  it("Lucro Bruto ≡ Receita Líquida − CPV (mensal)", () => {
    const s = createState({ tax: { regime: "real" } });
    const { dre } = buildDRE(s, "real");
    for (let i = 0; i < 12; i++) {
      expect(approx(dre.lucroBruto[i], dre.receitaLiquida[i] - dre.cpv[i])).toBe(true);
    }
  });

  it("EBIT ≡ EBITDA − Depreciação; LAIR ≡ EBIT + Resultado Financeiro", () => {
    const s = createState({ tax: { regime: "real" } });
    const { dre } = buildDRE(s, "real");
    for (let i = 0; i < 12; i++) {
      expect(approx(dre.ebit[i], dre.ebitda[i] - dre.depreciacao[i])).toBe(true);
      expect(approx(dre.lair[i], dre.ebit[i] + dre.resultadoFinanceiro[i])).toBe(true);
    }
  });

  it("ImpostosTotal ≡ ImpostosVendas + Impostos sobre Lucro", () => {
    const s = createState({ tax: { regime: "presumido" } });
    const { dre } = buildDRE(s, "presumido");
    for (let i = 0; i < 12; i++) {
      expect(approx(dre.impostosTotal[i], dre.impostosVendas[i] + dre.impostos[i])).toBe(true);
    }
  });
});
