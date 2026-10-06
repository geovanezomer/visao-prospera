import { describe, expect, it } from "vitest";
import { createState, m12 } from "./helpers";
import { applySimulator, DEFAULT_SIM, marketShare } from "../simulator";
import { bridge, goalSeek, simMetrics } from "../strategic2";
import type { AppState } from "../types";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const base = (): AppState =>
  createState({
    tax: { regime: "presumido" },
    revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
    costs: [
      {
        id: "cmv",
        label: "Mercadorias",
        category: "custo_vendas",
        values: m12(40_000),
        fixed: false,
      },
      {
        id: "alu",
        label: "Aluguel",
        category: "despesa_administrativa",
        values: m12(10_000),
        fixed: false,
      },
    ],
  } as never);

describe("mercado e macroeconomia no simulador", () => {
  it("participação: +2 p.p. num mercado de 12 mi (share 10%) = +20% de volume", () => {
    const p = { ...DEFAULT_SIM, mercadoTamanho: 12_000_000, participacaoDeltaPp: 2 };
    const sh = marketShare(base(), p)!;
    expect(sh.base).toBeCloseTo(0.1, 10);
    expect(sh.simulada).toBeCloseTo(0.12, 10);
    const s = applySimulator(base(), p);
    expect(sum(s.revenue.bruta)).toBeCloseTo(1_440_000, 2);
    expect(s.costs.find((c) => c.id === "cmv")!.values[0]).toBeCloseTo(48_000, 4);
    expect(s.costs.find((c) => c.id === "alu")!.values[0]).toBe(10_000);
  });

  it("crescimento do mercado e preço relativo à concorrência", () => {
    const g = applySimulator(base(), { ...DEFAULT_SIM, mercadoCrescimentoPct: 10 });
    expect(sum(g.revenue.bruta)).toBeCloseTo(1_320_000, 2);
    // Concorrente baixa 10% e participação tem elasticidade 2 → perdemos volume.
    const c = applySimulator(base(), {
      ...DEFAULT_SIM,
      precoConcorrenciaPct: -10,
      elasticidadeParticipacao: 2,
    });
    expect(sum(c.revenue.bruta)).toBeCloseTo(1_200_000 * Math.pow(1 / 0.9, -2), 2);
  });

  it("IPCA corrige fixos; repasse ao preço é nominal (não reduz volume)", () => {
    const s = applySimulator(base(), {
      ...DEFAULT_SIM,
      ipcaPct: 5,
      ipcaRepassePct: 100,
      priceElasticity: 2,
    });
    expect(s.costs.find((c) => c.id === "alu")!.values[0]).toBeCloseTo(10_500, 4);
    expect(s.costs.find((c) => c.id === "cmv")!.values[0]).toBe(40_000); // volume não caiu
    expect(sum(s.revenue.bruta)).toBeCloseTo(1_260_000, 2);
  });

  it("câmbio sobre a parte importada do custo; Selic vira custo da dívida", () => {
    const s = applySimulator(base(), { ...DEFAULT_SIM, cambioPct: 20, cpvImportadoPct: 50 });
    expect(s.costs.find((c) => c.id === "cmv")!.values[0]).toBeCloseTo(44_000, 4);
    const comDivida = {
      ...base(),
      capital: {
        ...base().capital,
        debtContracts: [
          {
            id: "d",
            credor: "B",
            saldoDevedor: 240_000,
            taxaAA: 20,
            sistema: "price" as const,
            prazoMeses: 24,
          },
        ],
      },
    };
    const j = applySimulator(comDivida, { ...DEFAULT_SIM, selicDeltaPp: 2 });
    expect(sum(j.costs.find((c) => c.id === "sim_kd")!.values)).toBeCloseTo(4_800, 2);
  });

  it("ponte e metas cobrem as novas alavancas", () => {
    const p = { ...DEFAULT_SIM, mercadoTamanho: 12_000_000, participacaoDeltaPp: 1, ipcaPct: 4 };
    const br = bridge(base(), p);
    expect(br.itens.map((i) => i.id).sort()).toEqual(["ipca", "mercado"]);
    const alvo = simMetrics(base(), p).ebitda + 50_000;
    const r = goalSeek(base(), p, "participacaoDeltaPp", "ebitda", alvo);
    expect(r.ok).toBe(true);
  });
});

describe("Reforma Tributária no simulador", () => {
  it("2026 é a referência; anos seguintes trazem carga, lucro e repasse de preço coerentes", async () => {
    const { reformaImpact } = await import("../strategic2");
    const rows = reformaImpact(base(), DEFAULT_SIM);
    expect(rows.map((r) => r.ano)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    expect(rows[0].deltaLucro).toBeCloseTo(0, 2);
    expect(rows[0].repassePct).toBe(0);
    for (const r of rows.slice(1)) {
      if (r.repassePct === null) continue;
      // Perdeu lucro → precisa subir preço; ganhou → poderia reduzir.
      if (r.deltaLucro < -1) expect(r.repassePct).toBeGreaterThan(0);
      if (r.deltaLucro > 1) expect(r.repassePct).toBeLessThan(0);
    }
  });
});

describe("mix de produtos", () => {
  it("margem de contribuição por produto após tributos, alertas e Pareto", async () => {
    const { productContribution } = await import("../strategic2");
    const r = productContribution(
      [
        { nome: "A", receita: 600_000, cmv: 300_000 },
        { nome: "B", receita: 300_000, cmv: 240_000 },
        { nome: "C", receita: 100_000, cmv: 110_000 },
      ],
      1_000_000,
      100_000, // 10% de tributos e deduções
    );
    expect(r.aliquotaVendas).toBeCloseTo(10, 6);
    const a = r.itens.find((i) => i.nome === "A")!;
    expect(a.margem).toBeCloseTo(600_000 * 0.9 - 300_000, 6);
    expect(r.itens.find((i) => i.nome === "C")!.alerta).toBe("negativa");
    expect(r.itens.find((i) => i.nome === "B")!.alerta).toBe("diluidora");
    expect(r.itens[0].nome).toBe("A");
    expect(r.pareto.produtos).toBe(1);
  });
});
