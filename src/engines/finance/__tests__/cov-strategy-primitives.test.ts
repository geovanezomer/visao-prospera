// Primitivas de alavanca financeira — funções puras (state, params) ⇒ newState.
// Valores esperados calculados à mão (tabela PRICE, rescisão CLT, escalas).

import { describe, it, expect } from "vitest";
import {
  LEVER_REGISTRY,
  addLoan,
  adjustRevenue,
  cloneCosts,
  dismissWithSeverance,
  laborCltLinesTotal,
  listLevers,
  payDownDebt,
  reduceLaborByPositions,
  scaleAssetTotal,
  scaleCategory,
  scaleCostLines,
  scaleLaborLines,
  scaleLine,
  setPmp,
  setPmr,
  severanceCostPerPosition,
  switchRegime,
  topNFixedLines,
  type LeverId,
} from "../levers/primitives";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine, DebtContract } from "../types";

const line = (
  id: string,
  label: string,
  category: CostLine["category"],
  v: number,
  extra: Partial<CostLine> = {},
): CostLine => ({ id, label, category, values: m12(v), fixed: false, ...extra });

const contrato = (id: string, saldo: number): DebtContract => ({
  id,
  credor: "Banco",
  saldoDevedor: saldo,
  taxaAA: 24,
  sistema: "price",
  prazoMeses: 24,
});

/** Estado enxuto e controlado: receita 100k/mês, custos conhecidos. */
function base(costs: CostLine[] = [], over: Partial<AppState> = {}): AppState {
  const s = createState({
    revenue: { bruta: m12(100_000), pmr: 30, pmp: 30 },
    capital: { ativoTotal: 500_000 },
  } as never);
  return { ...s, costs, ...over };
}

const total = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

describe("helpers de baixo nível", () => {
  it("cloneCosts faz cópia profunda dos arrays de valores", () => {
    const orig = [line("a", "Aluguel", "fixo", 100)];
    const c = cloneCosts(orig);
    c[0].values[0] = 999;
    expect(orig[0].values[0]).toBe(100);
    expect(c[0]).not.toBe(orig[0]);
  });

  it("topNFixedLines ordena despesas administrativas/fixas por total anual (desc)", () => {
    const s = base([
      line("alu", "Aluguel", "fixo", 3000),
      line("sw", "Software", "despesa_administrativa", 500),
      line("cmv", "Mercadoria", "custo_vendas", 50_000), // não é fixo
      line("mkt", "Marketing", "despesa_comercial", 9000), // não é fixo
      // Salário 2.000 com encargos de 70% → 3.400/mês (acima do aluguel)
      line("sal", "Salários", "despesa_administrativa", 2000, {
        encargosAuto: true,
        encargosPct: 70,
      }),
    ]);
    expect(topNFixedLines(s, 2).map((l) => l.id)).toEqual(["sal", "alu"]);
    expect(topNFixedLines(s, 10).map((l) => l.id)).toEqual(["sal", "alu", "sw"]);
  });

  it("laborCltLinesTotal: linha fixa usa o valor mensal; variável usa média anual", () => {
    const vals = [...m12(1000).slice(0, 6), ...m12(3000).slice(0, 6)]; // média 2.000
    const s = base([
      line("sal", "Salários CLT", "despesa_administrativa", 5000, { fixed: true }),
      { ...line("mo", "Mão de obra produção", "custo_vendas", 0), values: vals },
      line("jur", "Juros folha de pagamento antecipada", "financeiro", 777), // financeiro fora
      line("alu", "Aluguel", "fixo", 4000),
    ]);
    const r = laborCltLinesTotal(s);
    expect(r.lines.map((l) => l.id)).toEqual(["sal", "mo"]);
    expect(r.totalMensal).toBeCloseTo(7000, 10);
  });

  it("severanceCostPerPosition: aviso + 13º + férias·4/3 + multa 40% do FGTS", () => {
    // Salário 3.000, 24 meses:
    //   aviso 3.000 + 13º 3.000 + férias+1/3 4.000
    //   + FGTS: 3.000 × 8% × 24 × 40% = 2.304  → 12.304
    expect(severanceCostPerPosition(3000)).toBeCloseTo(12_304, 10);
    // 12 meses: multa = 3.000 × 0,08 × 12 × 0,4 = 1.152 → 11.152
    expect(severanceCostPerPosition(3000, 12)).toBeCloseTo(11_152, 10);
    expect(severanceCostPerPosition(0)).toBe(0);
  });
});

