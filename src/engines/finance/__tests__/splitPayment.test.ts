import { describe, it, expect } from "vitest";
import { computeImpostos } from "../cashflow";
import { m12 } from "./helpers";
import type { MonthlyTax } from "../tax/shared";

// Helper para criar MonthlyTax mínimo
function buildTax(total: number[], cbsIbs: number[]): MonthlyTax {
  return {
    monthly: total.slice(),
    monthlyCbsIbs: cbsIbs.slice(),
    // Demais campos não são usados por computeImpostos:
    breakdown: {} as never,
    annualTotal: total.reduce((a, b) => a + b, 0),
  } as unknown as MonthlyTax;
}

describe("computeImpostos — Split Payment (LC 214/2025)", () => {
  it("Sem Split: todos os tributos têm lag 30 (recolhimento mês seguinte)", () => {
    const tax = buildTax(m12(1000), m12(600));
    const r = computeImpostos(tax, false);
    // mês 1 zerado (recolhimento de jan ocorre em fev)
    expect(r.inAno[0]).toBe(0);
    // meses 2..12 recebem 1000 cada
    for (let i = 1; i < 12; i++) expect(r.inAno[i]).toBeCloseTo(1000, 6);
    // dez transborda para jan/ano+1
    expect(r.transbordo).toBeCloseTo(1000, 6);
  });

  it("Com Split: CBS/IBS lag 0 (no mês), demais tributos lag 30", () => {
    const tax = buildTax(m12(1000), m12(600)); // 600 CBS/IBS + 400 outros
    const r = computeImpostos(tax, true);
    // mês 1: apenas a parcela CBS/IBS (600); outros 400 escorregam para fev
    expect(r.inAno[0]).toBeCloseTo(600, 6);
    // mês 2..12: 600 (CBS/IBS do mês) + 400 (outros tributos do mês anterior)
    for (let i = 1; i < 12; i++) expect(r.inAno[i]).toBeCloseTo(1000, 6);
    // transbordo = 400 (outros de dez recolhidos em jan/ano+1)
    expect(r.transbordo).toBeCloseTo(400, 6);
  });

  it("Com Split mas CBS/IBS = 0: comportamento idêntico ao sem Split", () => {
    const tax = buildTax(m12(1000), m12(0));
    const semSplit = computeImpostos(tax, false);
    const comSplit = computeImpostos(tax, true);
    expect(comSplit.inAno).toEqual(semSplit.inAno);
    expect(comSplit.transbordo).toBeCloseTo(semSplit.transbordo, 6);
  });

  it("Soma anual preservada: Split apenas redistribui o caixa no tempo", () => {
    const tax = buildTax(m12(1000), m12(600));
    const sem = computeImpostos(tax, false);
    const com = computeImpostos(tax, true);
    const totalSem = sem.inAno.reduce((a, b) => a + b, 0) + sem.transbordo;
    const totalCom = com.inAno.reduce((a, b) => a + b, 0) + com.transbordo;
    expect(totalCom).toBeCloseTo(totalSem, 6);
    expect(totalCom).toBeCloseTo(12000, 6);
  });

  it("Split antecipa caixa: transbordo com Split < transbordo sem Split", () => {
    const tax = buildTax(m12(1000), m12(600));
    const sem = computeImpostos(tax, false);
    const com = computeImpostos(tax, true);
    expect(com.transbordo).toBeLessThan(sem.transbordo);
  });

  it("monthlyCbsIbs ausente: trata como zero (sem quebrar)", () => {
    const tax = { monthly: m12(1000) } as unknown as MonthlyTax;
    const r = computeImpostos(tax, true);
    // Sem CBS/IBS conhecidos, tudo cai no lag 30
    expect(r.inAno[0]).toBe(0);
    expect(r.transbordo).toBeCloseTo(1000, 6);
  });
});
