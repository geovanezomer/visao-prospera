import { describe, it, expect } from "vitest";
import {
  runTornado,
  runJointScenario,
  tornadoToMarkdown,
  jointToMarkdown,
  monteCarloToMarkdown,
  DEFAULT_MC,
  runMonteCarlo,
  type TornadoResult,
  type JointResult,
} from "../sensibilidadeMulti";
import { applyDriver, readOutput } from "../sensitivity";
import type { MCResult, MCDist } from "../montecarlo";
import type { CostLine } from "../types";
import { createState, m12 } from "./helpers";

const linha = (
  id: string,
  label: string,
  category: CostLine["category"],
  valor: number,
  extras: Partial<CostLine> = {},
): CostLine => ({ id, label, category, values: m12(valor), fixed: true, ...extras });

// Custos sem folha no CPV — Simples: DAS depende só da receita, então o
// efeito de CPV/juros sobre o EBITDA é linear e calculável à mão.
const CUSTOS: CostLine[] = [
  linha("cv", "Insumos", "custo_vendas", 10_000),
  linha("dv", "Mercadoria", "direto_venda", 5_000),
  linha("var", "Marketing", "variavel", 2_000),
  linha("sal", "Salários administrativos", "despesa_administrativa", 8_000, {
    encargosAuto: true,
  }),
  linha("alug", "Aluguel", "fixo", 3_000),
  linha("fin", "Tarifas bancárias", "financeiro", 500),
];

const estado = () =>
  createState({ revenue: { bruta: m12(100_000), inadimplencia: m12(0) }, costs: CUSTOS });

// Formatação BRL idêntica à do módulo (evita depender do NBSP do Intl).
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

describe("runTornado — impacto absoluto por driver", () => {
  const s = estado();
  const t = runTornado(s, ["juros", "cpv", "preco"], 10, ["ebitda", "lucroLiquido"]);

  it("estrutura: deltaPct, outputs e uma célula por output", () => {
    expect(t.deltaPct).toBe(10);
    expect(t.outputs).toEqual(["ebitda", "lucroLiquido"]);
    for (const r of t.rows) expect(r.cells.map((c) => c.output)).toEqual(t.outputs);
  });

  it("CPV ±10%: swing do EBITDA = 2 × 10% × CPV anual = 2 × 0,1 × 180.000 = 36.000", () => {
    const cpv = t.rows.find((r) => r.driver === "cpv")!;
    const cel = cpv.cells.find((c) => c.output === "ebitda")!;
    expect(cel.swing).toBeCloseTo(36_000, 2);
    // high (CPV +10%) < low (CPV −10%) → custo maior reduz EBITDA
    expect(cel.high).toBeLessThan(cel.low);
    expect(cel.swingPct).toBeCloseTo((36_000 / Math.abs(cel.baseline)) * 100, 6);
    expect(cel.baseline).toBeCloseTo(readOutput(s, "ebitda"), 6);
  });

  it("Juros ±10%: swing nulo no EBITDA e swing no LL = 2 × 10% × 6.000 = 1.200 (Simples sem IR sobre lucro)", () => {
    const juros = t.rows.find((r) => r.driver === "juros")!;
    expect(juros.label).toBe("Juros");
    expect(juros.cells[0].swing).toBeCloseTo(0, 6);
    expect(juros.cells[1].swing).toBeCloseTo(1_200, 2);
    expect(juros.totalSwing).toBeCloseTo(juros.cells[0].swing + juros.cells[1].swing, 8);
  });

  it("linhas ordenadas por totalSwing decrescente (preço é a maior alavanca)", () => {
    for (let i = 1; i < t.rows.length; i++) {
      expect(t.rows[i - 1].totalSwing).toBeGreaterThanOrEqual(t.rows[i].totalSwing);
    }
    expect(t.rows[0].driver).toBe("preco");
    expect(t.rows[t.rows.length - 1].driver).toBe("juros");
  });

  it("baseline zero → swingPct = 0", () => {
    const zero = createState({
      revenue: { bruta: m12(0), inadimplencia: m12(0) },
      costs: [linha("fin", "Tarifas bancárias", "financeiro", 500)],
    });
    const r = runTornado(zero, ["preco"], 10, ["ebitda"]);
    expect(r.rows[0].cells[0].baseline).toBe(0);
    expect(r.rows[0].cells[0].swingPct).toBe(0);
  });
});