describe("primitivas de custo e receita", () => {
  const costs = [
    line("cmv", "Mercadoria", "custo_vendas", 10_000),
    line("dir", "Insumo direto", "direto_venda", 2000),
    line("alu", "Aluguel", "fixo", 3000),
    line("adm", "Contabilidade", "despesa_administrativa", 1000),
    line("mkt", "Marketing", "variavel", 800),
    line("com", "Comissões", "despesa_comercial", 600),
    line("iof", "IOF", "financeiro", 100),
  ];

  it("scaleLine escala só a linha indicada e não muta o original", () => {
    const s = base(costs);
    const r = scaleLine(s, "alu", 0.5);
    expect(r.costs.find((c) => c.id === "alu")!.values[0]).toBe(1500);
    expect(r.costs.find((c) => c.id === "adm")!.values[0]).toBe(1000);
    expect(s.costs.find((c) => c.id === "alu")!.values[0]).toBe(3000);
  });

  it("scaleCategory('custo_vendas') também escala direto_venda (ambas são CPV)", () => {
    const r = scaleCategory(base(costs), "custo_vendas", 0.9);
    const v = (id: string) => r.costs.find((c) => c.id === id)!.values[0];
    expect(v("cmv")).toBeCloseTo(9000, 10);
    expect(v("dir")).toBeCloseTo(1800, 10);
    expect(v("alu")).toBe(3000);
  });

  it("scaleCategory respeita aliases legados fixo↔administrativa e variavel↔comercial", () => {
    const v = (r: AppState, id: string) => r.costs.find((c) => c.id === id)!.values[0];
    const fixo = scaleCategory(base(costs), "fixo", 0.8);
    expect(v(fixo, "alu")).toBeCloseTo(2400, 10);
    expect(v(fixo, "adm")).toBeCloseTo(800, 10);
    expect(v(fixo, "mkt")).toBe(800);

    const com = scaleCategory(base(costs), "despesa_comercial", 0.5);
    expect(v(com, "mkt")).toBeCloseTo(400, 10);
    expect(v(com, "com")).toBeCloseTo(300, 10);

    // Sem alias: só a própria categoria
    const fin = scaleCategory(base(costs), "financeiro", 0.7);
    expect(v(fin, "iof")).toBeCloseTo(70, 10);
    expect(v(fin, "cmv")).toBe(10_000);
  });

  it("scaleCostLines escala o conjunto de ids", () => {
    const r = scaleCostLines(base(costs), new Set(["alu", "iof"]), 2);
    expect(r.costs.map((c) => c.values[0])).toEqual([10_000, 2000, 6000, 1000, 800, 600, 200]);
  });

  it("adjustRevenue multiplica a receita bruta mês a mês", () => {
    const r = adjustRevenue(base(), 1.05);
    expect(total(r.revenue.bruta)).toBeCloseTo(1_260_000, 6);
  });

  it("setPmr/setPmp não aceitam prazos negativos", () => {
    expect(setPmr(base(), 45).revenue.pmr).toBe(45);
    expect(setPmr(base(), -10).revenue.pmr).toBe(0);
    expect(setPmp(base(), 60).revenue.pmp).toBe(60);
    expect(setPmp(base(), -1).revenue.pmp).toBe(0);
  });

  it("switchRegime e scaleAssetTotal", () => {
    expect(switchRegime(base(), "real").tax.regime).toBe("real");
    expect(scaleAssetTotal(base(), 0.8).capital.ativoTotal).toBe(400_000);
  });
});

