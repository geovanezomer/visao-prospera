/**
 * Sócios — ramos não cobertos: tabela de IRPF customizada (faixa acima da
 * última), IRPF sem escolha automática do simplificado, teto de distribuição
 * isenta (Presumido) com adicional de IRPJ, distribuição realizada e
 * sincronização SSOT com `state.costs`.
 *
 * Para deixar as contas à mão independentes da tabela do ano vigente, os
 * parâmetros de folha e as alíquotas são fixados via `tax.ratesOverride`.
 */
import { describe, expect, it } from "vitest";
import {
  applySociosChange,
  calcDistribuicaoIsentaBreakdown,
  calcDistribuicaoIsentaLimite,
  calcIrpfMensal,
  calcRetiradaSocio,
  getDistribuicaoRealizadaMediaMensal,
  getDistribuicaoRealizadaMeses,
  otimizarProLabore,
  SOCIOS_PATRONAL_LINE_ID,
  SOCIOS_PROLABORE_LINE_ID,
  syncSociosToCosts,
} from "../socios";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine, SocioRetirada, TaxConfig } from "../types";

/** Tabela didática SEM faixa infinita: acima de 10.000 cai no ramo "última faixa". */
const TABELA: [number, number, number][] = [
  [2_000, 0, 0],
  [5_000, 10, 200],
  [10_000, 20, 700],
];

const rates = {
  irpj: 15,
  csll: 9,
  pisCum: 0.65,
  cofinsCum: 3,
  irpjAdicional: 10,
  irpjAdicionalGatilhoTri: 60_000,
  presumidoBases: { servicos: { irpj: 32, csll: 32 } },
  payroll: {
    irpfTable: TABELA,
    irpfSimplificadoAuto: false,
    irpfDependenteDeducao: 200,
    irpfDescontoSimplificado: 500,
    inssSocioAliq: 11,
    inssTeto: 8_000,
    inssPatronalAliq: 20,
    salarioMinimo: 1_500,
  },
};

const mkState = (over: Record<string, unknown> = {}): AppState =>
  createState({
    businessType: "servicos",
    revenue: { bruta: m12(100_000) },
    tax: { regime: "presumido", ratesOverride: rates } as never,
    ...over,
  });

const mkSocio = (over: Partial<SocioRetirada> = {}): SocioRetirada => ({
  id: "s1",
  nome: "Sócio 1",
  participacaoPct: 50,
  operacional: true,
  prolaboreMensal: 10_000,
  dependentes: 0,
  outrasDeducoes: 0,
  modo: "manual",
  ...over,
});

describe("calcIrpfMensal — tabela customizada e modo forçado", () => {
  const tax = mkState().tax as TaxConfig;

  it("base acima da última faixa usa a alíquota/dedução da última faixa", () => {
    // Base 20.000 > 10.000 → 20% × 20.000 − 700 = 3.300 (redutor zero acima de R$ 7.350)
    expect(calcIrpfMensal(20_000, 0, 0, 0, tax)).toEqual({ valor: 3_300, modo: "tradicional" });
  });

  it("sem escolha automática, usa o tradicional mesmo quando o simplificado seria menor", () => {
    // Tradicional: base 8.000 → 20% × 8.000 − 700 = 900
    // (Simplificado daria 7.500 → 800, mas está desligado)
    expect(calcIrpfMensal(8_000, 0, 0, 0, tax)).toEqual({ valor: 900, modo: "tradicional" });
  });

  it("com escolha automática, aplica o simplificado quando ele é menor", () => {
    const taxAuto = {
      ...tax,
      ratesOverride: { ...rates, payroll: { ...rates.payroll, irpfSimplificadoAuto: true } },
    } as TaxConfig;
    // Tradicional 900 × Simplificado (8.000 − 500 = 7.500 → 800) → simplificado
    expect(calcIrpfMensal(8_000, 0, 0, 0, taxAuto)).toEqual({
      valor: 800,
      modo: "simplificado",
    });
    // Com 4 dependentes: tradicional base 7.200 → 740 < 800 → tradicional
    expect(calcIrpfMensal(8_000, 0, 4, 0, taxAuto)).toEqual({
      valor: 740,
      modo: "tradicional",
    });
  });
});

