// Engine prescritivo — detecção de cada card e efeito das ações "Aplicar".
//
// O modelo pré-computado (`pre`) é sintético para disparar cada detector de
// forma isolada; o card de regime usa `compareRegimes(state)` real e é
// conferido contra o próprio comparativo (economia = carga atual − melhor).

import { describe, it, expect } from "vitest";
import {
  buildPrescriptiveCards,
  snapshot,
  severanceCostPerPosition,
  cloneCosts,
  type PrescriptiveCard,
  type PrescriptivePrecomputed,
} from "../prescriptive";
import { severanceCostPerPosition as sevPrimitive } from "../levers/primitives";
import { compareRegimes } from "../tax/compare";
import { getFinancialModelCached } from "../financialModel";
import { fmtBRL } from "../format";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine, DebtContract } from "../types";

type PreOver = {
  dre?: Record<string, unknown>;
  ind?: Record<string, unknown>;
  cf?: Record<string, unknown>;
};

// Empresa "neutra": nenhum detector condicional dispara.
//   RL 1,2M · fixos 360k (30%) · EBITDA 240k · FCF 200k (83%) · giro 1,0×
function pre(o: PreOver = {}): PrescriptivePrecomputed {
  return {
    dre: {
      receitaBruta: m12(110_000),
      receitaLiquida: m12(100_000),
      lucroLiquido: m12(10_000),
      ebitda: m12(20_000),
      custosFixos: m12(30_000),
      ...o.dre,
    },
    tax: { annual: 50_000 },
    ind: {
      margemLiquida: 10,
      margemEbitda: 20,
      margemBruta: 95,
      roic: 20,
      wacc: 12,
      dividaLiqEbitda: 1,
      coberturaJuros: 5,
      pontoEquilibrio: 600_000,
      fcf: 200_000,
      gapCapitalGiro: 0,
      cicloFinanceiro: 0,
      giroAtivo: 1,
      ...o.ind,
    },
    cf: {
      alertas: [],
      totais: { saldoFinal: 80_000, pioresMes: { mes: "Mar", saldo: 20_000 } },
      ...o.cf,
    },
  } as unknown as PrescriptivePrecomputed;
}

const line = (
  id: string,
  label: string,
  category: CostLine["category"],
  v: number,
  extra: Partial<CostLine> = {},
): CostLine => ({ id, label, category, values: m12(v), fixed: false, ...extra });

/** Estado sem folha: só despesas administrativas e CPV. */
function semFolha(over: Partial<AppState> = {}): AppState {
  const s = createState({
    revenue: { bruta: m12(110_000), pmr: 30, pmp: 30, inadimplencia: m12(0) },
    capital: { ativoTotal: 1_000_000 },
  } as never);
  return {
    ...s,
    costs: [
      line("alu", "Aluguel", "fixo", 8000),
      line("sw", "Software", "despesa_administrativa", 3000),
      line("cont", "Contabilidade", "despesa_administrativa", 1500),
      line("lim", "Limpeza", "despesa_administrativa", 500),
      line("cmv", "Insumos", "custo_vendas", 20_000),
      line("jur", "Juros de financiamento", "financeiro", 2000),
    ],
    ...over,
  };
}

const card = (cards: PrescriptiveCard[], id: string) => cards.find((c) => c.id === id);
const action = (c: PrescriptiveCard | undefined, id: string) =>
  c!.actions.find((a) => a.id === id)!;
const val = (s: AppState, id: string) => s.costs.find((c) => c.id === id)!.values[0];

describe("buildPrescriptiveCards — empresa neutra", () => {
  it("só emite os cards sempre exibidos (regime e eficiência)", () => {
    const cards = buildPrescriptiveCards(semFolha(), pre());
    expect(cards.map((c) => c.id).sort()).toEqual(["eficiencia_op", "regime"]);
    const ef = card(cards, "eficiencia_op")!;
    expect(ef.severity).toBe("ok");
    expect(ef.problem).toBe("Eficiência operacional saudável");
    // FCF/EBITDA = 200k / 240k = 83%
    expect(ef.metricValue).toBe("83% · 1.00×");
    expect(ef.actions).toEqual([]);
  });

  it("re-exporta helpers de primitivas (API pública preservada)", () => {
    expect(severanceCostPerPosition).toBe(sevPrimitive);
    expect(typeof cloneCosts).toBe("function");
  });
});

