/**
 * Monte Carlo — testes estatísticos.
 *
 * Box-Muller é não-determinístico (Math.random), então testamos propriedades
 * estáveis: estrutura do resultado, ordenação dos percentis, número de iterações
 * e estabilidade (média próxima do caso base com choques pequenos).
 */
import { describe, it, expect } from "vitest";
import { runMonteCarlo, DEFAULT_MC, histogram } from "../montecarlo";
import { createState, m12 } from "./helpers";

describe("Monte Carlo", () => {
  it("retorna número de iterações solicitado", () => {
    const s = createState({ revenue: { bruta: m12(10_000) } });
    const r = runMonteCarlo(s, { ...DEFAULT_MC, iterations: 200 });
    expect(r.iterations).toBe(200);
    expect(r.ebitda.values.length).toBe(200);
    expect(r.lucroLiquido.values.length).toBe(200);
  });

  it("percentis ordenados: p5 ≤ p25 ≤ mediana ≤ p75 ≤ p95", () => {
    const s = createState({ revenue: { bruta: m12(10_000) } });
    const r = runMonteCarlo(s, { ...DEFAULT_MC, iterations: 300 });
    const d = r.ebitda;
    expect(d.p5).toBeLessThanOrEqual(d.p25);
    expect(d.p25).toBeLessThanOrEqual(d.median);
    expect(d.median).toBeLessThanOrEqual(d.p75);
    expect(d.p75).toBeLessThanOrEqual(d.p95);
  });

  it("probabilidades dentro de [0, 1]", () => {
    const s = createState({ revenue: { bruta: m12(10_000) } });
    const r = runMonteCarlo(s, { ...DEFAULT_MC, iterations: 200 });
    expect(r.probPrejuizo).toBeGreaterThanOrEqual(0);
    expect(r.probPrejuizo).toBeLessThanOrEqual(1);
    expect(r.probCaixaNegativo).toBeGreaterThanOrEqual(0);
    expect(r.probCaixaNegativo).toBeLessThanOrEqual(1);
    expect(r.ebitda.probPositive).toBeGreaterThanOrEqual(0);
    expect(r.ebitda.probPositive).toBeLessThanOrEqual(1);
  });

  it("todos os valores são finitos (Box-Muller estável, sem NaN)", () => {
    const s = createState({ revenue: { bruta: m12(10_000) } });
    const r = runMonteCarlo(s, { ...DEFAULT_MC, iterations: 200 });
    expect(r.ebitda.values.every(Number.isFinite)).toBe(true);
    expect(r.lucroLiquido.values.every(Number.isFinite)).toBe(true);
    expect(r.saldoCaixaFinal.values.every(Number.isFinite)).toBe(true);
  });

  it("sigma=0 reproduz cenário determinístico (variância ≈ 0)", () => {
    const s = createState({ revenue: { bruta: m12(10_000) } });
    const r = runMonteCarlo(s, {
      iterations: 50, precoSigmaPct: 0, volumeSigmaPct: 0, cpvSigmaPct: 0, folhaSigmaPct: 0,
    });
    // todos os EBITDAs idênticos => p5 == p95
    expect(r.ebitda.p5).toBeCloseTo(r.ebitda.p95, 2);
  });

  it("histogram retorna soma de contagens = N", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const h = histogram(sorted, 5);
    const total = h.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(sorted.length);
  });
});
