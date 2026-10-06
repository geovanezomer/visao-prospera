import { describe, it, expect } from "vitest";
import {
  partitionMonthlyTaxByLag,
  computeImpostosPagarFechamento,
  LAG_DIAS_PADRAO,
  LAG_DIAS_SPLIT,
} from "../tax/impostosLag";
import type { MonthlyTax } from "../tax/shared";

const m12 = (v: number) => Array.from({ length: 12 }, () => v);
const seq = (f: (i: number) => number) => Array.from({ length: 12 }, (_, i) => f(i));
const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);

function mkTax(vendas: number[], cbsIbs: number[], lucro: number[]): MonthlyTax {
  const monthly = vendas.map((v, i) => v + (lucro[i] ?? 0));
  return {
    monthly,
    monthlyVendas: vendas,
    monthlyLucro: lucro,
    monthlyCbsIbs: cbsIbs,
    annual: soma(monthly),
    annualVendas: soma(vendas),
    annualLucro: soma(lucro),
    effective: 0,
    detail: {},
  };
}

describe("constantes de lag", () => {
  it("lag padrão = 30 dias (DARF do mês seguinte) e split = 0 (retido no ato)", () => {
    expect(LAG_DIAS_PADRAO).toBe(30);
    expect(LAG_DIAS_SPLIT).toBe(0);
  });
});

describe("partitionMonthlyTaxByLag", () => {
  // Vendas 10k/mês, dos quais 2k são CBS/IBS; lucro (IRPJ/CSLL) cresce 1k, 2k, ... 12k.
  const vendas = m12(10_000);
  const cbs = m12(2_000);
  const lucro = seq((i) => (i + 1) * 1000);
  const tax = mkTax(vendas, cbs, lucro);

  it("Presumido sem split: vendas inteiras no lag 30; lucro agrupado no fim do trimestre", () => {
    const r = partitionMonthlyTaxByLag(tax, false, "presumido");
    expect(r.vendasLag30).toEqual(vendas);
    expect(r.splitZero).toEqual(m12(0));
    // Q1 = 1+2+3 = 6k em mar; Q2 = 4+5+6 = 15k em jun; Q3 = 24k em set; Q4 = 33k em dez.
    expect(r.lucroTri).toEqual([0, 0, 6000, 0, 0, 15000, 0, 0, 24000, 0, 0, 33000]);
    // Invariante: soma das partições = total mensal (no ano)
    expect(soma(r.vendasLag30) + soma(r.splitZero) + soma(r.lucroTri)).toBe(tax.annual);
  });

  it("Real com split ativo: CBS/IBS saem para lag 0; vendas ex-CBS no lag 30", () => {
    const r = partitionMonthlyTaxByLag(tax, true, "real");
    expect(r.splitZero).toEqual(cbs);
    expect(r.vendasLag30).toEqual(m12(8_000));
    expect(soma(r.vendasLag30) + soma(r.splitZero) + soma(r.lucroTri)).toBe(tax.annual);
    // a partição devolve cópias (não aliasa o input)
    expect(r.splitZero).not.toBe(cbs);
  });

  it("Simples: lucro (regressão > 0) é tratado mês a mês, sem agrupar trimestre", () => {
    const r = partitionMonthlyTaxByLag(tax, false, "simples");
    expect(r.lucroTri).toEqual(lucro);
  });

  it("Simples com monthlyLucro zerado → lucroTri todo zero (IRPJ/CSLL dentro do DAS)", () => {
    const r = partitionMonthlyTaxByLag(mkTax(vendas, cbs, m12(0)), true, "simples");
    expect(r.lucroTri).toEqual(m12(0));
  });

  it("séries ausentes são tratadas como zero (sem NaN)", () => {
    const vazio = { monthlyVendas: undefined, monthlyCbsIbs: undefined, monthlyLucro: undefined };
    const r = partitionMonthlyTaxByLag(vazio as unknown as MonthlyTax, true, "presumido");
    expect(r.lucroTri).toEqual(m12(0));
    expect(r.vendasLag30.every(Number.isFinite)).toBe(true);
    const r2 = partitionMonthlyTaxByLag(vazio as unknown as MonthlyTax, false, "simples");
    expect(r2.lucroTri).toEqual(m12(0));
    expect(r2.splitZero).toEqual(m12(0));
  });

  it("split com CBS/IBS maior que vendas no mês não gera vendas negativas", () => {
    const r = partitionMonthlyTaxByLag(mkTax(m12(1000), m12(1500), m12(0)), true, "real");
    expect(r.vendasLag30).toEqual(m12(0));
  });

  it("CBS/IBS mais curto que vendas: meses faltantes contam como zero", () => {
    const r = partitionMonthlyTaxByLag(mkTax(m12(1000), [200, 200], m12(0)), true, "real");
    expect(r.vendasLag30[0]).toBe(800);
    expect(r.vendasLag30[5]).toBe(1000);
  });
});

describe("computeImpostosPagarFechamento — passivo tributário em 31/dez", () => {
  const vendas = seq((i) => (i === 11 ? 12_000 : 10_000));
  const cbs = seq((i) => (i === 11 ? 3_000 : 2_000));
  const lucro = seq((i) => (i + 1) * 1000); // out=10k, nov=11k, dez=12k
  const tax = mkTax(vendas, cbs, lucro);

  it("Presumido sem split: vendas de dez (12k) + Q4 do lucro (10+11+12 = 33k) = 45k", () => {
    expect(computeImpostosPagarFechamento({ tax, regime: "presumido", splitAtivo: false })).toBe(
      45_000,
    );
  });

  it("Real com split: (12k − 3k CBS/IBS retidos) + 33k = 42k", () => {
    expect(computeImpostosPagarFechamento({ tax, regime: "real", splitAtivo: true })).toBe(42_000);
  });

  it("Simples: só o DAS de dezembro (lucro já está no DAS)", () => {
    expect(computeImpostosPagarFechamento({ tax, regime: "simples", splitAtivo: false })).toBe(
      12_000,
    );
  });

  it("coerência com a partição: passivo = vendasLag30[dez] + lucroTri[dez] (Presumido)", () => {
    const p = partitionMonthlyTaxByLag(tax, true, "presumido");
    const passivo = computeImpostosPagarFechamento({ tax, regime: "presumido", splitAtivo: true });
    expect(passivo).toBe(p.vendasLag30[11] + p.lucroTri[11]);
  });

  it("CBS/IBS > vendas com split → passivo de vendas zera, sem negativo", () => {
    const t = mkTax(m12(1000), m12(5000), m12(0));
    expect(computeImpostosPagarFechamento({ tax: t, regime: "real", splitAtivo: true })).toBe(0);
  });

  it("séries ausentes → passivo zero", () => {
    const vazio = {} as unknown as MonthlyTax;
    expect(computeImpostosPagarFechamento({ tax: vazio, regime: "real", splitAtivo: true })).toBe(
      0,
    );
  });

  it("lucro negativo (estorno) nunca gera passivo negativo", () => {
    const t = mkTax(
      m12(0),
      m12(0),
      seq((i) => (i >= 9 ? -5000 : 0)),
    );
    expect(computeImpostosPagarFechamento({ tax: t, regime: "presumido", splitAtivo: false })).toBe(
      0,
    );
  });
});