describe("card 1 — folha alta", () => {
  // Salários 10.000/mês (sem encargos automáticos) → folha anual 120.000
  const comFolha = () =>
    semFolha({
      costs: [
        ...semFolha().costs,
        line("sal", "Salários equipe", "despesa_administrativa", 10_000),
      ],
    });

  it("folha 30% da RL (faixa serviços 18–28%) → warn", () => {
    // RL = 400k → 120k/400k = 30% ; 30 ≤ 28 × 1,5 = 42 → warn
    const c = card(
      buildPrescriptiveCards(comFolha(), pre({ dre: { receitaLiquida: m12(400_000 / 12) } })),
      "folha_alta",
    )!;
    expect(c.severity).toBe("warn");
    expect(c.metricValue).toBe("30.0%");
    expect(c.benchmark).toContain("18–28%");
  });

  it("folha 60% da RL → danger; ações aplicam cortes e receita", () => {
    const s = comFolha();
    const c = card(
      buildPrescriptiveCards(s, pre({ dre: { receitaLiquida: m12(200_000 / 12) } })),
      "folha_alta",
    )!;
    expect(c.severity).toBe("danger");
    expect(c.metricValue).toBe("60.0%");

    // −5% na folha: 10.000 → 9.500; demais linhas intactas
    const corte = action(c, "reduce_clt_5pct");
    expect(corte.asSimulatorParams).toEqual({ payrollDeltaPct: -5 });
    const r5 = corte.apply(s);
    expect(val(r5, "sal")).toBeCloseTo(9500, 10);
    expect(val(r5, "alu")).toBe(8000);

    // +30% de receita
    const rec = action(c, "increase_revenue_30").apply(s);
    expect(rec.revenue.bruta[0]).toBeCloseTo(143_000, 6);

    // Rescisão: cria linha one-shot e reduz folha (sem afirmar o valor — ver relatório)
    const dem = action(c, "dismiss_2_severance").apply(s);
    expect(dem.costs.some((l) => l.label === "Rescisões e indenizações (one-shot)")).toBe(true);
    expect(val(dem, "sal")).toBeLessThan(10_000);

    const red = action(c, "reduce_clt_2").apply(s);
    expect(val(red, "sal")).toBeLessThan(10_000);
    expect(val(red, "sal")).toBeGreaterThanOrEqual(0);
  });

  it("sem receita líquida, folha % = 0 (não dispara)", () => {
    const cards = buildPrescriptiveCards(comFolha(), pre({ dre: { receitaLiquida: m12(0) } }));
    expect(card(cards, "folha_alta")).toBeUndefined();
  });
});

describe("card 2 — ROIC < WACC", () => {
  it("detecta destruição de valor e ações mexem em fixos, preço e ativo", () => {
    const s = semFolha();
    const c = card(buildPrescriptiveCards(s, pre({ ind: { roic: 5, wacc: 15 } })), "roic_wacc")!;
    expect(c.severity).toBe("danger");
    expect(c.metricValue).toBe("5.0% < 15.0%");

    // −15% nas 3 maiores fixas: Aluguel 8.000, Software 3.000, Contabilidade 1.500
    const r = action(c, "cut_fixed_15").apply(s);
    expect(val(r, "alu")).toBeCloseTo(6800, 10);
    expect(val(r, "sw")).toBeCloseTo(2550, 10);
    expect(val(r, "cont")).toBeCloseTo(1275, 10);
    expect(val(r, "lim")).toBe(500); // 4ª maior: fora do corte
    expect(val(r, "cmv")).toBe(20_000);

    expect(action(c, "price_5").apply(s).revenue.bruta[0]).toBeCloseTo(115_500, 6);
    expect(action(c, "reduce_assets").apply(s).capital.ativoTotal).toBeCloseTo(800_000, 6);
  });

  it("ROIC não finito não dispara", () => {
    const cards = buildPrescriptiveCards(semFolha(), pre({ ind: { roic: NaN, wacc: 15 } }));
    expect(card(cards, "roic_wacc")).toBeUndefined();
  });
});

