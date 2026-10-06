/**
 * Projeção ano a ano da reforma: em 2026 a CBS/IBS de teste é compensada
 * com PIS/COFINS (LC 214/2025, art. 343) — a carga é a do sistema atual.
 */
import { describe, expect, it } from "vitest";
import { compareYearsForRegime, compareErasForRegime } from "../tax/compare";
import { DEFAULT_STATE } from "../defaults";
import type { AppState } from "../types";

const state: AppState = { ...DEFAULT_STATE, tax: { ...DEFAULT_STATE.tax, regime: "presumido" } };

describe("compareYearsForRegime — 2026", () => {
  it("2026 tem a mesma carga do sistema atual (PIS/COFINS não somem)", () => {
    const [y2026] = compareYearsForRegime(state, "presumido", [2026]);
    const atual = compareErasForRegime(state, "presumido").find((e) => e.era === "atual")!;
    expect(y2026.annual).toBeCloseTo(atual.annual, 2);
    expect(y2026.rates.pisCofinsMult).toBe(1);
    expect(y2026.rates.compensavelComPisCofinsPct).toBeCloseTo(1.0, 5);
  });

  it("2027 já reflete a CBS plena e a extinção de PIS/COFINS", () => {
    const [y2026, y2027] = compareYearsForRegime(state, "presumido", [2026, 2027]);
    expect(y2027.rates.pisCofinsMult).toBe(0);
    expect(y2027.rates.cbsPct).toBeGreaterThan(y2026.rates.cbsPct);
    expect(y2027.annual).not.toBeCloseTo(y2026.annual, 0);
  });
});