describe("addLoan — tabela PRICE", () => {
  it("R$ 100 mil a 2% a.m. em 12×: PMT ≈ 9.455,96; juros totais ≈ 13.471,53", () => {
    // PMT = 100.000 × 0,02 / (1 − 1,02⁻¹²) = 9.455,96
    // Σ amortização = 100.000 (quitado em 12 meses dentro do horizonte)
    // Σ juros = 12 × PMT − 100.000 = 13.471,53
    const s = base([line("alu", "Aluguel", "fixo", 3000)]);
    const r = addLoan(s, 100_000, 2, 12, 0);
    const juros = r.costs.find((c) => /juros/i.test(c.label))!;
    expect(juros.label).toBe("Juros sobre empréstimos");
    expect(juros.category).toBe("financeiro");
    expect(juros.id.startsWith("juros_")).toBe(true);
    expect(juros.values[0]).toBeCloseTo(2000, 6); // 1º mês: saldo × i
    expect(r.cashflow.amortizacoes[0]).toBeCloseTo(9455.96 - 2000, 1);
    expect(total(r.cashflow.amortizacoes)).toBeCloseTo(100_000, 6);
    expect(total(juros.values)).toBeCloseTo(13_471.53, 1);
    // Parcela constante: juros + amortização = PMT em todos os meses
    for (let k = 0; k < 12; k++)
      expect(juros.values[k] + r.cashflow.amortizacoes[k]).toBeCloseTo(9455.96, 1);
    expect(r.cashflow.emprestimosCaptados[0]).toBe(100_000);
    expect(total(r.cashflow.emprestimosCaptados)).toBe(100_000);
    // Imutabilidade
    expect(total(s.cashflow.amortizacoes)).toBe(0);
    expect(s.costs).toHaveLength(1);
  });

  it("taxa zero: amortização linear P/n, sem juros", () => {
    const r = addLoan(base(), 12_000, 0, 6, 0);
    expect(r.cashflow.amortizacoes.slice(0, 6)).toEqual(m12(2000).slice(0, 6));
    expect(r.cashflow.amortizacoes.slice(6)).toEqual(m12(0).slice(6));
    const juros = r.costs.find((c) => /juros/i.test(c.label))!;
    expect(total(juros.values)).toBe(0);
  });

  it("prazo além do horizonte: só os meses dentro do ano são lançados", () => {
    // Captação no mês 7 (idx 6), 24 parcelas → apenas idx 6..11 no ano
    const r = addLoan(base(), 50_000, 1, 24, 6);
    expect(r.cashflow.emprestimosCaptados[6]).toBe(50_000);
    expect(r.cashflow.amortizacoes.slice(0, 6)).toEqual(m12(0).slice(0, 6));
    const juros = r.costs.find((c) => /juros/i.test(c.label))!;
    expect(juros.values[6]).toBeCloseTo(500, 6); // 50.000 × 1%
    // Amortizado no ano < principal (restam 18 parcelas)
    const amortAno = total(r.cashflow.amortizacoes);
    expect(amortAno).toBeGreaterThan(0);
    expect(amortAno).toBeLessThan(50_000);
  });

  it("reaproveita linha de juros existente (desfixando) e soma os juros", () => {
    const s = base([line("jur", "Juros bancários", "financeiro", 300, { fixed: true })]);
    const r = addLoan(s, 10_000, 3, 12, 0);
    const j = r.costs.find((c) => c.id === "jur")!;
    expect(r.costs).toHaveLength(1);
    expect(j.fixed).toBe(false);
    expect(j.values[0]).toBeCloseTo(300 + 300, 6); // 300 já existentes + 10.000 × 3%
    expect(s.costs[0].values[0]).toBe(300);
    expect(s.costs[0].fixed).toBe(true);
  });
});

describe("payDownDebt", () => {
  const comDivida = () => {
    const s = base([
      line("jur", "Juros de financiamento", "financeiro", 1000),
      line("iof", "IOF", "financeiro", 100),
      line("alu", "Aluguel com juros embutidos", "fixo", 3000), // não financeiro
    ]);
    return {
      ...s,
      capital: { ...s.capital, debtContracts: [contrato("a", 60_000), contrato("b", 40_000)] },
    };
  };

  it("quitar 30%: saldos −30%, juros −30% e saída de caixa de 30% da dívida", () => {
    const s = comDivida();
    const r = payDownDebt(s, 0.3);
    expect(r.capital.debtContracts!.map((c) => c.saldoDevedor)).toEqual([42_000, 28_000]);
    const v = (id: string) => r.costs.find((c) => c.id === id)!.values[0];
    expect(v("jur")).toBeCloseTo(700, 10);
    expect(v("iof")).toBe(100); // sem "juros" no rótulo
    expect(v("alu")).toBe(3000); // não financeiro
    // Caixa usado = 100.000 × 30% = 30.000 (saída no mês 1)
    expect(r.cashflow.amortizacoes[0]).toBeCloseTo(30_000, 6);
    expect(s.capital.debtContracts![0].saldoDevedor).toBe(60_000);
  });

  it("percentual é limitado a [0, 1]", () => {
    const s = comDivida();
    const tudo = payDownDebt(s, 1.5);
    expect(tudo.capital.debtContracts!.every((c) => c.saldoDevedor === 0)).toBe(true);
    expect(tudo.cashflow.amortizacoes[0]).toBeCloseTo(100_000, 6);
    const nada = payDownDebt(s, -0.2);
    expect(nada.capital.debtContracts!.map((c) => c.saldoDevedor)).toEqual([60_000, 40_000]);
    expect(nada.cashflow.amortizacoes[0]).toBe(0);
  });

  it("sem contratos: nenhum caixa é consumido", () => {
    const s = base();
    const r = payDownDebt({ ...s, capital: { ...s.capital, debtContracts: undefined } }, 0.5);
    expect(r.capital.debtContracts).toEqual([]);
    expect(r.cashflow.amortizacoes[0]).toBe(0);
  });
});