describe("card 3 — caixa abaixo do mínimo", () => {
  it("saldo negativo → danger; ações de PMR/PMP com prazos coerentes", () => {
    const s = semFolha();
    const cards = buildPrescriptiveCards(
      s,
      pre({
        cf: {
          alertas: [{ mes: "Nov", saldo: -35_000, tipo: "negativo" }],
          totais: { saldoFinal: -10_000, pioresMes: { mes: "Nov", saldo: -35_000 } },
        },
      }),
    );
    const c = card(cards, "caixa_negativo")!;
    expect(c.severity).toBe("danger");
    expect(c.metricValue).toMatch(/^Nov: -R\$\s?35\.000,00$/);

    const pmr = action(c, "reduce_pmr");
    expect(pmr.title).toBe("Reduzir PMR de 30 para 15 dias");
    expect(pmr.apply(s).revenue.pmr).toBe(15);
    const pmp = action(c, "increase_pmp");
    expect(pmp.title).toContain("de 30 para 45 dias");
    expect(pmp.apply(s).revenue.pmp).toBe(45);

    // Empréstimo: o suficiente para o pior mês (−35.000) voltar ao caixa mínimo,
    // arredondado a R$ 1 mil; entra no mês 1 com PRICE 2% a.m. × 12.
    const loan = action(c, "loan_giro");
    const principal = loan.asSimulatorParams!.loanPrincipal!;
    expect(principal).toBe(Math.ceil((s.cashflow.caixaMinimo + 35_000) / 1000) * 1000);
    const r = loan.apply(s);
    expect(r.cashflow.emprestimosCaptados[0]).toBe(principal);
    expect(r.cashflow.amortizacoes.reduce((a, b) => a + b, 0)).toBeCloseTo(principal, 4);
    expect(loan.asSimulatorParams).toMatchObject({ loanRatePctAm: 2, loanTermMonths: 12 });
  });

  it("só abaixo do mínimo (sem negativo) → warn; sem pior mês → '—'", () => {
    const cards = buildPrescriptiveCards(
      semFolha(),
      pre({
        cf: {
          alertas: [{ mes: "Jan", saldo: 5_000, tipo: "abaixoMinimo" }],
          totais: { saldoFinal: 5_000, pioresMes: null },
        },
      }),
    );
    const c = card(cards, "caixa_negativo")!;
    expect(c.severity).toBe("warn");
    expect(c.metricValue).toBe("—");
    // Sem pior mês informado, sugere o valor padrão de R$ 30 mil.
    expect(action(c, "loan_giro").asSimulatorParams!.loanPrincipal).toBe(30_000);
  });

  it("PMR já baixo: título nunca mostra prazo negativo", () => {
    const s = semFolha();
    const baixo = { ...s, revenue: { ...s.revenue, pmr: 10 } };
    const c = card(
      buildPrescriptiveCards(
        baixo,
        pre({
          cf: {
            alertas: [{ mes: "Jan", saldo: -1, tipo: "negativo" }],
            totais: { saldoFinal: -1, pioresMes: { mes: "Jan", saldo: -1 } },
          },
        }),
      ),
      "caixa_negativo",
    )!;
    expect(action(c, "reduce_pmr").title).toBe("Reduzir PMR de 10 para 0 dias");
    expect(action(c, "reduce_pmr").apply(baixo).revenue.pmr).toBe(0);
  });
});

describe("card 4 — cobertura de juros", () => {
  const debt: DebtContract = {
    id: "d",
    credor: "Banco",
    saldoDevedor: 100_000,
    taxaAA: 24,
    sistema: "price",
    prazoMeses: 24,
  };

  it("< 2× → danger; renegociação corta 30% dos custos financeiros", () => {
    const base = semFolha();
    const s = { ...base, capital: { ...base.capital, debtContracts: [debt] } };
    const c = card(
      buildPrescriptiveCards(s, pre({ ind: { coberturaJuros: 1.4 } })),
      "cobertura_juros",
    )!;
    expect(c.metricValue).toBe("1.4×");
    const ren = action(c, "renegotiate_rate").apply(s);
    expect(val(ren, "jur")).toBeCloseTo(1400, 10);
    expect(val(ren, "alu")).toBe(8000);

    const am = action(c, "amort_extra");
    expect(am.asSimulatorParams).toEqual({ debtPaydownPct: 30 });
    const r = am.apply(s);
    expect(r.capital.debtContracts![0].saldoDevedor).toBeCloseTo(70_000, 6);
    expect(val(r, "jur")).toBeCloseTo(1400, 10);
  });

  it("cobertura nula ou infinita não dispara", () => {
    for (const cj of [null, Infinity]) {
      const cards = buildPrescriptiveCards(semFolha(), pre({ ind: { coberturaJuros: cj } }));
      expect(card(cards, "cobertura_juros")).toBeUndefined();
    }
  });
});

