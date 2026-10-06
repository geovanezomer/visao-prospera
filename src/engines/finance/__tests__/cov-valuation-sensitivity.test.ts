import { describe, it, expect } from "vitest";
import {
  applyDriver,
  readOutput,
  runSensitivity,
  OUTPUT_OPTIONS,
  type DriverKey,
} from "../sensitivity";
import { buildDRE } from "../dre";
import { buildCashFlow } from "../cashflow";
import { calcIndicators } from "../indicators";
import { resolveEffectiveRegime } from "../regime";
import { sum } from "../format";
import type { CostLine } from "../types";
import { createState, m12 } from "./helpers";

const linha = (
  id: string,
  label: string,
  category: CostLine["category"],
  valor: number,
  extras: Partial<CostLine> = {},
): CostLine => ({ id, label, category, values: m12(valor), fixed: true, ...extras });

// Estrutura de custos sintética: uma linha por categoria, valores distintos
// para que cada driver tenha alvo inequívoco.
const CUSTOS: CostLine[] = [
  linha("cv", "Insumos", "custo_vendas", 10_000),
  linha("dv", "Mercadoria", "direto_venda", 5_000),
  linha("mod", "Salários produção", "custo_vendas", 4_000, { encargosAuto: true }),
  linha("var", "Marketing", "variavel", 2_000),
  linha("com", "Comissões de vendas", "despesa_comercial", 1_000),
  linha("sal", "Salários administrativos", "despesa_administrativa", 8_000, {
    encargosAuto: true,
  }),
  linha("alug", "Aluguel", "fixo", 3_000),
  linha("cont", "Contabilidade", "despesa_administrativa", 1_500),
  linha("fin", "Tarifas bancárias", "financeiro", 500),
];

function estado() {
  return createState({
    revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
    costs: CUSTOS,
  });
}

const valoresDe = (costs: CostLine[], id: string) => costs.find((c) => c.id === id)!.values[0];

describe("applyDriver — alvo correto de cada alavanca (+10%)", () => {
  const s = estado();

  it("preço: receita × 1,10 e nenhum custo muda", () => {
    const r = applyDriver(s, "preco", 10);
    expect(r.revenue.bruta[0]).toBeCloseTo(110_000, 6);
    expect(r.costs).toBe(s.costs);
  });

  it("volume: receita e custos variáveis (CPV, direto, variável, comercial) × 1,10; fixos intactos", () => {
    const r = applyDriver(s, "volume", 10);
    expect(r.revenue.bruta[0]).toBeCloseTo(110_000, 6);
    expect(valoresDe(r.costs, "cv")).toBeCloseTo(11_000, 6);
    expect(valoresDe(r.costs, "dv")).toBeCloseTo(5_500, 6);
    expect(valoresDe(r.costs, "mod")).toBeCloseTo(4_400, 6);
    expect(valoresDe(r.costs, "var")).toBeCloseTo(2_200, 6);
    expect(valoresDe(r.costs, "com")).toBeCloseTo(1_100, 6);
    expect(valoresDe(r.costs, "sal")).toBe(8_000);
    expect(valoresDe(r.costs, "alug")).toBe(3_000);
    expect(valoresDe(r.costs, "fin")).toBe(500);
  });

  it("CPV: só custo_vendas e direto_venda", () => {
    const r = applyDriver(s, "cpv", 10);
    expect(r.revenue.bruta).toBe(s.revenue.bruta);
    expect(valoresDe(r.costs, "cv")).toBeCloseTo(11_000, 6);
    expect(valoresDe(r.costs, "dv")).toBeCloseTo(5_500, 6);
    expect(valoresDe(r.costs, "mod")).toBeCloseTo(4_400, 6);
    expect(valoresDe(r.costs, "var")).toBe(2_000);
    expect(valoresDe(r.costs, "sal")).toBe(8_000);
  });

  it("folha: só linhas de pessoal (inclusive MOD no CPV), comissão não é folha", () => {
    const r = applyDriver(s, "folha", 10);
    expect(valoresDe(r.costs, "sal")).toBeCloseTo(8_800, 6);
    expect(valoresDe(r.costs, "mod")).toBeCloseTo(4_400, 6);
    expect(valoresDe(r.costs, "com")).toBe(1_000);
    expect(valoresDe(r.costs, "cv")).toBe(10_000);
  });

  it("fixos: fixo + administrativo não-folha", () => {
    const r = applyDriver(s, "fixos", 10);
    expect(valoresDe(r.costs, "alug")).toBeCloseTo(3_300, 6);
    expect(valoresDe(r.costs, "cont")).toBeCloseTo(1_650, 6);
    expect(valoresDe(r.costs, "sal")).toBe(8_000);
  });

  it("juros: só categoria financeiro", () => {
    const r = applyDriver(s, "juros", -10);
    expect(valoresDe(r.costs, "fin")).toBeCloseTo(450, 6);
    expect(valoresDe(r.costs, "alug")).toBe(3_000);
  });

  it("não muta o estado original", () => {
    applyDriver(s, "volume", 50);
    expect(s.revenue.bruta[0]).toBe(100_000);
    expect(valoresDe(s.costs, "cv")).toBe(10_000);
  });
});

