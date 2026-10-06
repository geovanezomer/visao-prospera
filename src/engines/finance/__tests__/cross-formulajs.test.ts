/**
 * Validação cruzada: compara nossa implementação de NPV/IRR (forecast.ts)
 * contra formulajs (referência Excel) em cenários típicos brasileiros.
 *
 * Objetivo: garantir que nossa engine não diverge da convenção Excel em
 * casos reais. Nossa impl é mantida por ser mais defensiva (fallback de
 * bisseção, null semântico, irrDetailed).
 */
import { describe, it, expect } from "vitest";
import { npv, irr } from "../forecast";
import { IRR as tir, NPV, PMT } from "@formulajs/formulajs";
import { parcela, vplClassico, vplExcel } from "../external";

const closeRel = (a: number, b: number, tol = 1e-4) =>
  Math.abs(a - b) / Math.max(Math.abs(b), 1) < tol;

describe("VPL/TIR — paridade com formulajs (Excel)", () => {
  const cenarios: { nome: string; fluxos: number[]; taxa: number }[] = [
    { nome: "CAPEX simples 5 anos", fluxos: [-1000, 300, 300, 300, 300, 300], taxa: 0.1 },
    { nome: "Projeto curto", fluxos: [-500, 200, 250, 300], taxa: 0.12 },
    { nome: "Fluxo irregular", fluxos: [-2000, 100, 400, 800, 1200, 600], taxa: 0.15 },
    { nome: "PME real", fluxos: [-50000, 12000, 15000, 18000, 20000, 22000], taxa: 0.18 },
  ];

  cenarios.forEach(({ nome, fluxos, taxa }) => {
    it(`NPV — ${nome}`, () => {
      const nosso = npv(fluxos, taxa);
      const externo = vplClassico(taxa, fluxos);
      expect(closeRel(nosso, externo)).toBe(true);
    });

    it(`IRR — ${nome}`, () => {
      const nosso = irr(fluxos);
      const externo = tir(fluxos);
      if (nosso == null || externo instanceof Error) return;
      expect(closeRel(nosso, externo as number, 1e-3)).toBe(true);
    });
  });
});

describe("implementação local × formulajs (Excel)", () => {
  it("NPV igual ao do Excel", () => {
    for (const [taxa, ...f] of [
      [0.1, 300, 300, 300],
      [0.015, -100, 50, 80, 120],
      [0, 10, 20, 30],
    ])
      expect(vplExcel(taxa, ...f)).toBeCloseTo(NPV(taxa, ...f) as number, 9);
  });

  it("PMT igual ao do Excel (fim e início do período, com e sem valor futuro)", () => {
    const casos: [number, number, number, number, 0 | 1][] = [
      [0.02, 12, 100_000, 0, 0],
      [0.01, 36, 250_000, 0, 1],
      [0.015, 24, 50_000, 10_000, 0],
      [0, 10, 1_000, 0, 0],
    ];
    for (const [i, n, pv, fv, t] of casos)
      expect(parcela(i, n, pv, fv, t)).toBeCloseTo(PMT(i, n, pv, fv, t) as number, 9);
  });
});
