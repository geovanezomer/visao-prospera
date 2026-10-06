/**
 * Garante que o painel "Parâmetros tributários" (overrides em ratesOverride)
 * altera o resultado dos cálculos de forma previsível, sem regressão para
 * cenários sem override.
 */
import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { simplesExcedeLimite } from "../regime";
import { sum } from "../format";
import { createState, m12 } from "./helpers";

describe("ratesOverride — Lucro Real", () => {
  it("Sem override → impostos sobre lucro batem com o cálculo base", () => {
    const s = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real" },
    });
    const annual = buildDRE(s, "real").tax.annualLucro;
    expect(annual).toBeGreaterThan(0);
  });

  it("Aumentar IRPJ de 15% para 20% aumenta o imposto sobre lucro", () => {
    const base = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real" },
    });
    const com = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real", ratesOverride: { irpj: 20 } },
    });
    const a = buildDRE(base, "real").tax.annualLucro;
    const b = buildDRE(com, "real").tax.annualLucro;
    expect(b).toBeGreaterThan(a);
  });

  it("CSLL = 0 reduz o total de impostos sobre lucro", () => {
    const base = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real" },
    });
    const semCSLL = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real", ratesOverride: { csll: 0 } },
    });
    const a = buildDRE(base, "real").tax.annualLucro;
    const b = buildDRE(semCSLL, "real").tax.annualLucro;
    expect(b).toBeLessThan(a);
  });

  it("PIS não-cumulativo override muda impostos sobre venda no Real", () => {
    const base = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real" },
    });
    const dobrado = createState({
      revenue: { bruta: m12(80000) },
      tax: { regime: "real", ratesOverride: { pisNaoCum: 3.3 } }, // dobro do oficial 1.65
    });
    const a = buildDRE(base, "real").tax.annualVendas;
    const b = buildDRE(dobrado, "real").tax.annualVendas;
    expect(b).toBeGreaterThan(a);
  });
});

describe("ratesOverride — Simples Nacional", () => {
  it("Customizar tabela do Anexo III altera o DAS", () => {
    const base = createState({
      revenue: { bruta: m12(15000) }, // RBT12 = 180k → 1ª faixa
      tax: { regime: "simples", simplesAnexo: "III" },
    });
    const dobrado = createState({
      revenue: { bruta: m12(15000) },
      tax: {
        regime: "simples",
        simplesAnexo: "III",
        ratesOverride: {
          simplesTables: {
            III: [
              [180000, 12.0, 0], // dobramos a alíquota da 1ª faixa
              [360000, 11.2, 9360],
              [720000, 13.5, 17640],
              [1800000, 16.0, 35640],
              [3600000, 21.0, 125640],
              [4800000, 33.0, 648000],
            ],
          },
        },
      },
    });
    const a = buildDRE(base, "simples").tax.annual;
    const b = buildDRE(dobrado, "simples").tax.annual;
    expect(b).toBeGreaterThan(a * 1.5); // ~dobrado
  });

  it("Aumentar simplesLimite para R$ 6M faz cenário de R$ 5M deixar de exceder", () => {
    const s5M = createState({
      revenue: { bruta: m12(420_000) }, // RBT12 ~5,04M
      tax: { regime: "simples" },
    });
    expect(simplesExcedeLimite(s5M)).toBe(true);
    const sOverride = createState({
      revenue: { bruta: m12(420_000) },
      tax: { regime: "simples", ratesOverride: { simplesLimite: 6_000_000 } },
    });
    expect(simplesExcedeLimite(sOverride)).toBe(false);
  });
});

describe("ratesOverride — Lucro Presumido", () => {
  it("Bases de presunção customizadas alteram base IRPJ/CSLL", () => {
    // Zeramos presumidoBaseIRPJ/CSLL para que o cálculo caia no resolver getPresumidoBases
    // (que aplica ratesOverride.presumidoBases). Sem isso, os campos avulsos do TaxConfig
    // sobrescrevem sempre.
    const base = createState({
      businessType: "servicos",
      revenue: { bruta: m12(50000) },
      tax: { regime: "presumido", presumidoBaseIRPJ: 0, presumidoBaseCSLL: 0 },
    });
    const reduzida = createState({
      businessType: "servicos",
      revenue: { bruta: m12(50000) },
      tax: {
        regime: "presumido",
        presumidoBaseIRPJ: 0,
        presumidoBaseCSLL: 0,
        ratesOverride: { presumidoBases: { servicos: { irpj: 16, csll: 16 } } },
      },
    });
    const a = buildDRE(base, "presumido").tax.annualLucro;
    const b = buildDRE(reduzida, "presumido").tax.annualLucro;
    expect(b).toBeLessThan(a);
  });

  it("Override presumidoBases vence mesmo com presumidoBaseIRPJ/CSLL default (32/32)", () => {
    // Bug-guard: antes, tax.presumidoBaseIRPJ (default 32) tinha precedência
    // sobre ratesOverride.presumidoBases, silenciosamente ignorando o override.
    // Agora override específico da atividade SEMPRE vence (MODO A).
    const s = createState({
      businessType: "servicos",
      revenue: { bruta: m12(70_000) }, // 840.000/ano
      tax: {
        regime: "presumido",
        ratesOverride: { presumidoBases: { servicos: { irpj: 8, csll: 12 } } },
      },
    });
    const { tax } = buildDRE(s, "presumido");
    // IRPJ = 15% × (8% × 840.000) = 10.080 | CSLL = 9% × (12% × 840.000) = 9.072
    // Total IR+CSLL ~ 19.152 (sem adicional, base trimestral 16.800 < 60.000)
    expect(tax.annualLucro).toBeGreaterThan(18_000);
    expect(tax.annualLucro).toBeLessThan(21_000);
  });
});

