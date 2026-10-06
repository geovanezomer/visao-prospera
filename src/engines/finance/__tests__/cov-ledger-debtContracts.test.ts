/**
 * Cronograma de contratos de dívida (Price × SAC) e SSOT da dívida onerosa.
 *
 * Convenção da engine: `taxaAA` é taxa EFETIVA anual; a mensal equivalente é
 * i_m = (1 + i_a)^(1/12) − 1. Para facilitar a conta à mão usamos
 * i_a = 1,01^12 − 1 ≈ 12,6825% a.a. ⇒ i_m = 1% a.m. exato.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateContracts,
  avgKdAnual,
  scheduleContract,
  splitDebtCPLPFromContracts,
  sumContractSaldos,
  totalDividaOnerosa,
  vencimentoLabel,
} from "../debtContracts";
import { createState } from "./helpers";
import type { DebtContract } from "../types";

const TAXA_1PCT_AM = (Math.pow(1.01, 12) - 1) * 100; // 12,6825...% a.a.

const mk = (over: Partial<DebtContract> = {}): DebtContract => ({
  id: "c1",
  credor: "Banco X",
  saldoDevedor: 10_000,
  taxaAA: TAXA_1PCT_AM,
  sistema: "price",
  prazoMeses: 12,
  ...over,
});

const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("scheduleContract — Tabela Price", () => {
  it("12 parcelas a 1% a.m.: PMT = PV·i/(1−(1+i)^−n) e quita o principal no ano", () => {
    // PMT = 10.000 × 0,01 / (1 − 1,01^−12) = 888,4879
    const pmt = (10_000 * 0.01) / (1 - Math.pow(1.01, -12));
    const s = scheduleContract(mk());
    expect(pmt).toBeCloseTo(888.4879, 3);
    expect(s.parcelaMes).toBeCloseTo(pmt, 6);
    // Mês 1: juros = 10.000 × 1% = 100; amortização = 888,49 − 100 = 788,49
    expect(s.juros[0]).toBeCloseTo(100, 6);
    expect(s.amort[0]).toBeCloseTo(788.4879, 3);
    // Mês 2: juros sobre o saldo 9.211,51 → 92,1151
    expect(s.juros[1]).toBeCloseTo((10_000 - 788.4879) * 0.01, 3);
    // Parcela constante (juros + amortização) em todos os meses
    for (let m = 0; m < 12; m++) expect(s.juros[m] + s.amort[m]).toBeCloseTo(pmt, 6);
    // Total amortizado = principal; juros totais = 12·PMT − PV = 661,85
    expect(s.totalAmortAno).toBeCloseTo(10_000, 6);
    expect(s.totalJurosAno).toBeCloseTo(12 * pmt - 10_000, 6);
    expect(s.totalJurosAno).toBeCloseTo(661.8546, 3);
  });

  it("prazo de 24 meses: no ano só amortiza parte; saldo restante = VP das 12 parcelas futuras", () => {
    // PMT24 = 10.000 × 0,01 / (1 − 1,01^−24) = 470,7347
    const pmt = (10_000 * 0.01) / (1 - Math.pow(1.01, -24));
    // Saldo após 12 parcelas = PMT × (1 − 1,01^−12) / 0,01 = 5.298,16
    const saldoRestante = (pmt * (1 - Math.pow(1.01, -12))) / 0.01;
    const s = scheduleContract(mk({ prazoMeses: 24 }));
    expect(s.parcelaMes).toBeCloseTo(470.7347, 3);
    expect(s.totalAmortAno).toBeCloseTo(10_000 - saldoRestante, 6);
    expect(s.totalAmortAno).toBeCloseTo(4701.8442, 3);
    // juros + amortização = 12 parcelas pagas
    expect(s.totalJurosAno + s.totalAmortAno).toBeCloseTo(12 * pmt, 6);
  });

  it("taxa zero: parcela = PV/n, sem juros", () => {
    const s = scheduleContract(mk({ taxaAA: 0, saldoDevedor: 6_000, prazoMeses: 6 }));
    expect(s.parcelaMes).toBe(1_000);
    expect(s.juros).toEqual(new Array(12).fill(0));
    expect(s.amort.slice(0, 6)).toEqual(new Array(6).fill(1_000));
    expect(s.amort.slice(6)).toEqual(new Array(6).fill(0));
    expect(s.totalAmortAno).toBe(6_000);
  });

  it("prazo 0 é tratado como 1 parcela (quita tudo no mês 1)", () => {
    const s = scheduleContract(mk({ prazoMeses: 0 }));
    // Mês 1: juros 100; amortização = saldo inteiro 10.000
    expect(s.juros[0]).toBeCloseTo(100, 6);
    expect(s.amort[0]).toBeCloseTo(10_000, 6);
    expect(soma(s.amort.slice(1))).toBe(0);
  });

  it("saldo zero ou negativo → cronograma vazio", () => {
    for (const saldo of [0, -500]) {
      const s = scheduleContract(mk({ saldoDevedor: saldo }));
      expect(s.parcelaMes).toBe(0);
      expect(s.totalJurosAno).toBe(0);
      expect(s.totalAmortAno).toBe(0);
      expect(s.juros).toHaveLength(12);
    }
  });
});

describe("scheduleContract — SAC", () => {
  it("amortização constante PV/n; juros decrescentes sobre o saldo", () => {
    const s = scheduleContract(mk({ sistema: "sac" }));
    const a = 10_000 / 12; // 833,33
    for (let m = 0; m < 12; m++) {
      expect(s.amort[m]).toBeCloseTo(a, 6);
      // juros_m = (PV − m·a) × 1%
      expect(s.juros[m]).toBeCloseTo((10_000 - m * a) * 0.01, 6);
    }
    // Σ juros = 1% × a × (12 + 11 + … + 1) = 0,01 × 833,33 × 78 = 650
    expect(s.totalJurosAno).toBeCloseTo(650, 6);
    expect(s.totalAmortAno).toBeCloseTo(10_000, 6);
    // Parcela representativa = 1ª parcela = a + PV·i = 933,33
    expect(s.parcelaMes).toBeCloseTo(933.3333, 3);
  });

  it("SAC em 48 meses: amortiza 12/48 = 25% do principal no ano", () => {
    const s = scheduleContract(mk({ sistema: "sac", saldoDevedor: 48_000, prazoMeses: 48 }));
    expect(s.totalAmortAno).toBeCloseTo(12_000, 6);
    // juros = 1% × 1.000 × (48 + 47 + … + 37) = 10 × 510 = 5.100
    expect(s.totalJurosAno).toBeCloseTo(5_100, 6);
  });
});

describe("aggregateContracts", () => {
  it("soma cronogramas, saldos, parcelas e captações dentro do ano", () => {
    const price = mk({ id: "p" });
    const sac = mk({ id: "s", sistema: "sac", mesCaptacao: 3, valorCaptado: 5_000 });
    const foraDoAno = mk({ id: "x", saldoDevedor: 0, mesCaptacao: 13, valorCaptado: 9_999 });
    const semValor = mk({ id: "y", saldoDevedor: 0, mesCaptacao: 4, valorCaptado: 0 });
    const ag = aggregateContracts([price, sac, foraDoAno, semValor]);
    const sP = scheduleContract(price);
    const sS = scheduleContract(sac);
    expect(ag.saldoTotal).toBe(20_000);
    expect(ag.juros[0]).toBeCloseTo(sP.juros[0] + sS.juros[0], 6); // 100 + 100
    expect(ag.totalJurosAno).toBeCloseTo(661.8546 + 650, 3);
    expect(ag.totalAmortAno).toBeCloseTo(20_000, 6);
    expect(ag.parcelaMesTotal).toBeCloseTo(888.4879 + 933.3333, 3);
    // Captação só no mês 3 (índice 2); mês 13 e valor 0 são ignorados
    expect(ag.captacao[2]).toBe(5_000);
    expect(ag.totalCaptacaoAno).toBe(5_000);
  });

  it("lista vazia → tudo zero", () => {
    const ag = aggregateContracts([]);
    expect(ag.saldoTotal).toBe(0);
    expect(ag.totalJurosAno).toBe(0);
    expect(ag.captacao).toEqual(new Array(12).fill(0));
  });
});

describe("vencimentoLabel", () => {
  it("soma o prazo ao mês de referência e formata Mmm/AAAA", () => {
    const ref = new Date(2026, 0, 15); // jan/2026
    expect(vencimentoLabel(14, ref)).toBe("Mar/2027");
    expect(vencimentoLabel(11, ref)).toBe("Dez/2026");
    // Prazo negativo é tratado como 0 (vence no próprio mês)
    expect(vencimentoLabel(-3, ref)).toBe("Jan/2026");
  });

  it("sem data de referência usa a data atual (determinístico pelo próprio relógio)", () => {
    const hoje = new Date();
    expect(vencimentoLabel(0)).toBe(vencimentoLabel(0, hoje));
  });
});

describe("SSOT da dívida onerosa (state.capital.debtContracts)", () => {
  const state = createState({
    capital: {
      debtContracts: [
        mk({ id: "cp", saldoDevedor: 30_000, taxaAA: 10, prazoMeses: 12 }),
        mk({ id: "lp", saldoDevedor: 10_000, taxaAA: 20, prazoMeses: 13 }),
        mk({ id: "neg", saldoDevedor: -1_000, taxaAA: 99, prazoMeses: 60 }),
      ],
    },
  });

  it("dívida total = Σ saldos positivos", () => {
    expect(totalDividaOnerosa(state)).toBe(40_000);
    expect(sumContractSaldos(state.capital.debtContracts)).toBe(40_000);
    expect(sumContractSaldos(undefined)).toBe(0);
  });

  it("split CP/LP: prazo ≤ 12 meses é circulante, > 12 é não circulante", () => {
    expect(splitDebtCPLPFromContracts(state)).toEqual({ cp: 30_000, lp: 10_000 });
  });

  it("Kd ponderado por saldo: (10%·30.000 + 20%·10.000)/40.000 = 12,5% (saldo ≤ 0 ignorado)", () => {
    expect(avgKdAnual(state)).toBeCloseTo(12.5, 10);
  });

  it("sem contratos → dívida, split e Kd zerados", () => {
    const vazio = createState({ capital: { debtContracts: [] } });
    expect(totalDividaOnerosa(vazio)).toBe(0);
    expect(splitDebtCPLPFromContracts(vazio)).toEqual({ cp: 0, lp: 0 });
    expect(avgKdAnual(vazio)).toBe(0);
    const semCapital = { ...vazio, capital: undefined } as unknown as typeof vazio;
    expect(totalDividaOnerosa(semCapital)).toBe(0);
    expect(avgKdAnual(semCapital)).toBe(0);
    expect(splitDebtCPLPFromContracts(semCapital)).toEqual({ cp: 0, lp: 0 });
  });
});
