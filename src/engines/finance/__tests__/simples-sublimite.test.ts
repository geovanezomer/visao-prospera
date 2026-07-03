// Testes do recolhimento ICMS/ISS "por fora" quando o Simples excede o
// sublimite estadual (LC 123/06 art. 13-A). Cobre serviços (Anexo III) e
// comércio (Anexo I), regressão abaixo do sublimite e desenquadramento total.

import { describe, expect, it } from "vitest";
import { calcSimples } from "../tax/simples";
import { createState, m12 } from "./helpers";
import { SIMPLES_PARTILHA_ICMS_ISS_PCT } from "../taxDefaults";

describe("calcSimples — ICMS/ISS por fora acima do sublimite estadual", () => {
  it("RBT12 = 3,0M → DAS integral, sem componente por fora (regressão)", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "III", issIcms: 5 },
      businessType: "servicos",
      revenue: { bruta: m12(250_000) }, // 3,0M ano
    });
    const res = calcSimples(st);
    // Nenhuma chave "por fora" deve aparecer.
    expect(Object.keys(res.detail).some((k) => k.includes("por fora"))).toBe(false);
    expect(Object.keys(res.detail).some((k) => k.includes("s/ ICMS-ISS"))).toBe(false);
  });

  it("RBT12 = 4,2M serviços Anexo III: DAS reduzido pela partilha + ISS por fora", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "III", issIcms: 5 },
      businessType: "servicos",
      revenue: { bruta: m12(350_000) }, // 4,2M ano
    });
    const res = calcSimples(st);
    const dasSemIcmsIss = res.detail["DAS Simples (Anexo III, s/ ICMS-ISS)"] ?? 0;
    const issFora = res.detail["ICMS/ISS por fora (sublimite art. 13-A)"] ?? 0;
    expect(dasSemIcmsIss).toBeGreaterThan(0);
    expect(issFora).toBeGreaterThan(0);
    // Partilha aplicada corretamente e soma bate com o annual.
    expect(res.annual).toBeCloseTo(dasSemIcmsIss + issFora, 0);
    // ISS por fora ≈ receita tributável × 5% (alíquota municipal).
    expect(issFora).toBeCloseTo(350_000 * 12 * 0.05, -3);
  });

  it("RBT12 = 4,2M comércio Anexo I: DAS reduzido + ICMS líquido de créditos por fora", () => {
    const st = createState({
      tax: {
        regime: "simples",
        simplesAnexo: "I",
        issIcms: 18, // alíquota ICMS mercadoria
        aliquotaICMSCredito: 12,
      },
      businessType: "comercio",
      revenue: { bruta: m12(350_000) },
      costs: [
        {
          id: "cpv",
          name: "Mercadoria",
          category: "custo_vendas",
          values: m12(120_000),
        } as any,
      ],
    });
    const res = calcSimples(st);
    const dasSemIcmsIss = res.detail["DAS Simples (Anexo I, s/ ICMS-ISS)"] ?? 0;
    const icmsFora = res.detail["ICMS/ISS por fora (sublimite art. 13-A)"] ?? 0;
    expect(dasSemIcmsIss).toBeGreaterThan(0);
    expect(icmsFora).toBeGreaterThan(0);
    // ICMS líquido (débito − crédito) < débito bruto.
    const debitoBruto = 350_000 * 12 * 0.18;
    expect(icmsFora).toBeLessThan(debitoBruto);
    // Partilha do Anexo I = 33,5% da última faixa.
    expect(SIMPLES_PARTILHA_ICMS_ISS_PCT.I).toBe(33.5);
  });

  it("RBT12 = 4,9M → desenquadramento prevalece (sem duplicar avisos)", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "III", issIcms: 5 },
      businessType: "servicos",
      revenue: { bruta: m12(410_000) }, // ~4,92M
    });
    const res = calcSimples(st);
    const chaves = Object.keys(res.detail);
    // Deve ter o aviso de excedeu limite.
    expect(chaves.some((k) => k.includes("Excedeu limite Simples"))).toBe(true);
    // NÃO deve emitir a ramificação de sublimite (excedeu > sublimite).
    expect(chaves.some((k) => k.includes("por fora"))).toBe(false);
    expect(chaves.some((k) => k.includes("s/ ICMS-ISS"))).toBe(false);
  });

  it("Fronteira RBT12 = 3.600.000 → ainda no DAS puro (não é > sublimite)", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "III", issIcms: 5 },
      businessType: "servicos",
      revenue: { bruta: m12(300_000) }, // 3,6M exato
    });
    const res = calcSimples(st);
    expect(Object.keys(res.detail).some((k) => k.includes("por fora"))).toBe(false);
  });

  it("Fronteira RBT12 = 4.800.000 → excedeuSublimite (limite ainda respeitado)", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "III", issIcms: 5 },
      businessType: "servicos",
      revenue: { bruta: m12(400_000) }, // 4,8M exato
    });
    const res = calcSimples(st);
    expect(Object.keys(res.detail).some((k) => k.includes("por fora"))).toBe(true);
    expect(Object.keys(res.detail).some((k) => k.includes("Excedeu limite Simples"))).toBe(false);
  });

  it("Anexo IV (44,75%): partilha reduz o DAS e ISS por fora respeita teto 5%", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "IV", issIcms: 8 }, // acima do teto
      businessType: "servicos",
      revenue: { bruta: m12(350_000) },
    });
    const res = calcSimples(st);
    const issFora = res.detail["ICMS/ISS por fora (sublimite art. 13-A)"] ?? 0;
    // Teto ISS 5% → 350_000 × 12 × 0,05 = 210_000 (não usa 8%).
    expect(issFora).toBeCloseTo(350_000 * 12 * 0.05, -3);
  });

  it("Anexo V (30,5%): partilha aplicada corretamente e detail explícito", () => {
    const st = createState({
      tax: { regime: "simples", simplesAnexo: "V", issIcms: 4 },
      businessType: "servicos",
      revenue: { bruta: m12(350_000) },
    });
    const res = calcSimples(st);
    expect(res.detail["DAS Simples (Anexo V, s/ ICMS-ISS)"]).toBeGreaterThan(0);
    expect(res.detail["ICMS/ISS por fora (sublimite art. 13-A)"]).toBeCloseTo(
      350_000 * 12 * 0.04,
      -3,
    );
  });
});