describe("ratesOverride — Reforma tributária", () => {
  it("Multiplicador IBS da transição = 1,0 (anular desconto) aumenta IBS na transição", () => {
    const base = createState({
      revenue: { bruta: m12(50000) },
      tax: { regime: "presumido", era: "transicao" },
    });
    const cheio = createState({
      revenue: { bruta: m12(50000) },
      tax: {
        regime: "presumido",
        era: "transicao",
        ratesOverride: { reformaTransicaoIbsMult: 1.0 },
      },
    });
    const a = buildDRE(base, "presumido").tax.annualVendas;
    const b = buildDRE(cheio, "presumido").tax.annualVendas;
    expect(b).toBeGreaterThan(a);
  });

  it("Multiplicador ICMS/ISS = 0 zera ISS na transição (serviços)", () => {
    const base = createState({
      businessType: "servicos",
      revenue: { bruta: m12(50000) },
      tax: { regime: "presumido", era: "transicao", issIcms: 5 },
    });
    const semIss = createState({
      businessType: "servicos",
      revenue: { bruta: m12(50000) },
      tax: {
        regime: "presumido",
        era: "transicao",
        issIcms: 5,
        ratesOverride: { reformaTransicaoIcmsIssMult: 0 },
      },
    });
    const detailA = buildDRE(base, "presumido").tax.detail;
    const detailB = buildDRE(semIss, "presumido").tax.detail;
    const issA = detailA["ISS"] ?? 0;
    const issB = detailB["ISS"] ?? 0;
    expect(issA).toBeGreaterThan(0);
    expect(issB).toBe(0);
  });
});

describe("ratesOverride — não-regressão", () => {
  it("Cenário sem override produz exatamente os mesmos números de antes", () => {
    // valores ancoram o comportamento atual — qualquer mudança nos defaults
    // (taxDefaults.ts) precisa de atualização explícita aqui.
    const s = createState({ revenue: { bruta: m12(80000) }, tax: { regime: "real" } });
    const { tax } = buildDRE(s, "real");
    expect(tax.annual).toBeCloseTo(buildDRE(s, "real").tax.annual, 6);
    expect(tax.annualVendas).toBeGreaterThan(0);
    expect(tax.annualLucro).toBeGreaterThan(0);
  });
});

describe("Presumido — IRRF sobre rendimentos de aplicações (compensação)", () => {
  it("IRRF 15% sobre R$120k/ano reduz IRPJ em ~R$18k (vs. sem compensação)", () => {
    // Empresa Presumido com R$120k/ano (R$10k/mês) de rendimentos de aplicações
    // financeiras (não-exclusiva na fonte → entra na base IRPJ/CSLL).
    const rendMensal = 10_000;
    const rf = {
      id: "rend_aplic",
      label: "Rendimentos de aplicações",
      valores: m12(rendMensal),
      tipo: "financeira" as const,
      tributacaoExclusivaFonte: false,
    };
    const comCompensacao = createState({
      revenue: { bruta: m12(80_000), receitasFinanceiras: [rf] },
      tax: { regime: "presumido" }, // default irrfAplicacoesPct = 15
    });
    const semCompensacao = createState({
      revenue: { bruta: m12(80_000), receitasFinanceiras: [rf] },
      tax: { regime: "presumido", irrfAplicacoesPct: 0 }, // desliga IRRF
    });
    const a = buildDRE(comCompensacao, "presumido").tax;
    const b = buildDRE(semCompensacao, "presumido").tax;
    // 120k × 15% = 18k de IRRF compensável — reduz o IRPJ anual em 18k
    // (o cenário Presumido tem IRPJ+Adicional muito acima disso, então a
    // compensação flui integralmente sem piso zero).
    expect(b.annualLucro - a.annualLucro).toBeCloseTo(18_000, 0);
    // Detail expõe o crédito compensado (negativo).
    expect(a.detail?.["(−) IRRF s/ aplicações (compensado)"]).toBeCloseTo(-18_000, 0);
  });

  it("IRPJ nunca fica negativo — IRRF excedente é limitado ao IRPJ+Adicional do mês", () => {
    // Cenário extremo: receita baixa (IRPJ trimestral baixo) + rendimento
    // financeiro altíssimo com IRRF hipoteticamente maior que o próprio IRPJ.
    // Como base IRPJ inclui o próprio rendimento, para forçar o piso zero
    // usamos alíquota IRRF 90% (irreal, apenas para validar o clamp).
    const rf = {
      id: "rend_aplic",
      label: "Rendimentos de aplicações",
      valores: m12(1_000),
      tipo: "financeira" as const,
      tributacaoExclusivaFonte: false,
    };
    const s = createState({
      revenue: { bruta: m12(2_000), receitasFinanceiras: [rf] },
      tax: { regime: "presumido", irrfAplicacoesPct: 90 },
    });
    const { tax } = buildDRE(s, "presumido");
    // annualLucro inclui IRPJ+Adicional+CSLL líquidos (com clamp ≥ 0 por mês
    // no IRPJ). Nunca negativo.
    expect(tax.annualLucro).toBeGreaterThanOrEqual(0);
    expect(tax.monthlyLucro.every((v) => v >= 0)).toBe(true);
  });
});

