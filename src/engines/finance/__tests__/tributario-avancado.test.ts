// Lucro Real (Lalur/Lacs, base negativa de CSLL, créditos de PIS/COFINS por
// natureza), ICMS-ST, DIFAL e redução setorial da Reforma — valores à mão.
import { describe, expect, it } from "vitest";
import { createState, m12 } from "./helpers";
import { calcReal } from "../tax/real";
import { calcPresumido } from "../tax/presumido";
import type { AppState, CostLine, TaxConfig } from "../types";

const linha = (id: string, label: string, category: CostLine["category"], v: number): CostLine => ({
  id,
  label,
  category,
  values: m12(v),
  fixed: false,
});

/** Empresa de serviços no Lucro Real, receita 100 mil/mês, sem descontos. */
function real(tax: Partial<TaxConfig> = {}, costs: CostLine[] = []): AppState {
  const s = createState();
  return {
    ...s,
    businessType: "servicos",
    revenue: { ...s.revenue, bruta: m12(100_000) },
    costs,
    tax: {
      ...s.tax,
      regime: "real",
      era: "atual",
      issIcms: 5,
      pisCreditos: 0,
      cofinsCreditos: 0,
      ...tax,
    },
  };
}

const LAIR = m12(10_000); // 30 mil por trimestre

describe("Lucro Real — Lalur/Lacs", () => {
  it("adição de 12 mil/ano nas duas bases: IRPJ e CSLL sobre 11 mil/mês", () => {
    const t = calcReal(
      real({
        lalurAjustes: [
          { id: "1", descricao: "Multas indedutíveis", tipo: "adicao", valorAnual: 12_000 },
        ],
      }),
      LAIR,
    );
    // IRPJ 15% × 132.000 = 19.800 (sem adicional: 33 mil/tri < 60 mil); CSLL 9% = 11.880
    expect(t.detail.IRPJ).toBeCloseTo(19_800, 6);
    expect(t.detail["Adicional IRPJ (10%)"]).toBeCloseTo(0, 6);
    expect(t.detail.CSLL).toBeCloseTo(11_880, 6);
    expect(t.detail["Ajustes Lalur (adições − exclusões)"]).toBeCloseTo(12_000, 6);
  });

  it("exclusão só na CSLL: IRPJ sobre 120 mil, CSLL sobre 96 mil", () => {
    const t = calcReal(
      real({
        lalurAjustes: [
          {
            id: "1",
            descricao: "Exclusão Lacs",
            tipo: "exclusao",
            valorAnual: 24_000,
            base: "csll",
          },
        ],
      }),
      LAIR,
    );
    expect(t.detail.IRPJ).toBeCloseTo(18_000, 6);
    expect(t.detail.CSLL).toBeCloseTo(8_640, 6);
    expect(t.detail["Ajustes Lacs (adições − exclusões)"]).toBeCloseTo(-24_000, 6);
  });

  it("base negativa de CSLL separada do prejuízo fiscal (trava de 30%)", () => {
    const t = calcReal(
      real({ prejuizoFiscalAcumuladoAbertura: 0, baseNegativaCsllAbertura: 100_000 }),
      LAIR,
    );
    // IRPJ sem compensação: 15% × 120 mil. CSLL compensa 9 mil por trimestre
    // (30% de 30 mil) → base 84 mil → 7.560.
    expect(t.detail.IRPJ).toBeCloseTo(18_000, 6);
    expect(t.detail.CSLL).toBeCloseTo(7_560, 6);
    expect(t.detail["(−) Compensação base negativa CSLL (trava 30%)"]).toBeCloseTo(-36_000, 6);
    expect(t.detail["(−) Compensação prejuízo fiscal (trava 30%)"]).toBeUndefined();
  });

  it("sem base negativa informada, a CSLL usa o prejuízo fiscal (compatível com antes)", () => {
    const t = calcReal(real({ prejuizoFiscalAcumuladoAbertura: 100_000 }), LAIR);
    expect(t.detail.IRPJ).toBeCloseTo((15 / 100) * 84_000, 6);
    expect(t.detail.CSLL).toBeCloseTo((9 / 100) * 84_000, 6);
  });
});

