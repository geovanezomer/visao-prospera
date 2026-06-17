// =====================================================================
// Patch helpers — testes do reducer puro `applyPatch` (Revenue/Tax/
// Capital/Cashflow). Garantem:
//   1. Merge raso correto no slice alvo.
//   2. Forma funcional `(cur, full) => patch` lê o slice atual.
//   3. Imutabilidade: state original não é mutado; outras fatias mantêm
//      a mesma referência (igualdade referencial) para não invalidar
//      memos a jusante.
// =====================================================================
import { describe, it, expect } from "vitest";
import { applyPatch } from "../AppStateContext";
import { createState, m12 } from "./helpers";

describe("applyPatch — Revenue", () => {
  it("merge raso preserva campos não mencionados", () => {
    const s = createState({ revenue: { bruta: m12(1000), pmr: 30 } });
    const next = applyPatch(s, "revenue", { bruta: m12(2000) });
    expect(next.revenue.bruta).toEqual(m12(2000));
    expect(next.revenue.pmr).toBe(30); // preservado
  });

  it("forma funcional lê o slice atual", () => {
    const s = createState({ revenue: { bruta: m12(1000) } });
    const next = applyPatch(s, "revenue", (rev) => ({
      bruta: rev.bruta.map((x, i) => (i === 0 ? 9999 : x)),
    }));
    expect(next.revenue.bruta[0]).toBe(9999);
    expect(next.revenue.bruta[1]).toBe(1000);
  });

  it("não muta o state original", () => {
    const s = createState({ revenue: { bruta: m12(1000) } });
    const snapshot = JSON.stringify(s);
    applyPatch(s, "revenue", { bruta: m12(5000) });
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("preserva identidade referencial de fatias não tocadas", () => {
    const s = createState();
    const next = applyPatch(s, "revenue", { bruta: m12(100) });
    expect(next.tax).toBe(s.tax);
    expect(next.capital).toBe(s.capital);
    expect(next.cashflow).toBe(s.cashflow);
    expect(next.costs).toBe(s.costs);
  });
});

describe("applyPatch — Tax", () => {
  it("merge raso em tax sem afetar ratesOverride existente", () => {
    const s = createState({ tax: { regime: "real", ratesOverride: { irpj: 20 } } });
    const next = applyPatch(s, "tax", { regime: "simples" });
    expect(next.tax.regime).toBe("simples");
    expect(next.tax.ratesOverride?.irpj).toBe(20);
  });

  it("forma funcional faz merge profundo em ratesOverride", () => {
    const s = createState({ tax: { ratesOverride: { irpj: 20 } } });
    const next = applyPatch(s, "tax", (cur) => ({
      ratesOverride: { ...(cur.ratesOverride ?? {}), csll: 9 },
    }));
    expect(next.tax.ratesOverride).toEqual({ irpj: 20, csll: 9 });
  });
});

describe("applyPatch — Capital", () => {
  it("merge raso preserva campos não tocados", () => {
    const s = createState({ capital: { ke: 0.18, kd: 0.12 } });
    const next = applyPatch(s, "capital", { ke: 0.2 });
    expect(next.capital.ke).toBe(0.2);
    expect(next.capital.kd).toBe(0.12);
  });
});

describe("applyPatch — Cashflow", () => {
  it("forma funcional edita 1 mês de array via [key] dinâmica", () => {
    const s = createState({ cashflow: { capex: m12(0) } });
    const next = applyPatch(s, "cashflow", (cur) => ({
      capex: cur.capex.map((v, i) => (i === 3 ? 5000 : v)),
    }));
    expect(next.cashflow.capex[3]).toBe(5000);
    expect(next.cashflow.capex[0]).toBe(0);
  });

  it("merge direto define caixaMinimo sem tocar capex", () => {
    const s = createState({ cashflow: { capex: m12(100) } });
    const capexBefore = s.cashflow.capex;
    const next = applyPatch(s, "cashflow", { caixaMinimo: 25000 });
    expect(next.cashflow.caixaMinimo).toBe(25000);
    expect(next.cashflow.capex).toBe(capexBefore);
  });
});