describe("teto de distribuição isenta (Presumido sem escrituração)", () => {
  it("breakdown: base presumida − tributos federais − adicional de IRPJ", () => {
    const s = mkState();
    const b = calcDistribuicaoIsentaBreakdown(s, "presumido");
    // Receita anual 1.200.000; base IRPJ serviços 32% = 384.000
    expect(b.basePresumida).toBeCloseTo(384_000, 6);
    // IRPJ+CSLL: 384.000 × 24% = 92.160; PIS+COFINS: 1.200.000 × 3,65% = 43.800
    expect(b.tributosFed).toBeCloseTo(135_960, 6);
    // Adicional: (96.000 − 60.000) × 10% × 4 trimestres = 14.400
    expect(b.baseTri).toBeCloseTo(96_000, 6);
    expect(b.gatilhoTri).toBe(60_000);
    expect(b.adicionalIrpjAno).toBeCloseTo(14_400, 6);
    // (384.000 − 135.960 − 14.400) / 12 = 233.640 / 12 = 19.470
    expect(b.limiteMensal).toBeCloseTo(19_470, 6);
    expect(calcDistribuicaoIsentaLimite(s, "presumido")).toBeCloseTo(19_470, 6);
  });

  it("escrituração completa (auto desligado), Real ou Simples → sem teto", () => {
    const sEscrit = mkState({
      tax: {
        regime: "presumido",
        ratesOverride: {
          ...rates,
          payroll: { ...rates.payroll, distribuicaoLimitePresumidoAuto: false },
        },
      },
    });
    expect(calcDistribuicaoIsentaLimite(sEscrit, "presumido")).toBe(Infinity);
    expect(calcDistribuicaoIsentaBreakdown(sEscrit, "presumido").limiteMensal).toBe(Infinity);
    expect(calcDistribuicaoIsentaLimite(mkState(), "real")).toBe(Infinity);
    expect(calcDistribuicaoIsentaLimite(mkState(), "simples")).toBe(Infinity);
  });
});

describe("calcRetiradaSocio — distribuição acima do teto e retenção Lei 15.270", () => {
  it("rateia o teto pela participação, tributa o excedente na tabela progressiva e retém 10%", () => {
    const s = mkState();
    const r = calcRetiradaSocio(mkSocio(), s, "presumido", 60_000);
    // INSS sócio: 11% × min(10.000, teto 8.000) = 880; patronal 20% × 10.000 = 2.000
    expect(r.inssSocio).toBeCloseTo(880, 6);
    expect(r.inssPatronal).toBeCloseTo(2_000, 6);
    // IRPF pró-labore: base 9.120 → 20% × 9.120 − 700 = 1.124
    expect(r.irpfMensal).toBeCloseTo(1_124, 6);
    // Teto da empresa 19.470 × 50% = 9.735 isento; excedente 50.265
    expect(r.distribuicaoIsentaMensal).toBeCloseTo(9_735, 6);
    expect(r.distribuicaoTributavelMensal).toBeCloseTo(50_265, 6);
    // Total 60.000 > 50.000 → retenção de 10% sobre o TOTAL = 6.000
    expect(r.retencaoDividendosMensal).toBeCloseTo(6_000, 6);
    expect(r.alertaIRPFM).toBe(true); // 720.000/ano > 600.000
    // IR do excedente (marginal): IR(9.120 + 50.265 = 59.385) − IR(9.120)
    //   = (20% × 59.385 − 700) − 1.124 = 11.177 − 1.124 = 10.053
    // Líquido = 10.000 − 880 − 1.124 + 9.735 + (50.265 − 10.053) − 6.000 = 51.943
    expect(r.liquidoSocio).toBeCloseTo(51_943, 6);
    expect(r.custoTotalPJ).toBeCloseTo(12_000, 6);
  });
});

