// Testes do engine prescritivo — garantem que o card "margem_bruta"
// SEMPRE deriva seu benchmark de `resolveBenchmark(state)`, respeitando
// `ramoAtuacao` e `benchmarkCustom`.
//
// Regra de Ouro auditada (prescriptive.ts §6):
//   mbMin = sectorBench?.margemBruta.p25 ?? FALLBACK_MARGEM_BRUTA[businessType]
//   mbP50 = sectorBench?.margemBruta.p50 ?? mbMin
//   benchmark string: `${label}: P25 X% · mediana Y%`

import { describe, it, expect } from "vitest";
import { buildPrescriptiveCards, type PrescriptiveCard } from "../prescriptive";
import { resolveBenchmark, SECTORS } from "@/engines/benchmark/sectors";
import { createState } from "./helpers";
import type { AppState } from "../types";

function findMB(cards: PrescriptiveCard[]) {
  return cards.find((c) => c.id === "margem_bruta");
}

/** Garante card visível: força benchmarkCustom alto (P25 ≈ 76%). */
function highBarState(overrides: Partial<AppState> = {}): AppState {
  return createState({
    ...overrides,
    benchmarkCustom: { margemBruta: 95 },
  } as Partial<AppState>);
}

describe("prescriptive.ts — benchmark de margem bruta vem de resolveBenchmark", () => {
  it("usa P25/P50 do setor resolvido por ramoAtuacao", () => {
    const sector = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    // P25=60 deve quase sempre estar acima da margem default → card aparece.
    const state = createState({ ramoAtuacao: sector.id } as Partial<AppState>);
    const bench = resolveBenchmark(state);
    expect(bench?.id).toBe(sector.id);

    const card = findMB(buildPrescriptiveCards(state));
    if (!card) {
      // Se margem real ≥ P25, é correto NÃO ter card; nada a validar.
      return;
    }
    expect(card.benchmark).toContain(sector.label);
    expect(card.benchmark).toContain(`P25 ${sector.margemBruta.p25.toFixed(1)}%`);
    expect(card.benchmark).toContain(`mediana ${sector.margemBruta.p50.toFixed(1)}%`);
  });

  it("muda o benchmark do card quando ramoAtuacao muda", () => {
    const a = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    const b = SECTORS.find((s) => s.id === "serv-consultoria")!;
    const sA = createState({ ramoAtuacao: a.id, benchmarkCustom: { margemBruta: 99 } } as Partial<AppState>);
    const sB = createState({ ramoAtuacao: b.id, benchmarkCustom: { margemBruta: 99 } } as Partial<AppState>);

    // benchmarkCustom domina; portanto label deve sinalizar "(personalizado)"
    // PORÉM o setor base muda → label começa com o nome do setor escolhido.
    const cardA = findMB(buildPrescriptiveCards(sA))!;
    const cardB = findMB(buildPrescriptiveCards(sB))!;
    expect(cardA).toBeDefined();
    expect(cardB).toBeDefined();
    expect(cardA.benchmark).toContain(a.label);
    expect(cardB.benchmark).toContain(b.label);
    expect(cardA.benchmark).not.toEqual(cardB.benchmark);
  });

  it("benchmarkCustom.margemBruta sobrescreve P25/P50 (±20%)", () => {
    const state = highBarState();
    const bench = resolveBenchmark(state)!;
    // P50 custom = 95 → P25 = 76, P75 = 114 (±20%)
    expect(bench.margemBruta.p50).toBe(95);
    expect(bench.margemBruta.p25).toBeCloseTo(76, 2);
    expect(bench.label).toContain("(personalizado)");

    const card = findMB(buildPrescriptiveCards(state))!;
    expect(card).toBeDefined();
    expect(card.benchmark).toContain("(personalizado)");
    expect(card.benchmark).toContain(`P25 ${bench.margemBruta.p25.toFixed(1)}%`);
    expect(card.benchmark).toContain(`mediana ${bench.margemBruta.p50.toFixed(1)}%`);
  });

  it("alterar benchmarkCustom altera o limiar e a string do card", () => {
    const s1 = createState({ benchmarkCustom: { margemBruta: 50 } } as Partial<AppState>);
    const s2 = createState({ benchmarkCustom: { margemBruta: 90 } } as Partial<AppState>);
    const c1 = findMB(buildPrescriptiveCards(s1));
    const c2 = findMB(buildPrescriptiveCards(s2));

    // s2 tem barra muito alta → card precisa existir.
    expect(c2).toBeDefined();
    expect(c2!.benchmark).toContain("P25 72.0%"); // 90 * 0.8
    expect(c2!.benchmark).toContain("mediana 90.0%");

    // Se o card existir em s1, a string deve diferir (P25=40 vs 72).
    if (c1) {
      expect(c1.benchmark).not.toEqual(c2!.benchmark);
    }
  });

  it("benchmark do card é EXATAMENTE consistente com resolveBenchmark(state)", () => {
    const state = highBarState({ ramoAtuacao: "serv-consultoria" } as Partial<AppState>);
    const bench = resolveBenchmark(state)!;
    const card = findMB(buildPrescriptiveCards(state))!;
    const expected = `${bench.label}: P25 ${bench.margemBruta.p25.toFixed(1)}% · mediana ${bench.margemBruta.p50.toFixed(1)}%`;
    expect(card.benchmark).toBe(expected);
  });
});