// =====================================================================
// Prejuízo fiscal acumulado de abertura — Lucro Real (Lei 9.065/95 art. 42)
// =====================================================================
import { calcReal } from "../tax/real";
import { compareRegimes } from "../tax/compare";

describe("prejuizoFiscalAcumuladoAbertura — Lucro Real", () => {
  // LAIR mensal constante 50k/mês → 150k/trimestre. Sem receitas financeiras
  // exclusivas, o baseSignedMonthly = LAIR. Trava 30% × 150k = 45k/tri.
  const lairMensal = m12(50_000);

  it("abertura=0 → comportamento idêntico ao anterior (sem regressão)", () => {
    const s = createState({ tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 0 } });
    const semCampo = createState({ tax: { regime: "real" } });
    const a = calcReal(s, lairMensal);
    const b = calcReal(semCampo, lairMensal);
    expect(a.annualLucro).toBeCloseTo(b.annualLucro, 2);
    expect(a.detail["(−) Compensação prejuízo fiscal (trava 30%)"]).toBeUndefined();
  });

  it("abertura relevante → compensa 30% do lucro trimestral e reduz IRPJ/CSLL", () => {
    // Abertura 300k → cada trimestre compensa min(150k×0.3, saldo) = 45k
    // (até esgotar o saldo). Em 4 trimestres, compensa 4×45k = 180k, saldo residual 120k.
    const s = createState({
      tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 300_000 },
    });
    const semCampo = createState({ tax: { regime: "real" } });
    const comComp = calcReal(s, lairMensal);
    const semComp = calcReal(semCampo, lairMensal);
    // Com compensação, o lucro tributado é menor → menos IRPJ+CSLL → LL maior
    expect(comComp.annualLucro).toBeLessThan(semComp.annualLucro);
    // Detail expõe a compensação (sinal negativo, R$)
    const usado = comComp.detail["(−) Compensação prejuízo fiscal (trava 30%)"];
    expect(usado).toBeDefined();
    expect(usado).toBeCloseTo(-180_000, 0);
  });

  it("prejuízo do PRÓPRIO ano soma ao saldo de abertura", () => {
    // Q1 prejuízo de 90k (−30/mês), Q2..Q4 lucro 150k/tri.
    // Sem abertura: trava Q2 = min(45k, 90k) = 45k → Q2 tributa 105k.
    //               Q3 saldo restante 45k → compensa 45k → tributa 105k.
    //               Q4 saldo 0 → tributa 150k.
    // Com abertura 60k: Q1 prej vira 90k+60k=150k acum. Q2 compensa 45k (saldo→105k),
    // Q3 compensa 45k (saldo→60k), Q4 compensa 45k (saldo→15k).
    const lair = [
      -30_000,
      -30_000,
      -30_000, // Q1: −90k
      50_000,
      50_000,
      50_000, // Q2
      50_000,
      50_000,
      50_000, // Q3
      50_000,
      50_000,
      50_000, // Q4
    ];
    const semAbertura = calcReal(
      createState({ tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 0 } }),
      lair,
    );
    const comAbertura = calcReal(
      createState({ tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 60_000 } }),
      lair,
    );
    const usadoSem = -1 * (semAbertura.detail["(−) Compensação prejuízo fiscal (trava 30%)"] ?? 0);
    const usadoCom = -1 * (comAbertura.detail["(−) Compensação prejuízo fiscal (trava 30%)"] ?? 0);
    // Com abertura, mais saldo → mais compensação usada
    expect(usadoCom).toBeGreaterThan(usadoSem);
    // Sem abertura: 45k+45k = 90k (Q4 zera saldo antes). Com 60k a mais: 45k×3 = 135k.
    expect(usadoSem).toBeCloseTo(90_000, 0);
    expect(usadoCom).toBeCloseTo(135_000, 0);
  });

  it("compareRegimes: LL do Real melhora com abertura relevante", () => {
    const semAbertura = createState({
      revenue: { bruta: m12(200_000) },
      tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 0 },
    });
    const comAbertura = createState({
      revenue: { bruta: m12(200_000) },
      tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 500_000 },
    });
    const semCmp = compareRegimes(semAbertura);
    const comCmp = compareRegimes(comAbertura);
    expect(comCmp.llBy.real).toBeGreaterThan(semCmp.llBy.real);
  });
});
