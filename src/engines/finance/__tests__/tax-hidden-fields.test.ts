/**
 * Cobre os 6 campos fiscais que estavam sem UI no TaxSettingsDialog (P0 da
 * auditoria). Cada teste demonstra que o campo IMPACTA o resultado do DRE
 * na direção esperada — o fix estrutural é UI, mas garantimos aqui que o
 * engine responde corretamente aos valores exibidos.
 */
import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { createState, m12 } from "./helpers";

describe("Auditoria TaxSettingsDialog — campos expostos", () => {
  it("issDeducoes reduz o ISS anual (Presumido, serviços)", () => {
    const base = createState({
      businessType: "servicos",
      revenue: { bruta: m12(50_000) },
      tax: { regime: "presumido", issIcms: 5 },
    });
    const com = createState({
      businessType: "servicos",
      revenue: { bruta: m12(50_000) },
      tax: { regime: "presumido", issIcms: 5, issDeducoes: 60_000 },
    });
    const issA = buildDRE(base, "presumido").tax.annualVendas;
    const issB = buildDRE(com, "presumido").tax.annualVendas;
    // Dedução de 60k/ano = 5k/mês, reduz base do ISS em 5k → ISS cai 5% de 5k = 250/mês = 3000/ano
    expect(issA - issB).toBeGreaterThan(2_500);
    expect(issA - issB).toBeLessThan(3_500);
  });

  it("pisCreditos + cofinsCreditos reduzem os impostos sobre venda (Real)", () => {
    const base = createState({
      revenue: { bruta: m12(80_000) },
      tax: { regime: "real" },
    });
    const com = createState({
      revenue: { bruta: m12(80_000) },
      tax: { regime: "real", pisCreditos: 12_000, cofinsCreditos: 24_000 },
    });
    const a = buildDRE(base, "real").tax.annualVendas;
    const b = buildDRE(com, "real").tax.annualVendas;
    // Créditos anuais somam 36.000 — imposto sobre venda deve cair aprox. isso
    expect(a - b).toBeGreaterThan(30_000);
    expect(a - b).toBeLessThan(40_000);
  });

  it("aliquotaICMSCredito reduz ICMS efetivo (Presumido, comércio)", () => {
    const base = createState({
      businessType: "comercio",
      revenue: { bruta: m12(100_000) },
      tax: { regime: "presumido", issIcms: 18 },
      costs: [
        {
          id: "cpv",
          nome: "Mercadoria",
          categoria: "CMV",
          tipo: "variavel_receita",
          percentualReceita: 60,
          months: m12(0),
        } as any,
      ],
    });
    const com = createState({
      businessType: "comercio",
      revenue: { bruta: m12(100_000) },
      tax: { regime: "presumido", issIcms: 18, aliquotaICMSCredito: 12 },
      costs: [
        {
          id: "cpv",
          nome: "Mercadoria",
          categoria: "CMV",
          tipo: "variavel_receita",
          percentualReceita: 60,
          months: m12(0),
        } as any,
      ],
    });
    const a = buildDRE(base, "presumido").tax.annualVendas;
    const b = buildDRE(com, "presumido").tax.annualVendas;
    expect(b).toBeLessThan(a);
  });

  it("prejuizoFiscalAcumuladoAbertura reduz IRPJ do primeiro trimestre lucrativo (Real, trava 30%)", () => {
    const base = createState({
      revenue: { bruta: m12(80_000) },
      tax: { regime: "real" },
    });
    const com = createState({
      revenue: { bruta: m12(80_000) },
      tax: { regime: "real", prejuizoFiscalAcumuladoAbertura: 100_000 },
    });
    const a = buildDRE(base, "real").tax.annualLucro;
    const b = buildDRE(com, "real").tax.annualLucro;
    expect(b).toBeLessThan(a);
  });

  it("irrfAplicacoesPct compensa IRPJ no Presumido quando há rendimento financeiro", () => {
    const rend = m12(10_000); // 120k/ano de rendimento financeiro
    const base = createState({
      revenue: { bruta: m12(50_000), financeiras: rend },
      tax: { regime: "presumido", irrfAplicacoesPct: 0 },
    });
    const com = createState({
      revenue: { bruta: m12(50_000), financeiras: rend },
      tax: { regime: "presumido", irrfAplicacoesPct: 15 },
    });
    const a = buildDRE(base, "presumido").tax.annualLucro;
    const b = buildDRE(com, "presumido").tax.annualLucro;
    // IRRF de 15% sobre rendFin compensa IRPJ → imposto sobre lucro cai
    expect(b).toBeLessThan(a);
  });
});
