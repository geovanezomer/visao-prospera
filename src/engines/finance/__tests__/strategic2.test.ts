import { describe, expect, it } from "vitest";
import { createState, m12 } from "./helpers";
import { DEFAULT_SIM } from "../simulator";
import {
  bridge,
  goalSeek,
  narrative,
  priceVolume,
  regimeAdvice,
  simMetrics,
  stressTests,
  tornado,
  valueCreation,
} from "../strategic2";
import type { AppState } from "../types";

const base = (): AppState =>
  createState({
    tax: { regime: "presumido" },
    revenue: { bruta: m12(100_000), pmr: 30, pmp: 30, inadimplencia: m12(0) },
    costs: [
      {
        id: "cmv",
        label: "Mercadorias",
        category: "custo_vendas",
        values: m12(40_000),
        fixed: false,
      },
      {
        id: "sal",
        label: "Salários",
        category: "despesa_administrativa",
        values: m12(20_000),
        fixed: false,
      },
      {
        id: "alu",
        label: "Aluguel",
        category: "despesa_administrativa",
        values: m12(8_000),
        fixed: false,
      },
    ],
  } as never);

describe("Simulador estratégico 2.0", () => {
  it("ponte (Shapley): contribuições somam a diferença total, em todas as métricas", () => {
    const p = {
      ...DEFAULT_SIM,
      priceDeltaPct: 8,
      priceElasticity: 1.2,
      cpvDeltaPct: -5,
      pmrDeltaDays: -10,
    };
    const br = bridge(base(), p);
    expect(br.metodo).toBe("exato");
    expect(br.itens.map((i) => i.id).sort()).toEqual(["cpv", "pmr", "preco"]);
    for (const k of ["ebitda", "lucroLiquido", "caixaFinal"] as const) {
      const total = br.itens.reduce((s, i) => s + i[k], 0);
      expect(total).toBeCloseTo(br.simulado[k] - br.base[k], 4);
    }
    // PMR mexe só no caixa, não no lucro.
    expect(br.itens.find((i) => i.id === "pmr")!.lucroLiquido).toBeCloseTo(0, 4);
    expect(br.itens.find((i) => i.id === "pmr")!.caixaFinal).toBeGreaterThan(0);
  });

  it("ponte amostrada com muitas alavancas ainda soma a diferença total", () => {
    const p = {
      ...DEFAULT_SIM,
      priceDeltaPct: 5,
      volumeDeltaPct: 5,
      cpvDeltaPct: -3,
      payrollDeltaPct: -5,
      fixedCutPct: 10,
      pmrDeltaDays: -5,
      pmpDeltaDays: 10,
      inadimplenciaDeltaPp: 1,
    };
    const br = bridge(base(), p, { maxExact: 4, samples: 12 });
    expect(br.metodo).toBe("amostrado");
    const total = br.itens.reduce((s, i) => s + i.lucroLiquido, 0);
    expect(total).toBeCloseTo(br.simulado.lucroLiquido - br.base.lucroLiquido, 4);
  });

  it("preço × volume: m = 50%, corte de 10% exige +25% de volume", () => {
    const { margem, pontos } = priceVolume(base());
    expect(margem).toBeGreaterThan(0);
    const p10 = pontos.find((x) => x.precoPct === -10)!;
    expect(p10.volumeEquilibrio).toBeCloseTo(0.1 / (margem - 0.1), 6);
  });

  it("meta: acha o preço que leva o EBITDA a um alvo", () => {
    const b = base();
    const atual = simMetrics(b, DEFAULT_SIM).ebitda;
    const r = goalSeek(b, DEFAULT_SIM, "priceDeltaPct", "ebitda", atual + 60_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.atingido).toBeCloseTo(atual + 60_000, -1);
      expect(r.valor).toBeGreaterThan(0);
    }
    const impossivel = goalSeek(b, DEFAULT_SIM, "pmrDeltaDays", "ebitda", atual * 10);
    expect(impossivel.ok).toBe(false);
  });

  it("tornado ordenado pela amplitude; preço e volume no topo; prazos não mexem no EBITDA", () => {
    const t = tornado(base(), DEFAULT_SIM, "ebitda");
    for (let i = 1; i < t.barras.length; i++)
      expect(t.barras[i - 1].amplitude).toBeGreaterThanOrEqual(t.barras[i].amplitude);
    expect(
      t.barras
        .slice(0, 2)
        .map((b) => b.key)
        .sort(),
    ).toEqual(["priceDeltaPct", "volumeDeltaPct"]);
    expect(t.barras.find((b) => b.key === "pmrDeltaDays")!.amplitude).toBeCloseTo(0, 4);
  });

  it("estresse, valor e regime produzem leitura executiva", () => {
    const b = base();
    const st = stressTests(b, DEFAULT_SIM);
    expect(st.map((s) => s.id)).toContain("tempestade");
    const tempestade = st.find((s) => s.id === "tempestade")!;
    expect(tempestade.deltaLucro).toBeLessThan(0);
    const v = valueCreation(b, { ...DEFAULT_SIM, priceDeltaPct: 5 });
    expect(v.simulado.nopat).toBeGreaterThan(v.base.nopat);
    const rg = regimeAdvice(b, DEFAULT_SIM);
    expect(["simples", "presumido", "real"]).toContain(rg.melhor);
    const br = bridge(b, { ...DEFAULT_SIM, priceDeltaPct: 5 });
    const ins = narrative(br, st, v, rg, (n) => n.toFixed(0));
    expect(ins.length).toBeGreaterThan(0);
  });
});

describe("Monte Carlo 2.0", () => {
  it("reprodutível (semente) e mede o pior mês e a cauda do lucro", async () => {
    const { runMonteCarlo, DEFAULT_MC } = await import("../montecarlo");
    const cfg = { ...DEFAULT_MC, iterations: 60 };
    const a = runMonteCarlo(base(), cfg);
    const b = runMonteCarlo(base(), cfg);
    expect(a.lucroLiquido.mean).toBe(b.lucroLiquido.mean);
    expect(a.piorSaldoMensal!.p5).toBeLessThanOrEqual(a.saldoCaixaFinal.p5);
    expect(a.cvar5Lucro!).toBeLessThanOrEqual(a.lucroLiquido.p5);
    const c = runMonteCarlo(base(), { ...cfg, seed: 7 });
    expect(c.lucroLiquido.mean).not.toBe(a.lucroLiquido.mean);
  });
});