describe("card 5 — gap de capital de giro", () => {
  it("gap positivo → warn com ciclo financeiro na causa; ações ±15 dias", () => {
    const s = semFolha();
    const c = card(
      buildPrescriptiveCards(s, pre({ ind: { gapCapitalGiro: 26_000, cicloFinanceiro: 42.5 } })),
      "ncg_gap",
    )!;
    expect(c.severity).toBe("warn");
    expect(c.metricValue).toMatch(/^R\$\s?26\.000,00$/);
    expect(c.cause).toContain("42.5 dias");
    expect(action(c, "pmr_minus_15").title).toContain("(30→15)");
    expect(action(c, "pmr_minus_15").apply(s).revenue.pmr).toBe(15);
    expect(action(c, "pmp_plus_15").title).toContain("(30→45)");
    expect(action(c, "pmp_plus_15").apply(s).revenue.pmp).toBe(45);
  });
});

describe("card 6 — margem bruta", () => {
  it("ações: +8% de preço e −10% no custo de vendas", () => {
    const s = semFolha();
    const c = card(buildPrescriptiveCards(s, pre({ ind: { margemBruta: 5 } })), "margem_bruta")!;
    expect(c.metricValue).toBe("5.0%");
    expect(action(c, "price_8").apply(s).revenue.bruta[0]).toBeCloseTo(118_800, 6);
    const cv = action(c, "cv_minus_10").apply(s);
    expect(val(cv, "cmv")).toBeCloseTo(18_000, 10);
    expect(val(cv, "alu")).toBe(8000);
  });

  it("comércio: benchmark exibido no formato P25 · mediana do setor resolvido", () => {
    const s = { ...semFolha(), businessType: "comercio" as const };
    const c = card(buildPrescriptiveCards(s, pre({ ind: { margemBruta: 1 } })), "margem_bruta")!;
    expect(c.benchmark).toMatch(/P25 \d+\.\d% · mediana \d+\.\d%$/);
  });
});

describe("card 7 — regime tributário", () => {
  it("economia = carga atual − melhor regime; severidade pela % economizada", () => {
    for (const regime of ["simples", "presumido", "real"] as const) {
      const s = { ...semFolha(), tax: { ...semFolha().tax, regime } };
      const reg = compareRegimes(s);
      const melhor = (["simples", "presumido", "real"] as const)
        .slice()
        .sort((a, b) => reg[a].annual - reg[b].annual)[0];
      const c = card(buildPrescriptiveCards(s, pre()), "regime")!;
      if (melhor === regime) {
        expect(c.severity).toBe("ok");
        expect(c.actions).toEqual([]);
        expect(c.metricValue).toBe(`${reg[regime].effective.toFixed(1)}%`);
      } else {
        const economia = reg[regime].annual - reg[melhor].annual;
        const pct = (economia / reg[regime].annual) * 100;
        expect(c.cause).toContain(`economizaria ${fmtBRL(economia)}/ano (${pct.toFixed(1)}%`);
        expect(c.severity).toBe(pct >= 15 ? "danger" : pct >= 5 ? "warn" : "info");
        const sw = action(c, "switch_regime");
        expect(sw.asSimulatorParams).toEqual({ regimeOverride: melhor });
        expect(sw.apply(s).tax.regime).toBe(melhor);
      }
    }
  });
});

describe("card 8 — custos fixos altos", () => {
  it("fixos 60% da RL → danger citando as 3 maiores; cortes de 10% e 20%", () => {
    const s = semFolha();
    const c = card(
      buildPrescriptiveCards(s, pre({ dre: { custosFixos: m12(60_000) } })),
      "custos_fixos",
    )!;
    expect(c.metricValue).toBe("60.0%");
    expect(c.cause).toContain("Aluguel, Software, Contabilidade");
    const r10 = action(c, "cut_top_10").apply(s);
    expect([val(r10, "alu"), val(r10, "sw"), val(r10, "cont"), val(r10, "lim")]).toEqual([
      7200, 2700, 1350, 500,
    ]);
    const r20 = action(c, "cut_top_20").apply(s);
    expect(val(r20, "alu")).toBeCloseTo(6400, 10);
  });
});

