// Testes do módulo de benchmarks setoriais.
//
// Cobre:
//   1) resolveBenchmark — precedência (benchmarkCustom > ramoAtuacao > businessType)
//   2) Derivação ±20% (P25 = P50*0.8, P75 = P50*1.2) para TODAS as 8 métricas
//   3) rank() — classificação em quartis para "maior melhor" e "menor melhor"
//   4) Helpers de lookup (getSector / findSector / listSectors)

import { describe, it, expect } from "vitest";
import {
  SECTORS,
  resolveBenchmark,
  rank,
  getSector,
  findSector,
  listSectors,
  type SectorBenchmark,
} from "../sectors";

const METRICS: (keyof Pick<
  SectorBenchmark,
  | "margemBruta"
  | "margemEbitda"
  | "margemLiquida"
  | "giroAtivo"
  | "endividamento"
  | "pmr"
  | "pmp"
  | "evEbitda"
>)[] = [
  "margemBruta",
  "margemEbitda",
  "margemLiquida",
  "giroAtivo",
  "endividamento",
  "pmr",
  "pmp",
  "evEbitda",
];

describe("SECTORS — sanidade da base", () => {
  it("todo setor tem P25 ≤ P50 ≤ P75 em todas as métricas", () => {
    for (const s of SECTORS) {
      for (const m of METRICS) {
        const b = s[m];
        expect(b.p25, `${s.id}.${m}`).toBeLessThanOrEqual(b.p50);
        expect(b.p50, `${s.id}.${m}`).toBeLessThanOrEqual(b.p75);
      }
    }
  });
});

describe("resolveBenchmark — precedência", () => {
  it("retorna undefined quando não há businessType nem ramoAtuacao", () => {
    expect(resolveBenchmark({})).toBeUndefined();
  });

  it("fallback para o primeiro setor do businessType quando não há ramoAtuacao", () => {
    const first = listSectors("servicos")[0];
    const r = resolveBenchmark({ businessType: "servicos" });
    expect(r?.id).toBe(first.id);
  });

  it("usa ramoAtuacao quando fornecido (sobrepondo o primeiro do businessType)", () => {
    const target = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    const r = resolveBenchmark({ businessType: "servicos", ramoAtuacao: target.id });
    expect(r?.id).toBe(target.id);
  });

  it("ramoAtuacao inválido cai no fallback do businessType", () => {
    const first = listSectors("servicos")[0];
    const r = resolveBenchmark({ businessType: "servicos", ramoAtuacao: "id-inexistente" });
    expect(r?.id).toBe(first.id);
  });

  it("benchmarkCustom tem precedência: anexa '(personalizado)' no label", () => {
    const r = resolveBenchmark({
      businessType: "servicos",
      ramoAtuacao: "serv-ti-saas",
      benchmarkCustom: { margemBruta: 70 },
    });
    expect(r?.label).toContain("(personalizado)");
    // Base segue sendo o setor escolhido (id preservado).
    expect(r?.id).toBe("serv-ti-saas");
  });
});

describe("resolveBenchmark — derivação ±20% por métrica", () => {
  it.each(METRICS)("override de %s gera P25=P50*0.8 e P75=P50*1.2", (metric) => {
    const p50 = 50;
    const r = resolveBenchmark({
      businessType: "servicos",
      benchmarkCustom: { [metric]: p50 } as Record<string, number>,
    })!;
    expect(r[metric].p50).toBe(p50);
    expect(r[metric].p25).toBeCloseTo(p50 * 0.8, 2);
    expect(r[metric].p75).toBeCloseTo(p50 * 1.2, 2);
  });

  it("métricas NÃO sobrescritas preservam os valores do setor base", () => {
    const base = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    const r = resolveBenchmark({
      ramoAtuacao: "serv-ti-saas",
      benchmarkCustom: { margemBruta: 88 },
    })!;
    // margemBruta foi sobrescrita
    expect(r.margemBruta.p50).toBe(88);
    // demais métricas inalteradas
    expect(r.margemEbitda).toEqual(base.margemEbitda);
    expect(r.giroAtivo).toEqual(base.giroAtivo);
    expect(r.endividamento).toEqual(base.endividamento);
    expect(r.pmr).toEqual(base.pmr);
    expect(r.pmp).toEqual(base.pmp);
    expect(r.evEbitda).toEqual(base.evEbitda);
  });

  it("benchmarkCustom vazio NÃO altera o setor base", () => {
    const r = resolveBenchmark({
      ramoAtuacao: "serv-ti-saas",
      benchmarkCustom: {},
    })!;
    const base = SECTORS.find((s) => s.id === "serv-ti-saas")!;
    expect(r.label).toBe(base.label); // sem sufixo "(personalizado)"
    for (const m of METRICS) expect(r[m]).toEqual(base[m]);
  });
});

describe("rank() — classificação em quartis", () => {
  const b = { p25: 10, p50: 20, p75: 30 };

  it("maior-melhor: valor < P25 → bottom", () => {
    expect(rank(5, b, true).position).toBe("bottom");
  });
  it("maior-melhor: valor entre P25 e P50 → below-median", () => {
    expect(rank(15, b, true).position).toBe("below-median");
  });
  it("maior-melhor: valor entre P50 e P75 → above-median", () => {
    expect(rank(25, b, true).position).toBe("above-median");
  });
  it("maior-melhor: valor ≥ P75 → top", () => {
    expect(rank(35, b, true).position).toBe("top");
  });

  it("menor-melhor inverte: valor > P75 → bottom", () => {
    expect(rank(35, b, false).position).toBe("bottom");
  });
  it("menor-melhor: valor ≤ P25 → top", () => {
    expect(rank(5, b, false).position).toBe("top");
  });

  it("delta é sempre value - P50", () => {
    expect(rank(25, b, true).delta).toBe(5);
    expect(rank(15, b, false).delta).toBe(-5);
  });
});

describe("helpers de lookup", () => {
  it("getSector encontra por id exato", () => {
    expect(getSector("serv-ti-saas")?.id).toBe("serv-ti-saas");
    expect(getSector("nao-existe")).toBeUndefined();
  });

  it("findSector busca por trecho de label ou id (case-insensitive)", () => {
    expect(findSector("SaaS")?.id).toBe("serv-ti-saas");
    expect(findSector("consultoria")?.businessType).toBe("servicos");
  });

  it("listSectors sem filtro retorna toda a base; com filtro só do tipo", () => {
    expect(listSectors().length).toBe(SECTORS.length);
    const servicos = listSectors("servicos");
    expect(servicos.length).toBeGreaterThan(0);
    expect(servicos.every((s) => s.businessType === "servicos")).toBe(true);
  });
});
