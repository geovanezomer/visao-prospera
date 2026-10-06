/**
 * Simulador — alavancas ainda não cobertas: pró-labore, distribuição de
 * lucros (SSOT em distribuicaoRealizada), quitação de dívida existente,
 * direcionador explícito de custo e contagem de alavancas ativas.
 */
import { describe, expect, it } from "vitest";
import { applySimulator, costDriver, countActiveLevers, DEFAULT_SIM } from "../simulator";
import type { SimulatorParams } from "../simulator";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine, DebtContract } from "../types";

const line = (over: Partial<CostLine>): CostLine =>
  ({
    id: "x",
    label: "X",
    category: "despesa_administrativa",
    values: m12(1_000),
    fixed: true,
    ...over,
  }) as CostLine;

const sim = (p: Partial<SimulatorParams>): SimulatorParams => ({ ...DEFAULT_SIM, ...p });

const contrato = (id: string, saldo: number): DebtContract => ({
  id,
  credor: id,
  saldoDevedor: saldo,
  taxaAA: 18,
  sistema: "price",
  prazoMeses: 24,
});

const base = (): AppState =>
  createState({
    costs: [
      line({ id: "pro", label: "Pró-labore (sócios)", values: m12(10_000) }),
      line({
        id: "sal",
        label: "Salários administrativos",
        encargosAuto: true,
        values: m12(5_000),
      }),
      line({ id: "alu", label: "Aluguel", values: m12(2_500) }),
      line({ id: "jur", label: "Juros de empréstimos", category: "financeiro", values: m12(600) }),
      line({
        id: "__debt_contracts_juros",
        label: "Encargos de contratos",
        category: "financeiro",
        values: m12(400),
      }),
      line({ id: "tar", label: "Tarifas bancárias", category: "financeiro", values: m12(100) }),
    ],
    capital: { debtContracts: [contrato("a", 10_000), contrato("b", 30_000)] },
    distribuicaoRealizada: { values: m12(1_000), fixed: false },
  });

const v0 = (s: AppState, id: string) => s.costs.find((c) => c.id === id)!.values[0];

describe("alavanca de pró-labore", () => {
  it("escala só as linhas de pró-labore (afeta DRE); demais despesas intactas", () => {
    const s = applySimulator(base(), sim({ prolaboreDeltaPct: -20 }));
    expect(v0(s, "pro")).toBeCloseTo(8_000, 9); // 10.000 × 0,8
    expect(v0(s, "sal")).toBe(5_000);
    expect(v0(s, "alu")).toBe(2_500);
  });

  it("compõe multiplicativamente com a alavanca de folha (pró-labore é subconjunto da folha)", () => {
    const s = applySimulator(base(), sim({ payrollDeltaPct: 10, prolaboreDeltaPct: -20 }));
    expect(v0(s, "pro")).toBeCloseTo(10_000 * 1.1 * 0.8, 9); // 8.800
    expect(v0(s, "sal")).toBeCloseTo(5_500, 9); // só folha
    expect(v0(s, "alu")).toBe(2_500);
  });
});

describe("alavanca de distribuição de lucros (não afeta DRE)", () => {
  it("escala distribuicaoRealizada e não toca custos; estado base não é mutado", () => {
    const b = base();
    const s = applySimulator(b, sim({ distribuicaoDeltaPct: 50 }));
    expect(s.distribuicaoRealizada!.values).toEqual(m12(1_500));
    expect(s.costs.map((c) => c.values[0])).toEqual(b.costs.map((c) => c.values[0]));
    expect(b.distribuicaoRealizada!.values).toEqual(m12(1_000));
  });

  it("redução maior que 100% não gera distribuição negativa", () => {
    const s = applySimulator(base(), sim({ distribuicaoDeltaPct: -150 }));
    expect(s.distribuicaoRealizada!.values).toEqual(m12(0));
  });

  it("sem distribuicaoRealizada (legado) escala cashflow.dividendos", () => {
    const b = { ...base(), distribuicaoRealizada: undefined } as AppState;
    b.cashflow = { ...b.cashflow, dividendos: m12(2_000) };
    const s = applySimulator(b, sim({ distribuicaoDeltaPct: -25 }));
    expect(s.cashflow.dividendos).toEqual(m12(1_500));
    expect(b.cashflow.dividendos).toEqual(m12(2_000));
  });
});

