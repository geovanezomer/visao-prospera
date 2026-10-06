// Testes do engine prescritivo — garantem que o card "margem_bruta"
// SEMPRE deriva seu benchmark de `resolveBenchmark(state)`, respeitando
// `ramoAtuacao` e `benchmarkCustom`.
//
// Regra de Ouro auditada (prescriptive.ts §6):
//   mbMin = sectorBench?.margemBruta.p25 ?? FALLBACK_MARGEM_BRUTA[businessType]
//   mbP50 = sectorBench?.margemBruta.p50 ?? mbMin
//   benchmark string: `${label}: P25 X.X% · mediana Y.Y%`

import { describe, it, expect } from "vitest";
import { buildPrescriptiveCards, type PrescriptiveCard } from "../prescriptive";
import { resolveBenchmark, SECTORS } from "@/engines/benchmark/sectors";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine } from "../types";

function findMB(cards: PrescriptiveCard[]) {
  return cards.find((c) => c.id === "margem_bruta");
}

/**
 * Estado base com custo direto pesado o suficiente para puxar a margem
 * bruta a ~50% — garantindo que QUALQUER benchmarkCustom ≥ 65% dispare
 * o card "margem_bruta".
 */
function stateWithLowGrossMargin(overrides: Partial<AppState> = {}): AppState {
  const heavyCost: CostLine = {
    id: "test_heavy_direct",
    label: "Custo direto sintético (teste)",
    category: "direto_venda",
    values: m12(8000), // ~96k/ano vs receita ~193k/ano → margem ~50%
    fixed: false,
  };
  const base = createState(overrides);
  return { ...base, costs: [...base.costs, heavyCost] };
}

describe("prescriptive.ts — benchmark de margem bruta vem de resolveBenchmark", () => {
  it("usa P25/P50 do setor resolvido por ramoAtuacao", () => {
    const sector = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    const state = stateWithLowGrossMargin({ ramoAtuacao: sector.id } as Partial<AppState>);
    const bench = resolveBenchmark(state)!;
    expect(bench.id).toBe(sector.id);

    const card = findMB(buildPrescriptiveCards(state))!;
    expect(card).toBeDefined();
    expect(card.benchmark).toContain(sector.label);
    expect(card.benchmark).toContain(`P25 ${sector.margemBruta.p25.toFixed(1)}%`);
    expect(card.benchmark).toContain(`mediana ${sector.margemBruta.p50.toFixed(1)}%`);
  });

  it("muda o benchmark do card quando ramoAtuacao muda", () => {
    const a = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    const b = SECTORS.find((s) => s.id === "serv-consultoria")!;
    const sA = stateWithLowGrossMargin({ ramoAtuacao: a.id } as Partial<AppState>);
    const sB = stateWithLowGrossMargin({ ramoAtuacao: b.id } as Partial<AppState>);

    const cardA = findMB(buildPrescriptiveCards(sA))!;
    const cardB = findMB(buildPrescriptiveCards(sB))!;
    expect(cardA.benchmark).toContain(a.label);
    expect(cardB.benchmark).toContain(b.label);
    expect(cardA.benchmark).not.toEqual(cardB.benchmark);
  });

  it("benchmarkCustom.margemBruta sobrescreve P25/P50 (±20%)", () => {
    const state = stateWithLowGrossMargin({
      benchmarkCustom: { margemBruta: 90 },
    } as Partial<AppState>);
    const bench = resolveBenchmark(state)!;
    expect(bench.margemBruta.p50).toBe(90);
    expect(bench.margemBruta.p25).toBeCloseTo(72, 2);
    expect(bench.label).toContain("(personalizado)");

    const card = findMB(buildPrescriptiveCards(state))!;
    expect(card).toBeDefined();
    expect(card.benchmark).toContain("(personalizado)");
    expect(card.benchmark).toContain("P25 72.0%");
    expect(card.benchmark).toContain("mediana 90.0%");
  });

  it("alterar benchmarkCustom altera a string do card", () => {
    const s1 = stateWithLowGrossMargin({
      benchmarkCustom: { margemBruta: 70 },
    } as Partial<AppState>);
    const s2 = stateWithLowGrossMargin({
      benchmarkCustom: { margemBruta: 90 },
    } as Partial<AppState>);
    const c1 = findMB(buildPrescriptiveCards(s1))!;
    const c2 = findMB(buildPrescriptiveCards(s2))!;
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1.benchmark).toContain("P25 56.0%"); // 70 * 0.8
    expect(c2.benchmark).toContain("P25 72.0%"); // 90 * 0.8
    expect(c1.benchmark).not.toEqual(c2.benchmark);
  });

  it("benchmark do card é EXATAMENTE consistente com resolveBenchmark(state)", () => {
    const state = stateWithLowGrossMargin({
      ramoAtuacao: "serv-consultoria",
      benchmarkCustom: { margemBruta: 80 },
    } as Partial<AppState>);
    const bench = resolveBenchmark(state)!;
    const card = findMB(buildPrescriptiveCards(state))!;
    const expected = `${bench.label}: P25 ${bench.margemBruta.p25.toFixed(1)}% · mediana ${bench.margemBruta.p50.toFixed(1)}%`;
    expect(card.benchmark).toBe(expected);
  });

  it("benchmarkCustom tem precedência sobre ramoAtuacao (label sinaliza 'personalizado')", () => {
    const state = stateWithLowGrossMargin({
      ramoAtuacao: "serv-ti-saas",
      benchmarkCustom: { margemBruta: 85 },
    } as Partial<AppState>);
    const card = findMB(buildPrescriptiveCards(state))!;
    expect(card.benchmark).toContain("(personalizado)");
    expect(card.benchmark).toContain("P25 68.0%"); // 85 * 0.8
    expect(card.benchmark).toContain("mediana 85.0%");
  });
});