describe("card 9 — eficiência operacional", () => {
  const ef = (o: PreOver) => card(buildPrescriptiveCards(semFolha(), pre(o)), "eficiencia_op")!;

  it("EBITDA ≤ 0 → danger, métrica sem %", () => {
    const c = ef({ dre: { ebitda: m12(-1000) } });
    expect(c.severity).toBe("danger");
    expect(c.problem).toMatch(/EBITDA negativo/);
    expect(c.metricValue).toBe("— · 1.00×");
    expect(c.cause).toMatch(/Sem EBITDA/);
  });

  it("conversão FCF/EBITDA 25% → danger", () => {
    const c = ef({ ind: { fcf: 60_000 } }); // 60k/240k
    expect(c.severity).toBe("danger");
    expect(c.problem).toBe("Baixíssima conversão de EBITDA em caixa");
    expect(c.metricValue).toBe("25% · 1.00×");
  });

  it("conversão 50% → warn; ações de PMR e ativos", () => {
    const s = semFolha();
    const c = card(buildPrescriptiveCards(s, pre({ ind: { fcf: 120_000 } })), "eficiencia_op")!;
    expect(c.severity).toBe("warn");
    expect(c.cause).toMatch(/não está virando caixa/);
    const pmr = action(c, "ef_reduce_pmr");
    expect(pmr.title).toContain("30d → 20d");
    expect(pmr.apply(s).revenue.pmr).toBe(20);
    expect(action(c, "ef_reduce_assets").apply(s).capital.ativoTotal).toBeCloseTo(900_000, 6);
  });

  it("conversão boa mas giro do ativo < 0,5 → warn por capital ocioso", () => {
    const c = ef({ ind: { giroAtivo: 0.3 } });
    expect(c.severity).toBe("warn");
    expect(c.problem).toMatch(/Giro do ativo baixo/);
    expect(c.cause).toMatch(/Ativos pouco produtivos/);
    expect(c.actions).toHaveLength(2);
  });
});

describe("buildPrescriptiveCards / snapshot sem pré-computado", () => {
  it("usa o modelo memoizado do estado", () => {
    const s = createState();
    const cards = buildPrescriptiveCards(s);
    const m = getFinancialModelCached(s);
    const explicit = buildPrescriptiveCards(s, { dre: m.dre, tax: m.tax, ind: m.ind, cf: m.cf });
    expect(cards.map((c) => [c.id, c.severity, c.metricValue])).toEqual(
      explicit.map((c) => [c.id, c.severity, c.metricValue]),
    );
  });

  it("snapshot consolida DRE, indicadores, caixa e impostos", () => {
    const sn = snapshot(semFolha(), pre());
    expect(sn.receitaBruta).toBe(1_320_000);
    expect(sn.lucroLiquido).toBe(120_000);
    expect(sn.ebitda).toBe(240_000);
    expect(sn.margemLiquida).toBe(10);
    expect(sn.coberturaJuros).toBe(5);
    expect(sn.saldoCaixaFinal).toBe(80_000);
    expect(sn.piorMesCaixa).toBe(20_000);
    expect(sn.impostosAno).toBe(50_000);
    expect(sn.fcf).toBe(200_000);
  });

  it("snapshot sem pior mês usa 0; sem `pre` usa o modelo do estado", () => {
    const sn = snapshot(semFolha(), pre({ cf: { totais: { saldoFinal: 1, pioresMes: null } } }));
    expect(sn.piorMesCaixa).toBe(0);

    const s = createState();
    const m = getFinancialModelCached(s);
    const auto = snapshot(s);
    expect(auto.impostosAno).toBe(m.tax.annual);
    expect(auto.saldoCaixaFinal).toBe(m.cf.totais.saldoFinal);
    expect(auto.receitaBruta).toBeCloseTo(
      m.dre.receitaBruta.reduce((a, b) => a + b, 0),
      6,
    );
  });
});
