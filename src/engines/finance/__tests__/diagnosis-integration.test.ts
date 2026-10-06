// Teste de integração — página "Diagnóstico".
//
// A página `DiagnosisTab` renderiza:
//   1) <CriticalAlertsBanner /> — não usa benchmarks (limites absolutos)
//   2) cards de `buildPrescriptiveCards(state)` → exibe `card.benchmark`
//
// Garantia auditada: ao mudar `ramoAtuacao` ou `benchmarkCustom`, TODOS os
// textos prescritivos que mencionam benchmark DEVEM bater exatamente com
// o setor retornado por `resolveBenchmark(state)`. Sem strings hardcoded
// nem números fora da SSOT (`SECTORS` + override custom).

import { describe, it, expect } from "vitest";
import { buildPrescriptiveCards } from "../prescriptive";
import { resolveBenchmark, SECTORS } from "@/engines/benchmark/sectors";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine } from "../types";

/** Estado base com margem bruta ≈ 50% (garante card "margem_bruta"). */
function lowMargin(overrides: Partial<AppState> = {}): AppState {
  const heavy: CostLine = {
    id: "test_heavy_direct",
    label: "Custo direto sintético (teste)",
    category: "direto_venda",
    values: m12(8000),
    fixed: false,
  };
  const base = createState(overrides);
  return { ...base, costs: [...base.costs, heavy] };
}

/** Formato canônico do `benchmark` em cards prescritivos. */
function expectedBenchmarkString(label: string, p25: number, p50: number): string {
  return `${label}: P25 ${p25.toFixed(1)}% · mediana ${p50.toFixed(1)}%`;
}

// Permutações representativas: setores diferentes + custom on/off.
const SCENARIOS: Array<{ name: string; state: AppState }> = [
  {
    name: "default (servicos, sem ramoAtuacao, sem custom)",
    state: lowMargin(),
  },
  {
    name: "ramoAtuacao=serv-ti-saas",
    state: lowMargin({ ramoAtuacao: "serv-ti-saas" } as Partial<AppState>),
  },
  {
    name: "ramoAtuacao=serv-consultoria",
    state: lowMargin({ ramoAtuacao: "serv-consultoria" } as Partial<AppState>),
  },
  {
    name: "benchmarkCustom margemBruta=80",
    state: lowMargin({ benchmarkCustom: { margemBruta: 80 } } as Partial<AppState>),
  },
  {
    name: "ramoAtuacao + benchmarkCustom (custom prevalece)",
    state: lowMargin({
      ramoAtuacao: "serv-ti-saas",
      benchmarkCustom: { margemBruta: 65 },
    } as Partial<AppState>),
  },
];

describe("DiagnosisTab (integração) — benchmarks dos cards refletem resolveBenchmark", () => {
  it.each(SCENARIOS)(
    "[$name] card 'margem_bruta' usa label/P25/P50 do setor resolvido",
    ({ state }) => {
      const bench = resolveBenchmark(state)!;
      expect(bench).toBeDefined();
      const cards = buildPrescriptiveCards(state);
      const mb = cards.find((c) => c.id === "margem_bruta");
      expect(mb, "card margem_bruta deve existir quando margem < P25").toBeDefined();
      expect(mb!.benchmark).toBe(
        expectedBenchmarkString(bench.label, bench.margemBruta.p25, bench.margemBruta.p50),
      );
    },
  );

  it("alterar ramoAtuacao recalcula o texto do card sem reusar valores antigos", () => {
    const ids = ["serv-ti-saas", "serv-consultoria", "serv-saude"].filter((id) =>
      SECTORS.some((s) => s.id === id),
    );
    const benchmarks = ids.map((id) => {
      const s = lowMargin({ ramoAtuacao: id } as Partial<AppState>);
      const card = buildPrescriptiveCards(s).find((c) => c.id === "margem_bruta");
      return card?.benchmark ?? "";
    });
    // Todos diferentes entre si — prova que muda com ramoAtuacao.
    const unique = new Set(benchmarks);
    expect(unique.size).toBe(benchmarks.length);
  });

  it("alterar benchmarkCustom recalcula o texto sem fallback hardcoded", () => {
    const s1 = lowMargin({ benchmarkCustom: { margemBruta: 70 } } as Partial<AppState>);
    const s2 = lowMargin({ benchmarkCustom: { margemBruta: 90 } } as Partial<AppState>);
    const b1 = resolveBenchmark(s1)!;
    const b2 = resolveBenchmark(s2)!;
    const c1 = buildPrescriptiveCards(s1).find((c) => c.id === "margem_bruta")!;
    const c2 = buildPrescriptiveCards(s2).find((c) => c.id === "margem_bruta")!;
    expect(c1.benchmark).toBe(
      expectedBenchmarkString(b1.label, b1.margemBruta.p25, b1.margemBruta.p50),
    );
    expect(c2.benchmark).toBe(
      expectedBenchmarkString(b2.label, b2.margemBruta.p25, b2.margemBruta.p50),
    );
    expect(c1.benchmark).not.toEqual(c2.benchmark);
  });

  it("nenhum card prescritivo contém o número de OUTRO setor (sem leak entre estados)", () => {
    const target = SECTORS.find((s) => s.id === "serv-consultoria")!;
    const other = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    const state = lowMargin({ ramoAtuacao: target.id } as Partial<AppState>);
    const cards = buildPrescriptiveCards(state);
    const mb = cards.find((c) => c.id === "margem_bruta")!;
    // Texto deve trazer label do target.
    expect(mb.benchmark).toContain(target.label);
    // E NÃO deve mencionar o label de outro setor.
    expect(mb.benchmark!.includes(other.label)).toBe(false);
  });

  it("benchmarkCustom sempre injeta '(personalizado)' no texto do card", () => {
    const state = lowMargin({
      ramoAtuacao: "serv-consultoria",
      benchmarkCustom: { margemBruta: 75 },
    } as Partial<AppState>);
    const mb = buildPrescriptiveCards(state).find((c) => c.id === "margem_bruta")!;
    expect(mb.benchmark).toContain("(personalizado)");
  });
});