describe("distribuição realizada (SSOT de DRE/DFC/Balanço)", () => {
  it("modo fixo replica o 1º valor nos 12 meses", () => {
    const s = createState({ distribuicaoRealizada: { values: [5_000, 1, 2], fixed: true } });
    expect(getDistribuicaoRealizadaMeses(s)).toEqual(m12(5_000));
    expect(getDistribuicaoRealizadaMediaMensal(s)).toBe(5_000);
  });

  it("modo mensal: média = Σ/12", () => {
    const values = Array.from({ length: 12 }, (_, i) => (i + 1) * 1_000); // Σ = 78.000
    const s = createState({ distribuicaoRealizada: { values, fixed: false } });
    expect(getDistribuicaoRealizadaMeses(s)).toEqual(values);
    expect(getDistribuicaoRealizadaMediaMensal(s)).toBe(6_500);
  });

  it("ausente ou inválida → 12 zeros", () => {
    const s = { ...createState({}), distribuicaoRealizada: undefined } as AppState;
    expect(getDistribuicaoRealizadaMeses(s)).toEqual(m12(0));
    const s2 = { ...s, distribuicaoRealizada: { values: "x" } } as unknown as AppState;
    expect(getDistribuicaoRealizadaMediaMensal(s2)).toBe(0);
  });
});

describe("otimizarProLabore — limites", () => {
  it("retirada total abaixo do piso → piso (salário mínimo para operacional; 0 para não operacional)", () => {
    const s = mkState();
    expect(otimizarProLabore(mkSocio(), 1_000, s, "presumido")).toBe(1_500);
    expect(otimizarProLabore(mkSocio({ operacional: false }), 0, s, "presumido")).toBe(0);
  });
});

describe("syncSociosToCosts / applySociosChange", () => {
  const legado: CostLine[] = [
    { id: "prolabore", label: "Pró-labore", category: "fixo", values: m12(999), fixed: true },
    {
      id: "custom-1",
      label: "Pró-labore (sócios)",
      category: "fixo",
      values: m12(888),
      fixed: true,
    },
    {
      id: "custom-2",
      label: "INSS Patronal sócios",
      category: "fixo",
      values: m12(777),
      fixed: true,
    },
    { id: "aluguel", label: "Aluguel", category: "fixo", values: m12(2_500), fixed: true },
  ];

  it("remove seeds legados/duplicatas e cria pró-labore + patronal a partir dos sócios", () => {
    const s = mkState({ costs: legado });
    const out = applySociosChange(
      s,
      [mkSocio({ id: "a", prolaboreMensal: 5_000 }), mkSocio({ id: "b", prolaboreMensal: 3_000 })],
      "presumido",
    );
    expect(out.socios).toHaveLength(2);
    expect(out.costs.map((c) => c.id)).toEqual([
      "aluguel",
      SOCIOS_PROLABORE_LINE_ID,
      SOCIOS_PATRONAL_LINE_ID,
    ]);
    const pro = out.costs.find((c) => c.id === SOCIOS_PROLABORE_LINE_ID)!;
    const pat = out.costs.find((c) => c.id === SOCIOS_PATRONAL_LINE_ID)!;
    // Σ pró-labore 8.000/mês; patronal 20% = 1.600/mês
    expect(pro.values).toEqual(m12(8_000));
    expect(pat.values).toEqual(m12(1_600));
    expect(pro.system && pat.system).toBe(true);
  });

  it("Simples (CPP no DAS): só a linha de pró-labore; sem sócios, nenhuma linha system", () => {
    const s = mkState({ costs: legado });
    const simples = syncSociosToCosts({ ...s, socios: [mkSocio()] }, "simples");
    expect(simples.costs.map((c) => c.id)).toEqual(["aluguel", SOCIOS_PROLABORE_LINE_ID]);
    const vazio = syncSociosToCosts({ ...s, socios: undefined } as unknown as AppState, "real");
    expect(vazio.costs.map((c) => c.id)).toEqual(["aluguel"]);
  });
});
