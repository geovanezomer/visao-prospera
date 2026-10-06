// Cartão "folha alta": números iguais aos do motor (folha com encargos) e
// posições CLT sem pró-labore, PJ ou linhas que só lembram "mod" no nome.
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { buildPrescriptiveCards } from "../prescriptive";
import { getFinancialModelCached } from "../financialModel";
import { laborCltLinesTotal, severanceCostPerPosition } from "../levers/primitives";
import { effectiveMonthValues } from "../costs";
import { folhaAnual, resolveEffectiveRegime } from "../regime";
import { fmtBRL, sum } from "../format";
import type { AppState, CostLine } from "../types";

const linha = (id: string, label: string, v: number, extra: Partial<CostLine> = {}): CostLine => ({
  id,
  label,
  category: "despesa_administrativa",
  values: Array(12).fill(v),
  fixed: false,
  ...extra,
});

function estado(): AppState {
  const s = createState();
  return {
    ...s,
    costs: [
      linha("a", "Salário analista", 3_000, { encargosAuto: true }),
      linha("b", "Salário assistente", 2_000, { encargosAuto: true }),
      linha("p", "Pró-labore sócio", 5_000),
      linha("t", "Terceirização de TI (PJ)", 4_000),
      linha("c", "Comodato de equipamentos", 1_000),
      linha("z", "Salário vaga em aberto", 0, { encargosAuto: true }),
    ],
  };
}

describe("laborCltLinesTotal", () => {
  it("conta só as posições CLT, com encargos como a DRE", () => {
    const s = estado();
    const r = laborCltLinesTotal(s);
    expect(r.lines.map((l) => l.id).sort()).toEqual(["a", "b", "z"]);
    expect(r.posicoes).toBe(2); // a vaga zerada não é posição
    expect(r.baseMensal).toBeCloseTo(5_000, 6);
    const regime = resolveEffectiveRegime(s);
    const esperado =
      (sum(effectiveMonthValues(s.costs[0], regime, { simplesAnexo: s.tax.simplesAnexo })) +
        sum(effectiveMonthValues(s.costs[1], regime, { simplesAnexo: s.tax.simplesAnexo }))) /
      12;
    expect(r.totalMensal).toBeCloseTo(esperado, 6);
    expect(r.totalMensal).toBeGreaterThan(r.baseMensal);
  });
});

describe("cartão folha alta", () => {
  it("cita a folha do motor e desliga com salário e encargos reais", () => {
    const s = estado();
    const model = getFinancialModelCached(s);
    const cards = buildPrescriptiveCards(s, {
      dre: model.dre,
      tax: model.tax,
      ind: model.ind,
      cf: model.cf,
    } as never);
    const c = cards.find((x) => x.id === "folha_alta");
    expect(c, "a folha do exemplo passa do benchmark").toBeDefined();
    expect(c!.cause).toContain(fmtBRL(folhaAnual(s) / 12));

    const clt = laborCltLinesTotal(s);
    const salarioMedio = 2_500;
    const dem = c!.actions.find((a) => a.id === "dismiss_2_severance")!;
    expect(dem.detail).toContain(fmtBRL(severanceCostPerPosition(salarioMedio) * 2));
    const depois = laborCltLinesTotal(dem.apply(s));
    // Duas posições médias saem com encargos: corte = 2 × custo médio.
    expect(clt.totalMensal - depois.totalMensal).toBeCloseTo((2 * clt.totalMensal) / 2, 4);
    // Pró-labore, PJ e comodato não são tocados.
    const after = dem.apply(s).costs;
    for (const id of ["p", "t", "c"])
      expect(after.find((l) => l.id === id)!.values[0]).toBe(
        s.costs.find((l) => l.id === id)!.values[0],
      );
  });
});