describe("Lucro Real — créditos de PIS/COFINS por natureza", () => {
  const custos = [
    linha("cpv", "Insumos de produção", "custo_vendas", 20_000),
    linha("ene", "Energia elétrica", "despesa_administrativa", 2_000),
    linha("alu", "Aluguel do galpão", "despesa_administrativa", 3_000),
    linha("sal", "Salários", "despesa_administrativa", 10_000), // folha: sem crédito
    linha("mkt", "Marketing digital", "despesa_comercial", 5_000), // sem direito
  ];

  it("crédito sobre 25 mil/mês: PIS 412,50 e COFINS 1.900 por mês a menos", () => {
    const sem = calcReal(real({}, custos), LAIR);
    const com = calcReal(real({ pisCofinsCreditoAuto: true }, custos), LAIR);
    expect(sem.detail["PIS (não-cum.)"] - com.detail["PIS (não-cum.)"]).toBeCloseTo(412.5 * 12, 6);
    expect(sem.detail["COFINS (não-cum.)"] - com.detail["COFINS (não-cum.)"]).toBeCloseTo(
      1_900 * 12,
      6,
    );
    expect(com.detail["Base de créditos PIS/COFINS (custos com direito)"]).toBeCloseTo(300_000, 6);
  });

  it("linha marcada sem crédito fica fora", () => {
    const semCred = custos.map((c) => (c.id === "alu" ? { ...c, semCredito: true } : c));
    const com = calcReal(real({ pisCofinsCreditoAuto: true }, semCred), LAIR);
    expect(com.detail["Base de créditos PIS/COFINS (custos com direito)"]).toBeCloseTo(264_000, 6);
  });
});

/** Comércio no Presumido, ICMS 18%, sem crédito de entrada. */
function comercio(tax: Partial<TaxConfig> = {}): AppState {
  const s = real(tax);
  return {
    ...s,
    businessType: "comercio",
    tax: { ...s.tax, regime: "presumido", issIcms: 18, aliquotaICMSCredito: 0, ...tax },
  };
}

describe("ICMS-ST e DIFAL", () => {
  it("40% da receita com ST: ICMS próprio cai para 60%", () => {
    const base = calcPresumido(comercio()).detail["ICMS (líquido)"];
    const st = calcPresumido(comercio({ icmsStReceitaPct: 40 })).detail["ICMS (líquido)"];
    expect(base).toBeCloseTo(0.18 * 1_200_000, 6);
    expect(st).toBeCloseTo(0.18 * 1_200_000 * 0.6, 6);
  });

  it("DIFAL: 10% da receita a não contribuinte × 6 p.p. = 0,6% da receita", () => {
    const base = calcPresumido(comercio()).detail["ICMS (líquido)"];
    const difal = calcPresumido(comercio({ difalReceitaPct: 10, difalAliquotaPct: 6 })).detail[
      "ICMS (líquido)"
    ];
    expect(difal - base).toBeCloseTo(0.006 * 1_200_000, 6);
  });

  it("serviços não têm ST nem DIFAL", () => {
    const a = calcPresumido(real({ regime: "presumido" })).detail.ISS;
    const b = calcPresumido(
      real({
        regime: "presumido",
        icmsStReceitaPct: 50,
        difalReceitaPct: 50,
        difalAliquotaPct: 10,
      }),
    ).detail.ISS;
    expect(b).toBeCloseTo(a, 6);
  });
});

describe("Reforma — redução setorial da alíquota nas vendas", () => {
  const cbsDe = (t: ReturnType<typeof calcReal>) =>
    Object.entries(t.detail).find(([k]) => k.startsWith("CBS"))?.[1] ?? 0;

  it("redução de 60% (saúde/educação): CBS das vendas a 40% sem créditos", () => {
    const cheio = calcReal(real({ era: "pleno" }), LAIR);
    const reduzido = calcReal(real({ era: "pleno", reformaReducaoPct: 60 }), LAIR);
    expect(cbsDe(cheio)).toBeGreaterThan(0);
    expect(cbsDe(reduzido)).toBeCloseTo(cbsDe(cheio) * 0.4, 0);
  });

  it("alíquota zero (100%): nada de CBS a pagar", () => {
    expect(cbsDe(calcReal(real({ era: "pleno", reformaReducaoPct: 100 }), LAIR))).toBe(0);
  });
});
