import { describe, expect, it } from "vitest";
import { acoesPrioritarias, buildPrescriptiveCards, type PrescriptiveCard } from "../prescriptive";
import { EXAMPLE_STATE, migrateState } from "../defaults";

const card = (id: string, severity: PrescriptiveCard["severity"], acoes = 1): PrescriptiveCard => ({
  id,
  severity,
  problem: id,
  metricLabel: "m",
  metricValue: "v",
  cause: "c",
  actions: Array.from({ length: acoes }, (_, i) => ({
    id: `${id}${i}`,
    title: "t",
    detail: "d",
    apply: (s) => s,
  })),
});

describe("acoesPrioritarias", () => {
  it("urgentes primeiro, no máximo 3, sem ok/info nem cartão sem ação", () => {
    const r = acoesPrioritarias([
      card("w1", "warn"),
      card("ok", "ok"),
      card("d1", "danger"),
      card("i", "info"),
      card("w2", "warn"),
      card("semAcao", "danger", 0),
      card("w3", "warn"),
    ]);
    expect(r.map((c) => c.id)).toEqual(["d1", "w1", "w2"]);
  });

  it("empresa de exemplo tem ao menos uma ação a mostrar", () => {
    const s = migrateState(EXAMPLE_STATE);
    expect(acoesPrioritarias(buildPrescriptiveCards(s)).length).toBeGreaterThan(0);
  });
});
