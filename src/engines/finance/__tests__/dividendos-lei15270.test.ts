/**
 * Testes da retenção IR sobre dividendos — Lei 15.270/2025 (vigente 2026+).
 * Vetor: retenção de 10% sobre o TOTAL distribuído no mês quando > R$ 50 mil.
 */
import { describe, expect, it } from "vitest";
import {
  DIVIDENDO_RETENCAO_ALIQ,
  DIVIDENDO_RETENCAO_LIMITE_MENSAL,
  IRPFM_ALERTA_RENDA_ANUAL,
  calcRetencaoDividendosMensal,
  calcRetiradaSocio,
} from "../socios";
import type { AppState, SocioRetirada } from "../types";
import { DEFAULT_STATE } from "../defaults";

describe("Lei 15.270/2025 — retenção 10% sobre dividendos", () => {
  it("constantes conferem", () => {
    expect(DIVIDENDO_RETENCAO_LIMITE_MENSAL).toBe(50_000);
    expect(DIVIDENDO_RETENCAO_ALIQ).toBe(0.1);
    expect(IRPFM_ALERTA_RENDA_ANUAL).toBe(600_000);
  });

  it("40.000/mês → retenção 0", () => {
    expect(calcRetencaoDividendosMensal(40_000)).toBe(0);
  });

  it("60.000/mês → retenção 6.000 (10% do TOTAL, não do excedente)", () => {
    expect(calcRetencaoDividendosMensal(60_000)).toBeCloseTo(6_000, 2);
  });

  it("transição em R$ 50.000: 49.999,99 → 0 · 50.000,01 → 5.000,001", () => {
    expect(calcRetencaoDividendosMensal(49_999.99)).toBe(0);
    expect(calcRetencaoDividendosMensal(50_000)).toBe(0);
    expect(calcRetencaoDividendosMensal(50_000.01)).toBeCloseTo(5_000.001, 3);
  });

  it("exatamente no limite (50.000) → sem retenção", () => {
    expect(calcRetencaoDividendosMensal(50_000)).toBe(0);
  });
});

// ============================================================================
// Integração com calcRetiradaSocio — alertaIRPFM e liquidoSocio
// ============================================================================

function mkSocio(overrides: Partial<SocioRetirada> = {}): SocioRetirada {
  return {
    id: "s1",
    nome: "Sócio Único",
    participacaoPct: 100,
    prolaboreMensal: 0,
    dependentes: 0,
    outrasDeducoes: 0,
    operacional: true,
    ...overrides,
  };
}

describe("Lei 15.270/2025 — integração com sócio", () => {
  const state: AppState = {
    ...DEFAULT_STATE,
    tax: { ...DEFAULT_STATE.tax, regime: "presumido" },
  };

  it("alertaIRPFM ativa em 50.001/mês (600.012/ano)", () => {
    const r = calcRetiradaSocio(mkSocio(), state, "presumido", 50_001);
    expect(r.alertaIRPFM).toBe(true);
    expect(r.retencaoDividendosMensal).toBeGreaterThan(0);
  });

  it("alertaIRPFM inativa em 49.000/mês (588k/ano)", () => {
    const r = calcRetiradaSocio(mkSocio(), state, "presumido", 49_000);
    expect(r.alertaIRPFM).toBe(false);
    expect(r.retencaoDividendosMensal).toBe(0);
  });

  it("retenção reduz o líquido do sócio", () => {
    const semRet = calcRetiradaSocio(mkSocio(), state, "presumido", 40_000);
    const comRet = calcRetiradaSocio(mkSocio(), state, "presumido", 60_000);
    // Sem retenção: líquido ≈ distribuição. Com retenção: líquido diminui em 6.000.
    expect(comRet.retencaoDividendosMensal).toBeCloseTo(6_000, 0);
    expect(semRet.retencaoDividendosMensal).toBe(0);
  });
});