describe("runJointScenario — cenário combinado (composição)", () => {
  const s = estado();

  it("CPV +10% e juros +10%: Δ EBITDA = só o efeito do CPV (−18.000)", () => {
    const r = runJointScenario(
      s,
      [
        { driver: "cpv", deltaPct: 10 },
        { driver: "juros", deltaPct: 10 },
      ],
      ["ebitda", "lucroLiquido"],
    );
    const e = r.outputs[0];
    expect(e.delta).toBeCloseTo(-18_000, 2);
    expect(e.cenario - e.baseline).toBeCloseTo(e.delta, 8);
    expect(e.deltaPct).toBeCloseTo((e.delta / Math.abs(e.baseline)) * 100, 8);
    // LL perde CPV (18.000) + juros (600) = 18.600
    expect(r.outputs[1].delta).toBeCloseTo(-18_600, 2);
  });

  it("drivers repetidos se compõem multiplicativamente: volume +10% duas vezes = ×1,21", () => {
    const r = runJointScenario(
      s,
      [
        { driver: "volume", deltaPct: 10 },
        { driver: "volume", deltaPct: 10 },
      ],
      ["ebitda"],
    );
    const direto = readOutput(applyDriver(s, "volume", 21), "ebitda");
    expect(r.outputs[0].cenario).toBeCloseTo(direto, 4);
  });

  it("sem movimentos → cenário = baseline e baseline zero → deltaPct = 0", () => {
    const r = runJointScenario(s, [], ["ebitda"]);
    expect(r.outputs[0].delta).toBe(0);
    const zero = createState({
      revenue: { bruta: m12(0), inadimplencia: m12(0) },
      costs: [linha("fin", "Tarifas bancárias", "financeiro", 500)],
    });
    const rz = runJointScenario(zero, [{ driver: "preco", deltaPct: 10 }], ["ebitda"]);
    expect(rz.outputs[0].deltaPct).toBe(0);
  });
});

describe("markdown — tornado / combinado / Monte Carlo", () => {
  it("tornadoToMarkdown: cabeçalho, setas e maior alavanca", () => {
    const t: TornadoResult = {
      deltaPct: 10,
      outputs: ["ebitda", "roic"],
      rows: [
        {
          driver: "preco",
          label: "Preço",
          deltaPct: 10,
          totalSwing: 50_000,
          cells: [
            {
              output: "ebitda",
              baseline: 100_000,
              low: 80_000,
              high: 120_000,
              swing: 40_000,
              swingPct: 40,
            },
            { output: "roic", baseline: 10, low: 12, high: 8, swing: 4, swingPct: 40 },
          ],
        },
      ],
    };
    const md = tornadoToMarkdown(t);
    expect(md).toContain("## Tornado — sensibilidade ±10% por driver");
    expect(md).toContain("| Driver | Δ EBITDA | Δ ROIC (%) |");
    expect(md).toContain("| --- | ---: | ---: |");
    expect(md).toContain(`| **Preço** | ${brl(40_000)} ↑ (40.0%) | 4.00% ↓ (40.0%) |`);
    expect(md).toContain(`**Maior alavanca:** Preço`);
    expect(md).toContain(brl(50_000));
  });

  it("tornadoToMarkdown sem linhas não cita maior alavanca", () => {
    const md = tornadoToMarkdown({ deltaPct: 5, outputs: ["ebitda"], rows: [] });
    expect(md).not.toContain("Maior alavanca");
  });

  it("jointToMarkdown: sinais de +/− e valores formatados", () => {
    const r: JointResult = {
      moves: [
        { driver: "preco", deltaPct: -10 },
        { driver: "folha", deltaPct: 5 },
      ],
      outputs: [
        { output: "ebitda", baseline: 100_000, cenario: 80_000, delta: -20_000, deltaPct: -20 },
        { output: "roic", baseline: 10, cenario: 12, delta: 2, deltaPct: 20 },
        { output: "saldoCaixa", baseline: NaN, cenario: 0, delta: 0, deltaPct: 0 },
      ],
    };
    const md = jointToMarkdown(r);
    expect(md).toContain("## Cenário combinado — Preço -10% · Folha +5%");
    expect(md).toContain(
      `| EBITDA | ${brl(100_000)} | ${brl(80_000)} | ${brl(-20_000)} | -20.0% |`,
    );
    expect(md).toContain("| ROIC (%) | 10.00% | 12.00% | +2.00% | +20.0% |");
    // NaN é saneado para 0 na formatação BRL
    expect(md).toContain(`| Saldo Caixa (Dez) | ${brl(0)} |`);
  });

  const dist = (label: string, base: number): MCDist => ({
    label,
    values: [],
    mean: base,
    median: base,
    p5: base * 0.5,
    p25: base * 0.8,
    p75: base * 1.2,
    p95: base * 1.5,
    probPositive: 1,
  });

  it("monteCarloToMarkdown: percentis, probabilidades e aviso de correlação", () => {
    const r: MCResult = {
      iterations: 1000,
      ebitda: dist("EBITDA", 100_000),
      lucroLiquido: dist("Lucro Líquido", 50_000),
      saldoCaixaFinal: dist("Saldo Caixa", 20_000),
      probPrejuizo: 0.123,
      probCaixaNegativo: 0.05,
      correlationFellBackToIdentity: true,
    };
    const md = monteCarloToMarkdown(r);
    expect(md).toContain(`## Monte Carlo — ${(1000).toLocaleString("pt-BR")} iterações`);
    expect(md).toContain("não-PSD");
    expect(md).toContain(
      `| EBITDA | ${brl(50_000)} | ${brl(80_000)} | ${brl(100_000)} | ${brl(120_000)} | ${brl(150_000)} |`,
    );
    expect(md).toContain("**Probabilidade de prejuízo:** 12.3%");
    expect(md).toContain("caixa abaixo do mínimo:** 5.0%");
    const semAviso = monteCarloToMarkdown({ ...r, correlationFellBackToIdentity: false });
    expect(semAviso).not.toContain("não-PSD");
  });

  it("reexporta runMonteCarlo e DEFAULT_MC", () => {
    expect(typeof runMonteCarlo).toBe("function");
    expect(DEFAULT_MC).toBeDefined();
  });
});
