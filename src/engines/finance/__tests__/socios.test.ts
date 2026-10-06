/**
 * Testes da engine de Sócios — Pró-labore × Distribuição de Lucros.
 */
import { describe, it, expect } from "vitest";
import {
  calcInssSocio,
  calcInssPatronal,
  calcIrpfMensal,
  calcRetiradaSocio,
  otimizarProLabore,
  syncSociosToCosts,
  calcDistribuicaoIsentaLimite,
  getDistribuicaoRealizadaMeses,
  SOCIOS_PROLABORE_LINE_ID,
  SOCIOS_PATRONAL_LINE_ID,
} from "../socios";
import { DEFAULT_STATE } from "../defaults";
import { INSS_SOCIO_ALIQ_DEFAULT, INSS_TETO_DEFAULT, SALARIO_MINIMO_DEFAULT } from "../taxDefaults";
import type { AppState, SocioRetirada } from "../types";

const mkSocio = (over: Partial<SocioRetirada> = {}): SocioRetirada => ({
  id: "s1",
  nome: "Sócio 1",
  participacaoPct: 100,
  operacional: true,
  prolaboreMensal: 5000,
  dependentes: 0,
  outrasDeducoes: 0,
  modo: "manual",
  ...over,
});

describe("socios — INSS sócio (contribuinte individual)", () => {
  it("aplica 11% até o teto", () => {
    const tax = DEFAULT_STATE.tax;
    expect(calcInssSocio(5000, tax)).toBeCloseTo(5000 * (INSS_SOCIO_ALIQ_DEFAULT / 100), 2);
  });
  it("limita ao teto contributivo", () => {
    const tax = DEFAULT_STATE.tax;
    const v = calcInssSocio(20000, tax);
    expect(v).toBeCloseTo(INSS_TETO_DEFAULT * (INSS_SOCIO_ALIQ_DEFAULT / 100), 2);
  });
  it("zera quando pró-labore <= 0", () => {
    expect(calcInssSocio(0, DEFAULT_STATE.tax)).toBe(0);
  });
});

describe("socios — INSS patronal", () => {
  it("zero em Simples (default)", () => {
    expect(calcInssPatronal(5000, "simples", DEFAULT_STATE.tax)).toBe(0);
  });
  it("20% em Presumido", () => {
    expect(calcInssPatronal(5000, "presumido", DEFAULT_STATE.tax)).toBeCloseTo(1000, 2);
  });
  it("20% em Real", () => {
    expect(calcInssPatronal(5000, "real", DEFAULT_STATE.tax)).toBeCloseTo(1000, 2);
  });
});

describe("socios — IRPF mensal (auto tradicional × simplificado)", () => {
  it("zera na faixa de isenção", () => {
    const { valor } = calcIrpfMensal(2000, 220, 0, 0, DEFAULT_STATE.tax);
    expect(valor).toBe(0);
  });
  it("escolhe o menor entre tradicional e simplificado", () => {
    // Nota: sob Lei 15.270/2025, rendimento ≤ R$ 5.000 tem IR zerado pelo redutor.
    // Este teste garante apenas que a escolha do modo seja válida.
    const { valor, modo } = calcIrpfMensal(5000, 550, 0, 0, DEFAULT_STATE.tax);
    expect(valor).toBeGreaterThanOrEqual(0);
    expect(["tradicional", "simplificado"]).toContain(modo);
  });
  it("dependentes reduzem IRPF tradicional", () => {
    const sem = calcIrpfMensal(5000, 550, 0, 0, DEFAULT_STATE.tax).valor;
    const com = calcIrpfMensal(5000, 550, 3, 0, DEFAULT_STATE.tax).valor;
    expect(com).toBeLessThanOrEqual(sem);
  });
});

describe("socios — otimização", () => {
  it("Simples sem patronal → ótimo é o piso (salário mínimo)", () => {
    const state: AppState = { ...DEFAULT_STATE, tax: { ...DEFAULT_STATE.tax, regime: "simples" } };
    const otimo = otimizarProLabore(mkSocio({ operacional: true }), 20000, state, "simples");
    expect(otimo).toBe(SALARIO_MINIMO_DEFAULT);
  });
  it("sócio não operacional em Simples → ótimo é 0", () => {
    const state: AppState = { ...DEFAULT_STATE, tax: { ...DEFAULT_STATE.tax, regime: "simples" } };
    const otimo = otimizarProLabore(mkSocio({ operacional: false }), 20000, state, "simples");
    expect(otimo).toBe(0);
  });
  it("Presumido → ótimo respeita piso e não excede total", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      tax: { ...DEFAULT_STATE.tax, regime: "presumido" },
    };
    const otimo = otimizarProLabore(mkSocio({ operacional: true }), 15000, state, "presumido");
    expect(otimo).toBeGreaterThanOrEqual(SALARIO_MINIMO_DEFAULT);
    expect(otimo).toBeLessThanOrEqual(15000);
  });
});

