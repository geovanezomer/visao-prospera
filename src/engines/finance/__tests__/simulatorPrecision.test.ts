// Regressões da auditoria de precisão do simulador (B1–B14).
import { describe, expect, it } from "vitest";
import { createState, m12 } from "./helpers";
import { applySimulator, computeSimView, DEFAULT_SIM } from "../simulator";
import { buildCashFlow, shiftByDaysSplit } from "../cashflow";
import { buildDRE } from "../dre";
import { sumContractSaldos } from "../debtContracts";
import { effectiveMonthValues } from "../costs";
import { projectCashflow } from "../cashflowProjection";
import type { AppState, DebtContract } from "../types";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const contrato = (saldo: number, taxaAA = 24): DebtContract => ({
  id: "c1",
  credor: "Banco",
  saldoDevedor: saldo,
  taxaAA,
  sistema: "price",
  prazoMeses: 24,
  tipoCredor: "banco",
});
const base = (over: Partial<AppState> = {}) =>
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
        id: "mo",
        label: "Mão de obra produção",
        category: "custo_vendas",
        values: m12(10_000),
        fixed: false,
        comportamento: "fixo",
      },
      {
        id: "com",
        label: "Comissões de vendas",
        category: "despesa_comercial",
        values: m12(5_000),
        fixed: false,
      },
      {
        id: "como",
        label: "Comodato de máquinas",
        category: "despesa_administrativa",
        values: m12(2_000),
        fixed: false,
      },
      {
        id: "sal",
        label: "Salários",
        category: "despesa_administrativa",
        values: m12(20_000),
        fixed: false,
      },
    ],
    ...over,
  } as never);

