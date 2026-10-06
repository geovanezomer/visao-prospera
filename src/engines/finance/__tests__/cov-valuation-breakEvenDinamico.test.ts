import { describe, it, expect } from "vitest";
import {
  solveBreakEvenDinamico,
  breakEvenDinamicoToMarkdown,
  type BreakEvenDinamicoResult,
} from "../breakEvenDinamico";
import { applySimulator, DEFAULT_SIM } from "../simulator";
import { buildDRE } from "../dre";
import { buildCashFlow } from "../cashflow";
import { calcIndicators } from "../indicators";
import { resolveEffectiveRegime } from "../regime";
import { MESES } from "../format";
import type { AppState, CostLine } from "../types";
import { createState, m12 } from "./helpers";

const linha = (
  id: string,
  label: string,
  category: CostLine["category"],
  valor: number,
  extras: Partial<CostLine> = {},
): CostLine => ({ id, label, category, values: m12(valor), fixed: true, ...extras });

const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);

// Receita sazonal: dezembro dobra (varejo/serviços de fim de ano).
const SAZONAL = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 100].map((v) => v * 1000);

/** Prejuízo operacional com margem de contribuição positiva: fixos altos. */
function estadoDeficitario(): AppState {
  return createState({
    revenue: { bruta: SAZONAL, inadimplencia: m12(0) },
    costs: [
      linha("cv", "Insumos", "custo_vendas", 0, {
        values: SAZONAL.map((v) => v * 0.3),
        fixed: false,
      }),
      linha("alug", "Aluguel", "fixo", 40_000),
    ],
  });
}

/** Métrica recalculada fora do solver (mesmo motor de simulação). */
const ebitdaCom = (base: AppState, v: number) => {
  const st = applySimulator(base, { ...DEFAULT_SIM, volumeDeltaPct: v });
  return soma(buildDRE(st, resolveEffectiveRegime(st)).dre.ebitda);
};
const piorCaixaCom = (base: AppState, v: number) => {
  const st = applySimulator(base, { ...DEFAULT_SIM, volumeDeltaPct: v });
  return Math.min(...buildCashFlow(st).saldoFinal);
};

describe("solveBreakEvenDinamico — EBITDA ≥ 0", () => {
  const base = estadoDeficitario();
  const r = solveBreakEvenDinamico(base, { restricao: "ebitda_positivo" });

  it("baseline deficitário: metricaBase < 0 e meta default 0", () => {
    expect(r.metaValor).toBe(0);
    expect(r.metricaBase).toBeLessThan(0);
    expect(r.metricaBase).toBeCloseTo(ebitdaCom(base, 0), 4);
    expect(r.receitaBaseAnual).toBe(soma(SAZONAL)); // 650.000
  });

  it("solução atinge a meta e é mínima (tolerância de bisecção 0,5pp)", () => {
    expect(r.atingiuMeta).toBe(true);
    expect(r.volumeDeltaPct).toBeGreaterThan(0);
    expect(r.metricaAtingida).toBeGreaterThanOrEqual(0);
    expect(r.metricaAtingida).toBeCloseTo(ebitdaCom(base, r.volumeDeltaPct), 4);
    // meio ponto percentual abaixo ainda não atende → solução é o menor volume
    expect(ebitdaCom(base, r.volumeDeltaPct - 0.5)).toBeLessThan(0);
  });

  it("receita da solução = receita base × (1 + Δ%) e preserva a sazonalidade", () => {
    const f = 1 + r.volumeDeltaPct / 100;
    expect(r.receitaTotalAnual).toBeCloseTo(soma(SAZONAL) * f, 2);
    expect(r.distribuicaoMensal).toHaveLength(12);
    // dezembro continua sendo 2× os demais meses
    expect(r.distribuicaoMensal[11] / r.distribuicaoMensal[0]).toBeCloseTo(2, 8);
    expect(soma(r.distribuicaoMensal)).toBeCloseTo(r.receitaTotalAnual, 4);
  });

  it("sazonalidade=false distribui a receita uniformemente", () => {
    const u = solveBreakEvenDinamico(base, { restricao: "ebitda_positivo", sazonalidade: false });
    expect(u.volumeDeltaPct).toBeCloseTo(r.volumeDeltaPct, 8);
    for (const v of u.distribuicaoMensal) expect(v).toBeCloseTo(u.receitaTotalAnual / 12, 6);
  });

  it("meta explícita maior exige mais volume (monotonicidade)", () => {
    const r2 = solveBreakEvenDinamico(base, { restricao: "ebitda_positivo", metaValor: 50_000 });
    expect(r2.atingiuMeta).toBe(true);
    expect(r2.volumeDeltaPct).toBeGreaterThan(r.volumeDeltaPct);
    expect(r2.metricaAtingida).toBeGreaterThanOrEqual(50_000);
  });
});