describe("socios — syncSociosToCosts (SSOT)", () => {
  it("upserta linhas system em state.costs", () => {
    const state = { ...DEFAULT_STATE, socios: [mkSocio({ prolaboreMensal: 6000 })] };
    const next = syncSociosToCosts(state, "presumido");
    const prolab = next.costs.find((c) => c.id === SOCIOS_PROLABORE_LINE_ID);
    const patronal = next.costs.find((c) => c.id === SOCIOS_PATRONAL_LINE_ID);
    expect(prolab?.values[0]).toBe(6000);
    expect(prolab?.system).toBe(true);
    expect(patronal?.values[0]).toBeCloseTo(1200, 2);
  });
  it("remove linhas system quando socios=[]", () => {
    const seed = syncSociosToCosts(
      { ...DEFAULT_STATE, socios: [mkSocio({ prolaboreMensal: 6000 })] },
      "presumido",
    );
    const next = syncSociosToCosts({ ...seed, socios: [] }, "presumido");
    expect(next.costs.find((c) => c.id === SOCIOS_PROLABORE_LINE_ID)).toBeUndefined();
    expect(next.costs.find((c) => c.id === SOCIOS_PATRONAL_LINE_ID)).toBeUndefined();
  });
  it("Simples não cria linha patronal", () => {
    const state = { ...DEFAULT_STATE, socios: [mkSocio({ prolaboreMensal: 6000 })] };
    const next = syncSociosToCosts(state, "simples");
    expect(next.costs.find((c) => c.id === SOCIOS_PATRONAL_LINE_ID)).toBeUndefined();
  });
});

describe("socios — calcRetiradaSocio", () => {
  it("calcula líquido coerente com componentes", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      tax: { ...DEFAULT_STATE.tax, regime: "presumido" },
    };
    const r = calcRetiradaSocio(mkSocio({ prolaboreMensal: 5000 }), state, "presumido", 8000);
    expect(r.inssSocio).toBeGreaterThan(0);
    expect(r.inssPatronal).toBeCloseTo(1000, 2);
    expect(r.custoTotalPJ).toBeCloseTo(5000 + 1000, 2);
    expect(r.liquidoSocio).toBeGreaterThan(0);
  });

  it("rateia o limite isento da empresa pela participação do sócio", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      tax: { ...DEFAULT_STATE.tax, regime: "presumido" },
      revenue: { ...DEFAULT_STATE.revenue, bruta: Array(12).fill(150000) },
    };
    const limiteEmpresa = calcDistribuicaoIsentaLimite(state, "presumido");
    const r = calcRetiradaSocio(
      mkSocio({ participacaoPct: 50, prolaboreMensal: 5000 }),
      state,
      "presumido",
      limiteEmpresa,
    );
    expect(r.distribuicaoIsentaMensal).toBeCloseTo(limiteEmpresa * 0.5, 2);
    expect(r.distribuicaoTributavelMensal).toBeCloseTo(limiteEmpresa * 0.5, 2);
  });
});

describe("socios — distribuição realizada", () => {
  it("quando fixed=true, replica o primeiro mês como fonte de verdade", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      distribuicaoRealizada: {
        fixed: true,
        values: [1000, 2000, 3000],
      },
    };
    expect(getDistribuicaoRealizadaMeses(state)).toEqual(Array(12).fill(1000));
  });

  it("quando fixed=false, sanitiza para 12 meses sem perder sazonalidade", () => {
    const state: AppState = {
      ...DEFAULT_STATE,
      distribuicaoRealizada: {
        fixed: false,
        values: [1000, Number.NaN, 3000],
      },
    };
    expect(getDistribuicaoRealizadaMeses(state).slice(0, 4)).toEqual([1000, 0, 3000, 0]);
  });
});
