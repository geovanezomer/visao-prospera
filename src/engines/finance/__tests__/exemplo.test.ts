// Empresa de exemplo do primeiro acesso: saudável, com pontos claros a
// trabalhar, balanço fechado e indicadores com sentido.
import { describe, expect, it } from "vitest";
import { EXAMPLE_STATE, isExampleState, migrateState, DEFAULT_STATE } from "../defaults";
import { buildFinancialModel } from "../financialModel";
import { deriveAbertura } from "../aberturaDerivada";
import { calcKanitz } from "../kanitz";
import { sum } from "../format";

describe("empresa de exemplo", () => {
  const s = migrateState(EXAMPLE_STATE);
  const m = buildFinancialModel(s);

  it("abertura equilibrada (sem aviso de plug)", () => {
    const d = deriveAbertura({ state: s, impostosTotalMensais: m.dre.impostosTotal });
    expect(d.totals.fechado).toBe(true);
  });

  it("lucrativa, com custo do serviço e nota B ou C", () => {
    expect(sum(m.dre.lucroLiquido)).toBeGreaterThan(0);
    expect(sum(m.dre.cpv)).toBeGreaterThan(0);
    expect(m.ind.margemBruta).toBeLessThan(100);
    expect(["B", "C"]).toContain(m.health.grade);
  });

  it("caixa inicial positivo, liquidez e Kanitz com sentido", () => {
    expect(s.capital.disponibilidades).toBeGreaterThan(0);
    expect(m.ind.liquidezCorrente).toBeGreaterThan(1);
    expect(m.ind.liquidezCorrente).toBeLessThan(99);
    expect(calcKanitz(s, m.ind).baseInsuficiente).toBe(false);
  });

  it("sem linhas duplicadas de frete nem terceirização nas despesas", () => {
    const labels = s.costs.map((c) => c.label.toLowerCase());
    expect(labels.filter((l) => l.includes("frete")).length).toBe(1);
    expect(s.costs.some((c) => c.id === "mod_terc")).toBe(false);
  });

  it("reconhecida como exemplo (nova e antiga)", () => {
    expect(isExampleState(s)).toBe(true);
    expect(isExampleState(migrateState(DEFAULT_STATE))).toBe(true);
    expect(isExampleState({ ...s, companyName: "Acme" })).toBe(false);
  });
});