describe("simulador — precisão", () => {
  it("B1: quitar 50% reduz o saldo dos contratos uma única vez", () => {
    const s = base({
      capital: { ...createState().capital, debtContracts: [contrato(100_000)] },
    } as never);
    const sim = applySimulator(s, { ...DEFAULT_SIM, debtPaydownPct: 50 });
    expect(sumContractSaldos(sim.capital.debtContracts)).toBeCloseTo(50_000, 2);
    expect(sim.cashflow.amortizacaoExtraordinaria?.[0]).toBeCloseTo(50_000, 2);
  });

  it("B2: kd +1 p.p. soma 1% da dívida ao ano, mesmo com kd = 0", () => {
    const s = base({
      capital: { ...createState().capital, kd: 0, debtContracts: [contrato(120_000)] },
    } as never);
    const sim = applySimulator(s, { ...DEFAULT_SIM, kdDeltaPp: 1 });
    const linha = sim.costs.find((c) => c.id === "sim_kd")!;
    expect(sum(linha.values)).toBeCloseTo(1_200, 2);
    const semDivida = applySimulator(base(), { ...DEFAULT_SIM, kdDeltaPp: 3 });
    expect(semDivida.costs.some((c) => c.id === "sim_kd")).toBe(false);
  });

  it("B3: contrato do empréstimo simulado usa taxa efetiva anual", () => {
    const sim = applySimulator(base(), {
      ...DEFAULT_SIM,
      loanPrincipal: 100_000,
      loanTermMonths: 24,
      loanRatePctAm: 2,
    });
    const c = sim.capital.debtContracts!.find((d) => d.credor === "Simulação")!;
    expect(c.taxaAA).toBeCloseTo((Math.pow(1.02, 12) - 1) * 100, 6);
  });

  it("B4: prazo fracionário desloca o caixa proporcionalmente", () => {
    const r = shiftByDaysSplit(m12(100), 45);
    expect(r.inAno[1]).toBeCloseTo(50, 6);
    expect(r.inAno[2]).toBeCloseTo(100, 6);
    const s = base({ revenue: { ...base().revenue, pmr: 40 } } as never);
    const cf0 = buildCashFlow(s);
    const cf1 = buildCashFlow(applySimulator(s, { ...DEFAULT_SIM, pmrDeltaDays: -10 }));
    expect(cf1.saldoFinal[11]).toBeGreaterThan(cf0.saldoFinal[11] + 1_000);
  });

  it("B5: antecipação libera caixa e custa proporcional ao prazo + IOF", () => {
    const s = base();
    const sim = applySimulator(s, { ...DEFAULT_SIM, antecipPctAm: 2 });
    const custo = sum(sim.costs.find((c) => c.id === "sim_antecip")!.values);
    // 50% × 1,2 mi × (2% × 1 mês + 0,38% + 0,0082% × 30)
    expect(custo).toBeCloseTo(0.5 * 1_200_000 * (0.02 + 0.0038 + 0.000082 * 30), 0);
    expect(sim.revenue.pmr).toBeCloseTo(15, 6);
    expect(buildCashFlow(sim).recebimentos[0]).toBeGreaterThan(buildCashFlow(s).recebimentos[0]);
  });

  it("B6: alavanca de PMR também desloca prazos mensais com sazonalidade", () => {
    const pmrMensal = [30, 30, 60, 60, 30, 30, 60, 60, 30, 30, 60, 60];
    const s = base({ revenue: { ...base().revenue, pmrMensal } } as never);
    const sim = applySimulator(s, { ...DEFAULT_SIM, pmrDeltaDays: -30 });
    expect(sim.revenue.pmrMensal?.[2]).toBe(30);
    expect(buildCashFlow(sim).saldoFinal[11]).toBeGreaterThan(buildCashFlow(s).saldoFinal[11]);
  });

  it("B7: elasticidade constante — E=2 e +30% de preço: receita ×1,3^(−1)", () => {
    const sim = applySimulator(base(), { ...DEFAULT_SIM, priceDeltaPct: 30, priceElasticity: 2 });
    expect(sum(sim.revenue.bruta) / 1_200_000).toBeCloseTo(Math.pow(1.3, -1), 4);
  });

  it("B8: volume respeita fixo/variável; preço mexe em comissões", () => {
    const vol = applySimulator(base(), { ...DEFAULT_SIM, volumeDeltaPct: 20 });
    expect(vol.costs.find((c) => c.id === "cmv")!.values[0]).toBeCloseTo(48_000, 6);
    expect(vol.costs.find((c) => c.id === "mo")!.values[0]).toBe(10_000);
    const preco = applySimulator(base(), { ...DEFAULT_SIM, priceDeltaPct: 10 });
    expect(preco.costs.find((c) => c.id === "com")!.values[0]).toBeCloseTo(5_500, 6);
    expect(preco.costs.find((c) => c.id === "cmv")!.values[0]).toBe(40_000);
  });

  it("B9: folha não pega 'Comodato'", () => {
    const sim = applySimulator(base(), { ...DEFAULT_SIM, payrollDeltaPct: -20 });
    expect(sim.costs.find((c) => c.id === "como")!.values[0]).toBe(2_000);
    expect(sim.costs.find((c) => c.id === "sal")!.values[0]).toBeCloseTo(16_000, 6);
  });

  it("B10: projeção plurianual não repete captação nem quitação do ano-base", () => {
    const s = base({
      capital: { ...createState().capital, debtContracts: [contrato(100_000)] },
    } as never);
    const sim = applySimulator(s, { ...DEFAULT_SIM, loanPrincipal: 120_000, debtPaydownPct: 50 });
    const proj = projectCashflow(sim, 24);
    const m13 = proj.cenarios[0].meses[12];
    expect(m13.financiamento).toBeLessThan(50_000);
  });

  it("B12: CPP patronal lançada à parte zera ao migrar para o Simples (exceto Anexo IV)", () => {
    const inss = {
      id: "inss",
      label: "INSS patronal",
      category: "despesa_administrativa" as const,
      values: m12(4_000),
      fixed: false,
      cppPatronal: true,
    };
    const s = base({ costs: [...base().costs, inss] } as never);
    const total = (st: AppState) => sum(st.costs.find((c) => c.id === "inss")!.values);
    expect(total(applySimulator(s, { ...DEFAULT_SIM, regimeOverride: "simples" }))).toBe(0);
    expect(total(applySimulator(s, { ...DEFAULT_SIM, regimeOverride: "real" }))).toBe(48_000);
    // Estado-base nunca é alterado (realizado prevalece).
    expect(sum(effectiveMonthValues(inss, "simples"))).toBe(48_000);
    const anexoIV = base({
      costs: [...base().costs, inss],
      tax: { ...base().tax, simplesAnexo: "IV" },
    } as never);
    expect(total(applySimulator(anexoIV, { ...DEFAULT_SIM, regimeOverride: "simples" }))).toBe(
      48_000,
    );
  });

  it("B14: despesas financeiras da visão do simulador = DRE", () => {
    const s = base();
    const sim = applySimulator(s, { ...DEFAULT_SIM, loanPrincipal: 50_000 });
    const v = computeSimView(sim);
    expect(v.despesasFinanceiras).toBeCloseTo(
      sum(buildDRE(sim, "presumido").dre.custosFinanceirosTotal),
      2,
    );
  });
});
