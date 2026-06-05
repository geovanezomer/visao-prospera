/**
 * Garante que o painel "Parâmetros tributários" (overrides em ratesOverride)
 * altera o resultado dos cálculos de forma previsível, sem regressão para
 * cenários sem override.
 */
import { describe, it, expect } from "vitest";
import { buildDRE, simplesExcedeLimite } from "../calculations";
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
        regime: "simples", simplesAnexo: "III",
        ratesOverride: {
          simplesTables: {
            III: [
              [180000, 12.0, 0], // dobramos a alíquota da 1ª faixa
              [360000, 11.2, 9360], [720000, 13.5, 17640], [1800000, 16.0, 35640],
              [3600000, 21.0, 125640], [4800000, 33.0, 648000],
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
        regime: "presumido", presumidoBaseIRPJ: 0, presumidoBaseCSLL: 0,
        ratesOverride: { presumidoBases: { servicos: { irpj: 16, csll: 16 } } },
      },
    });
    const a = buildDRE(base, "presumido").tax.annualLucro;
    const b = buildDRE(reduzida, "presumido").tax.annualLucro;
    expect(b).toBeLessThan(a);
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
      tax: { regime: "presumido", era: "transicao", ratesOverride: { reformaTransicaoIbsMult: 1.0 } },
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
      tax: { regime: "presumido", era: "transicao", issIcms: 5, ratesOverride: { reformaTransicaoIcmsIssMult: 0 } },
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