describe("solveBreakEvenDinamico — baseline já atende", () => {
  const lucrativo = createState({
    revenue: { bruta: SAZONAL, inadimplencia: m12(0) },
    costs: [linha("alug", "Aluguel", "fixo", 1_000)],
  });

  it("volume 0, receita igual à base e observação explicativa", () => {
    const r = solveBreakEvenDinamico(lucrativo, { restricao: "ebitda_positivo" });
    expect(r.atingiuMeta).toBe(true);
    expect(r.volumeDeltaPct).toBe(0);
    expect(r.receitaTotalAnual).toBe(r.receitaBaseAnual);
    expect(r.metricaAtingida).toBe(r.metricaBase);
    expect(r.distribuicaoMensal).toEqual(SAZONAL);
    expect(r.observacao).toMatch(/Baseline já atende/);
  });

  it("sem sazonalidade: 650.000 / 12 por mês", () => {
    const r = solveBreakEvenDinamico(lucrativo, {
      restricao: "ebitda_positivo",
      sazonalidade: false,
    });
    for (const v of r.distribuicaoMensal) expect(v).toBeCloseTo(650_000 / 12, 6);
  });
});

describe("solveBreakEvenDinamico — meta inalcançável (MC ≤ 0)", () => {
  // CPV variável de 120% da receita: cada real vendido aumenta o prejuízo.
  const mcNegativa = createState({
    revenue: { bruta: m12(10_000), inadimplencia: m12(0) },
    costs: [
      linha("cv", "Insumos", "custo_vendas", 12_000, { fixed: false }),
      linha("alug", "Aluguel", "fixo", 5_000),
    ],
  });

  it("devolve teto de busca (+500%), atingiuMeta=false e observação", () => {
    const r = solveBreakEvenDinamico(mcNegativa, { restricao: "ebitda_positivo" });
    expect(r.atingiuMeta).toBe(false);
    expect(r.volumeDeltaPct).toBe(500);
    // +500% = 6× a receita base (120.000 → 720.000)
    expect(r.receitaTotalAnual).toBeCloseTo(720_000, 2);
    expect(r.metricaAtingida).toBeLessThan(0);
    expect(r.observacao).toMatch(/inalcançável/);
    const u = solveBreakEvenDinamico(mcNegativa, {
      restricao: "ebitda_positivo",
      sazonalidade: false,
    });
    for (const v of u.distribuicaoMensal) expect(v).toBeCloseTo(60_000, 4);
  });
});