describe("readOutput — SSOT com DRE / fluxo / indicadores", () => {
  const s = estado();
  const regime = resolveEffectiveRegime(s);
  const { dre } = buildDRE(s, regime);
  const cf = buildCashFlow(s);

  it("EBITDA e Lucro Líquido = soma anual da DRE", () => {
    expect(readOutput(s, "ebitda")).toBeCloseTo(sum(dre.ebitda), 6);
    expect(readOutput(s, "lucroLiquido")).toBeCloseTo(sum(dre.lucroLiquido), 6);
  });
  it("Saldo de caixa = saldo final do fluxo; ROIC = indicadores", () => {
    expect(readOutput(s, "saldoCaixa")).toBeCloseTo(cf.totais.saldoFinal, 6);
    expect(readOutput(s, "roic")).toBeCloseTo(calcIndicators(s, dre, cf).roic, 6);
  });

  it("CPV +10% reduz o EBITDA exatamente em 10% do CPV não-folha (Simples: DAS não depende de CPV)", () => {
    const s2 = createState({
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
      costs: CUSTOS.filter((c) => c.id !== "mod"),
    });
    const base = readOutput(s2, "ebitda");
    const choque = readOutput(applyDriver(s2, "cpv", 10), "ebitda");
    // ΔEBITDA = −10% × (10.000 + 5.000) × 12 = −18.000
    expect(choque - base).toBeCloseTo(-18_000, 2);
  });

  it("Juros não afetam EBITDA (despesa financeira fica abaixo do EBITDA)", () => {
    expect(readOutput(applyDriver(s, "juros", 15), "ebitda")).toBeCloseTo(
      readOutput(s, "ebitda"),
      6,
    );
  });
});

describe("runSensitivity — tabela univariada e elasticidade", () => {
  const s = estado();

  it("baseline, deltas padrão e fórmula de pctChange/elasticidade", () => {
    const r = runSensitivity(s, "ebitda");
    expect(r.output).toBe("ebitda");
    expect(r.outputLabel).toBe("EBITDA");
    expect(r.deltas).toEqual([-15, -10, -5, 5, 10, 15]);
    expect(r.baseline).toBeCloseTo(readOutput(s, "ebitda"), 6);
    expect(r.rows).toHaveLength(6);
    for (const row of r.rows) {
      expect(row.baseline).toBe(r.baseline);
      expect(row.cells.map((c) => c.deltaPct)).toEqual(r.deltas);
      for (const c of row.cells) {
        // pctChange = (v − base) / |base| × 100
        expect(c.pctChange).toBeCloseTo(((c.value - r.baseline) / Math.abs(r.baseline)) * 100, 8);
      }
      // elasticidade = média de (pctChange / deltaPct)
      const esperado =
        row.cells.map((c) => c.pctChange / c.deltaPct).reduce((a, b) => a + b, 0) /
        row.cells.length;
      expect(row.elasticity).toBeCloseTo(esperado, 10);
    }
  });

  it("linhas ordenadas por |elasticidade| decrescente; juros = 0 no EBITDA", () => {
    const r = runSensitivity(s, "ebitda");
    for (let i = 1; i < r.rows.length; i++) {
      expect(Math.abs(r.rows[i - 1].elasticity)).toBeGreaterThanOrEqual(
        Math.abs(r.rows[i].elasticity),
      );
    }
    const juros = r.rows.find((x) => x.driver === "juros")!;
    expect(juros.elasticity).toBeCloseTo(0, 10);
    expect(juros.label).toBe("Despesas Financeiras");
    // Preço tem elasticidade positiva e maior que volume (volume também puxa custo variável)
    const preco = r.rows.find((x) => x.driver === "preco")!;
    const volume = r.rows.find((x) => x.driver === "volume")!;
    expect(preco.elasticity).toBeGreaterThan(volume.elasticity);
    expect(volume.elasticity).toBeGreaterThan(0);
    // Custos têm elasticidade negativa
    for (const d of ["cpv", "folha", "fixos"] as DriverKey[]) {
      expect(r.rows.find((x) => x.driver === d)!.elasticity).toBeLessThan(0);
    }
  });

  it("subconjunto de drivers e outputs alternativos", () => {
    const r = runSensitivity(s, "lucroLiquido", ["juros"]);
    expect(r.rows).toHaveLength(1);
    expect(r.outputLabel).toBe("Lucro Líquido");
    // +15% em despesas financeiras reduz o lucro
    const c15 = r.rows[0].cells.find((c) => c.deltaPct === 15)!;
    expect(c15.value).toBeLessThan(r.baseline);
    expect(runSensitivity(s, "saldoCaixa", ["preco"]).outputLabel).toBe("Saldo de Caixa (Dez)");
    expect(runSensitivity(s, "roic", ["preco"]).outputLabel).toBe("ROIC (%)");
  });

  it("baseline zero → pctChange e elasticidade = 0 (sem divisão por zero)", () => {
    const zero = createState({
      revenue: { bruta: m12(0), inadimplencia: m12(0) },
      costs: [linha("fin", "Tarifas bancárias", "financeiro", 500)],
    });
    expect(readOutput(zero, "ebitda")).toBe(0);
    const r = runSensitivity(zero, "ebitda", ["juros", "preco"]);
    for (const row of r.rows) {
      expect(row.elasticity).toBe(0);
      for (const c of row.cells) expect(c.pctChange).toBe(0);
    }
  });

  it("OUTPUT_OPTIONS lista os 4 outputs", () => {
    expect(OUTPUT_OPTIONS.map((o) => o.value)).toEqual([
      "ebitda",
      "lucroLiquido",
      "saldoCaixa",
      "roic",
    ]);
  });
});