describe("folha: redução, rescisão e escala", () => {
  const folha = () =>
    base([
      line("sal", "Salários", "despesa_administrativa", 6000),
      line("mo", "Mão de obra", "custo_vendas", 4000),
      line("alu", "Aluguel", "fixo", 3000),
    ]);

  it("reduceLaborByPositions: corte de 2 × 2.500 sobre folha de 10.000 → fator 0,5", () => {
    const r = reduceLaborByPositions(folha(), 2, 2500);
    const v = (id: string) => r.costs.find((c) => c.id === id)!.values[0];
    expect(v("sal")).toBeCloseTo(3000, 10);
    expect(v("mo")).toBeCloseTo(2000, 10);
    expect(v("alu")).toBe(3000);
  });

  it("reduceLaborByPositions: corte limitado à folha total (não fica negativo)", () => {
    const r = reduceLaborByPositions(folha(), 10, 5000);
    expect(r.costs.find((c) => c.id === "sal")!.values[0]).toBeCloseTo(0, 10);
    expect(r.costs.find((c) => c.id === "mo")!.values[0]).toBeCloseTo(0, 10);
  });

  it("reduceLaborByPositions: sem folha devolve o mesmo estado", () => {
    const s = base([line("alu", "Aluguel", "fixo", 3000)]);
    expect(reduceLaborByPositions(s, 2, 1000)).toBe(s);
    const zerada = base([line("sal", "Salários", "fixo", 0)]);
    expect(reduceLaborByPositions(zerada, 2, 1000)).toBe(zerada);
  });

  it("dismissWithSeverance: rescisão one-shot no mês indicado + redução estrutural", () => {
    // 1 posição, salário 2.000: rescisão = 2.000 × (1 + 1 + 4/3 + 0,768) = 8.202,67
    const r = dismissWithSeverance(folha(), 1, 2000, 3);
    const resc = r.costs.find((c) => c.label === "Rescisões e indenizações (one-shot)")!;
    expect(resc.category).toBe("despesa_administrativa");
    expect(resc.fixed).toBe(false);
    expect(resc.values[3]).toBeCloseTo(severanceCostPerPosition(2000), 10);
    expect(resc.values[3]).toBeCloseTo(8202.6667, 3);
    expect(total(resc.values)).toBeCloseTo(resc.values[3], 10); // só um mês
    // Folha 10.000 − 2.000 → fator 0,8
    expect(r.costs.find((c) => c.id === "sal")!.values[0]).toBeCloseTo(4800, 10);
    // Não usa amortizações (bucket de principal de dívida)
    expect(total(r.cashflow.amortizacoes)).toBe(0);
  });

  it("dismissWithSeverance: mês fora da faixa é limitado a 0..11", () => {
    const tarde = dismissWithSeverance(folha(), 1, 1000, 40);
    expect(tarde.costs.at(-1)!.values[11]).toBeGreaterThan(0);
    const cedo = dismissWithSeverance(folha(), 1, 1000, -3);
    expect(cedo.costs.at(-1)!.values[0]).toBeGreaterThan(0);
  });

  it("dismissWithSeverance: posições ou salário ≤ 0 não alteram o estado", () => {
    const s = folha();
    expect(dismissWithSeverance(s, 0, 2000)).toBe(s);
    expect(dismissWithSeverance(s, 2, 0)).toBe(s);
  });

  it("scaleLaborLines: −5% só nas linhas de folha", () => {
    const r = scaleLaborLines(folha(), 0.95);
    expect(r.costs.map((c) => c.values[0])).toEqual([5700, 3800, 3000]);
  });
});