describe("solveBreakEvenDinamico — DSCR e caixa mínimo", () => {
  it("DSCR: meta default 1,25 e métrica = DSCR dos indicadores", () => {
    const s = createState({
      revenue: { bruta: m12(60_000), inadimplencia: m12(0) },
      costs: [
        linha("cv", "Insumos", "custo_vendas", 20_000, { fixed: false }),
        linha("alug", "Aluguel", "fixo", 30_000),
      ],
      capital: {
        debtContracts: [
          {
            id: "d1",
            credor: "Banco",
            saldoDevedor: 300_000,
            taxaAA: 18,
            sistema: "price" as const,
            prazoMeses: 36,
          },
        ],
      },
    });
    const r = solveBreakEvenDinamico(s, { restricao: "dscr" });
    expect(r.metaValor).toBe(1.25);
    const { dre } = buildDRE(s, resolveEffectiveRegime(s));
    const dscrBase = calcIndicators(s, dre, buildCashFlow(s)).dscr ?? 999;
    expect(r.metricaBase).toBeCloseTo(dscrBase, 8);
    // Baseline com DSCR < 1,25 (≈ 0,92): precisa de volume adicional
    expect(r.metricaBase).toBeLessThan(1.25);
    expect(r.atingiuMeta).toBe(true);
    expect(r.metricaAtingida).toBeGreaterThanOrEqual(1.25);
    expect(r.volumeDeltaPct).toBeGreaterThan(0);
  });

  it("caixa mínimo: pior saldo mensal ≥ 0 na solução (recebimento à vista, PMR = 0)", () => {
    // Com PMR = 0 o saldo mensal cresce com o volume (MC > 0) e a bisecção é válida.
    // (Com PMR > 0 a métrica não é monotônica — ver relatório de bugs.)
    const base = createState({
      revenue: { bruta: SAZONAL, inadimplencia: m12(0), pmr: 0, pmrMensal: m12(0) },
      capital: { disponibilidades: 50_000 },
      costs: estadoDeficitario().costs,
    });
    const r = solveBreakEvenDinamico(base, { restricao: "caixa_min" });
    expect(r.metaValor).toBe(0);
    expect(r.metricaBase).toBeCloseTo(piorCaixaCom(base, 0), 4);
    expect(r.metricaBase).toBeLessThan(0);
    expect(r.atingiuMeta).toBe(true);
    expect(r.metricaAtingida).toBeGreaterThanOrEqual(0);
    expect(piorCaixaCom(base, r.volumeDeltaPct - 0.5)).toBeLessThan(0);
  });
});

describe("breakEvenDinamicoToMarkdown", () => {
  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const base: BreakEvenDinamicoResult = {
    restricao: "ebitda_positivo",
    metaValor: 0,
    metricaAtingida: 1_000,
    metricaBase: -50_000,
    volumeDeltaPct: 25,
    receitaTotalAnual: 125_000,
    receitaBaseAnual: 100_000,
    distribuicaoMensal: m12(125_000 / 12),
    atingiuMeta: true,
  };

  it("solução: incremento = receita solução − base e tabela de 12 meses", () => {
    const md = breakEvenDinamicoToMarkdown(base);
    expect(md).toContain(`EBITDA anual ≥ ${brl(0)}`);
    expect(md).toContain(`+25.0% volume = +${brl(25_000)}`);
    expect(md).toContain(`**Métrica resultante:** ${brl(1_000)}`);
    for (const m of MESES.slice(0, 12)) expect(md).toContain(`| ${m} |`);
  });

  it("DSCR formata em múltiplos (x) e caixa em R$", () => {
    const md = breakEvenDinamicoToMarkdown({
      ...base,
      restricao: "dscr",
      metaValor: 1.25,
      metricaBase: 0.8,
      metricaAtingida: 1.26,
    });
    expect(md).toContain("DSCR ≥ 1.25x");
    expect(md).toContain("**Baseline:** 0.80x");
    expect(md).toContain("1.26x");
    const mdCaixa = breakEvenDinamicoToMarkdown({ ...base, restricao: "caixa_min" });
    expect(mdCaixa).toContain(`Saldo de caixa mensal ≥ ${brl(0)}`);
  });

  it("meta não atingida e baseline já atende", () => {
    const nao = breakEvenDinamicoToMarkdown({
      ...base,
      atingiuMeta: false,
      volumeDeltaPct: 500,
      observacao: "Meta inalcançável",
    });
    expect(nao).toContain("Meta não atingida** mesmo com +500% de volume");
    expect(nao).toContain("- Meta inalcançável");
    expect(nao).not.toContain("| Mês |");
    const naoSemObs = breakEvenDinamicoToMarkdown({ ...base, atingiuMeta: false });
    expect(naoSemObs.split("\n")).toHaveLength(3);
    const ja = breakEvenDinamicoToMarkdown({ ...base, volumeDeltaPct: 0, observacao: "OK" });
    expect(ja).toContain("✅ OK");
    const jaSemObs = breakEvenDinamicoToMarkdown({ ...base, volumeDeltaPct: 0 });
    expect(jaSemObs).toContain("Baseline já atende.");
  });
});