describe("quitação de dívida existente", () => {
  it("50%: saldos caem pela metade, juros na mesma proporção e o pagamento sai no mês 1", () => {
    const s = applySimulator(base(), sim({ debtPaydownPct: 50 }));
    expect(s.capital.debtContracts!.map((c) => c.saldoDevedor)).toEqual([5_000, 15_000]);
    // Pago = 50% × (10.000 + 30.000) = 20.000, evento único em janeiro
    expect(s.cashflow.amortizacaoExtraordinaria![0]).toBe(20_000);
    expect(s.cashflow.amortizacaoExtraordinaria!.slice(1)).toEqual(new Array(11).fill(0));
    // Linhas de juros (label "juros" ou id de contratos) caem 50%; tarifa não é juros
    expect(v0(s, "jur")).toBe(300);
    expect(v0(s, "__debt_contracts_juros")).toBe(200);
    expect(v0(s, "tar")).toBe(100);
  });

  it("percentual acima de 100% é limitado à quitação total", () => {
    const s = applySimulator(base(), sim({ debtPaydownPct: 150 }));
    expect(s.capital.debtContracts!.every((c) => c.saldoDevedor === 0)).toBe(true);
    expect(s.cashflow.amortizacaoExtraordinaria![0]).toBe(40_000);
    expect(v0(s, "jur")).toBe(0);
  });
});

describe("costDriver", () => {
  it("direcionador explícito prevalece; senão: comissões → receita, CPV → volume, demais → fixo", () => {
    expect(costDriver(line({ driver: "receita", category: "fixo" }))).toBe("receita");
    expect(costDriver(line({ driver: "volume" }))).toBe("volume");
    expect(costDriver(line({ category: "custo_vendas", label: "Mercadoria" }))).toBe("volume");
    expect(costDriver(line({ category: "despesa_comercial", label: "Comissões" }))).toBe("receita");
    expect(costDriver(line({ category: "despesa_administrativa" }))).toBe("fixo");
    // MO CLT no CPV marcada como fixa não acompanha o volume
    expect(costDriver(line({ category: "direto_venda", comportamento: "fixo" }))).toBe("fixo");
  });
});

describe("countActiveLevers", () => {
  it("cenário neutro → 0", () => {
    expect(countActiveLevers(DEFAULT_SIM)).toBe(0);
  });

  it("conta cada alavanca ativa, inclusive as que dependem de um parâmetro auxiliar", () => {
    const todas = sim({
      priceDeltaPct: 5,
      volumeDeltaPct: 5,
      priceElasticity: 1,
      cpvDeltaPct: 5,
      payrollDeltaPct: 5,
      prolaboreDeltaPct: 5,
      distribuicaoDeltaPct: 5,
      fixedCutPct: 5,
      pmrDeltaDays: -5,
      pmpDeltaDays: 5,
      antecipPctAm: 1,
      inadimplenciaDeltaPp: 1,
      loanPrincipal: 1_000,
      debtPaydownPct: 10,
      kdDeltaPp: 1,
      regimeOverride: "real",
      mercadoCrescimentoPct: 3,
      participacaoDeltaPp: 1,
      mercadoTamanho: 1_000_000,
      precoConcorrenciaPct: 2,
      elasticidadeParticipacao: 1,
      ipcaPct: 4,
      cambioPct: 10,
      cpvImportadoPct: 30,
      selicDeltaPp: 1,
    });
    expect(countActiveLevers(todas)).toBe(22);
    // Elasticidade sem variação de preço, participação sem mercado, concorrência
    // sem elasticidade e câmbio sem parcela importada não contam.
    expect(
      countActiveLevers(
        sim({
          priceElasticity: 2,
          participacaoDeltaPp: 3,
          precoConcorrenciaPct: 5,
          cambioPct: 10,
        }),
      ),
    ).toBe(0);
  });
});