describe("LEVER_REGISTRY", () => {
  const s = () =>
    ({
      ...base([
        line("cmv", "Mercadoria", "custo_vendas", 10_000),
        line("sal", "Salários", "fixo", 5000),
      ]),
      capital: { ...base().capital, debtContracts: [contrato("a", 10_000)] },
    }) as AppState;

  const casos: Record<LeverId, [unknown, (r: AppState) => void]> = {
    scale_cost_line: [{ id: "cmv", factor: 0.5 }, (r) => expect(r.costs[0].values[0]).toBe(5000)],
    scale_cost_category: [
      { category: "custo_vendas", factor: 0.9 },
      (r) => expect(r.costs[0].values[0]).toBeCloseTo(9000, 10),
    ],
    set_pmr: [{ days: 10 }, (r) => expect(r.revenue.pmr).toBe(10)],
    set_pmp: [{ days: 50 }, (r) => expect(r.revenue.pmp).toBe(50)],
    adjust_revenue: [{ factor: 1.1 }, (r) => expect(r.revenue.bruta[0]).toBeCloseTo(110_000, 6)],
    add_loan: [
      // monthIdx omitido → default 0 via schema
      { principal: 12_000, taxaMensal: 0, prazoMeses: 12 },
      (r) => expect(r.cashflow.amortizacoes[0]).toBeCloseTo(1000, 10),
    ],
    pay_down_debt: [
      { pct: 0.5 },
      (r) => expect(r.capital.debtContracts![0].saldoDevedor).toBe(5000),
    ],
    switch_regime: [{ regime: "presumido" }, (r) => expect(r.tax.regime).toBe("presumido")],
    reduce_labor_by_positions: [
      { positions: 1, custoMedioPosicao: 1000 },
      (r) => expect(r.costs[1].values[0]).toBeCloseTo(4000, 10),
    ],
    dismiss_with_severance: [
      { positions: 1, salarioBase: 1000 },
      (r) => expect(r.costs.at(-1)!.values[0]).toBeCloseTo(severanceCostPerPosition(1000), 10),
    ],
    scale_labor_lines: [{ factor: 0.9 }, (r) => expect(r.costs[1].values[0]).toBeCloseTo(4500, 10)],
    scale_asset_total: [{ factor: 0.9 }, (r) => expect(r.capital.ativoTotal).toBe(450_000)],
  };

  it.each(Object.keys(casos) as LeverId[])("%s: schema valida e apply produz o efeito", (id) => {
    const [params, check] = casos[id];
    const lever = LEVER_REGISTRY[id];
    const parsed = lever.schema.parse(params);
    check((lever.apply as (st: AppState, p: unknown) => AppState)(s(), parsed));
  });

  it("schemas rejeitam parâmetros fora da faixa segura", () => {
    expect(LEVER_REGISTRY.pay_down_debt.schema.safeParse({ pct: 1.2 }).success).toBe(false);
    expect(LEVER_REGISTRY.set_pmr.schema.safeParse({ days: -5 }).success).toBe(false);
    expect(
      LEVER_REGISTRY.add_loan.schema.safeParse({ principal: 1000, taxaMensal: 1, prazoMeses: 13 })
        .success,
    ).toBe(false);
    expect(LEVER_REGISTRY.switch_regime.schema.safeParse({ regime: "mei" }).success).toBe(false);
  });

  it("add_loan e dismiss_with_severance aceitam monthIdx ausente no apply direto", () => {
    const r1 = LEVER_REGISTRY.add_loan.apply(s(), {
      principal: 1200,
      taxaMensal: 0,
      prazoMeses: 12,
    });
    expect(r1.cashflow.emprestimosCaptados[0]).toBe(1200);
    const r2 = LEVER_REGISTRY.dismiss_with_severance.apply(s(), { positions: 1, salarioBase: 500 });
    expect(r2.costs.at(-1)!.values[0]).toBeGreaterThan(0);
  });

  it("listLevers expõe todos os ids com descrição", () => {
    const l = listLevers();
    expect(l.map((x) => x.id)).toEqual(Object.keys(LEVER_REGISTRY));
    expect(l.every((x) => x.description.length > 10)).toBe(true);
  });
});
