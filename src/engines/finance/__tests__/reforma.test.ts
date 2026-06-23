// Testes do cronograma da Reforma Tributária (LC 214/2025 + EC 132/2023).
// Cobre: eras discretas, cronograma ano-a-ano, créditos presumidos SN,
// fronteiras de transição (2026, 2029, 2033) e alertas de overshoot.

import { describe, expect, it } from "vitest";
import {
  eraForYear,
  getCbsCredCpvPct,
  getCbsPctForYear,
  getIbsCredCpvPct,
  getIbsFractionForYear,
  getIcmsIssFractionForYear,
  getPisCofinsFractionForYear,
  getReformaRates,
  getReformaRatesForYear,
  ALIQ_PRESUMIDA_CBS_SN,
  ALIQ_PRESUMIDA_IBS_SN,
} from "../tax/reforma";
import {
  CBS_ALIQUOTA_PLENA,
  CBS_ALIQUOTA_2026_TESTE,
  IBS_ALIQUOTA_PLENA,
} from "../taxDefaults";
import type { TaxConfig } from "../types";

const cfg = (over: Partial<TaxConfig> = {}): TaxConfig => ({
  regime: "real",
  simplesAnexo: "I",
  fatorR: 0,
  presumidoBaseIRPJ: 8,
  presumidoBaseCSLL: 12,
  issIcms: 18,
  pisCreditos: 0,
  cofinsCreditos: 0,
  ...over,
});

describe("eraForYear — fronteiras", () => {
  it("retorna 'atual' para anos < 2026", () => {
    expect(eraForYear(2024)).toBe("atual");
    expect(eraForYear(2025)).toBe("atual");
  });

  it("retorna 'transicao' de 2026 a 2032 inclusive", () => {
    for (const y of [2026, 2027, 2029, 2030, 2032]) {
      expect(eraForYear(y)).toBe("transicao");
    }
  });

  it("retorna 'pleno' a partir de 2033", () => {
    expect(eraForYear(2033)).toBe("pleno");
    expect(eraForYear(2040)).toBe("pleno");
  });
});

describe("getIbsFractionForYear — cronograma oficial", () => {
  it("zero antes de 2026", () => {
    expect(getIbsFractionForYear(2025, IBS_ALIQUOTA_PLENA)).toBe(0);
  });

  it("fase de teste 2026-2028: ~0,1% absoluto (= 0,1/ibsFull)", () => {
    const f = getIbsFractionForYear(2026, IBS_ALIQUOTA_PLENA);
    expect(f * IBS_ALIQUOTA_PLENA).toBeCloseTo(0.1, 5);
    expect(getIbsFractionForYear(2027, IBS_ALIQUOTA_PLENA)).toBe(f);
    expect(getIbsFractionForYear(2028, IBS_ALIQUOTA_PLENA)).toBe(f);
  });

  it("rampa 2029→2032: 10/20/30/40%", () => {
    expect(getIbsFractionForYear(2029, IBS_ALIQUOTA_PLENA)).toBe(0.1);
    expect(getIbsFractionForYear(2030, IBS_ALIQUOTA_PLENA)).toBe(0.2);
    expect(getIbsFractionForYear(2031, IBS_ALIQUOTA_PLENA)).toBe(0.3);
    expect(getIbsFractionForYear(2032, IBS_ALIQUOTA_PLENA)).toBe(0.4);
  });

  it("pleno (100%) a partir de 2033", () => {
    expect(getIbsFractionForYear(2033, IBS_ALIQUOTA_PLENA)).toBe(1);
    expect(getIbsFractionForYear(2050, IBS_ALIQUOTA_PLENA)).toBe(1);
  });

  it("ibsFull = 0 não explode (divisão por zero protegida)", () => {
    expect(getIbsFractionForYear(2026, 0)).toBe(0);
  });
});

describe("getIcmsIssFractionForYear — decaimento ICMS/ISS legado", () => {
  it("100% até 2028, decaindo 10pp/ano de 2029 a 2032, zero em 2033+", () => {
    expect(getIcmsIssFractionForYear(2025)).toBe(1);
    expect(getIcmsIssFractionForYear(2028)).toBe(1);
    expect(getIcmsIssFractionForYear(2029)).toBe(0.9);
    expect(getIcmsIssFractionForYear(2030)).toBe(0.8);
    expect(getIcmsIssFractionForYear(2031)).toBe(0.7);
    expect(getIcmsIssFractionForYear(2032)).toBe(0.6);
    expect(getIcmsIssFractionForYear(2033)).toBe(0);
    expect(getIcmsIssFractionForYear(2040)).toBe(0);
  });

  it("monotonicamente não crescente 2025→2033", () => {
    const seq = [2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033].map(
      getIcmsIssFractionForYear,
    );
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
  });
});

describe("getPisCofinsFractionForYear — extinção em 2027", () => {
  it("100% em 2026 (CBS 0,9% compensável), 0% a partir de 2027", () => {
    expect(getPisCofinsFractionForYear(2025)).toBe(1);
    expect(getPisCofinsFractionForYear(2026)).toBe(1);
    expect(getPisCofinsFractionForYear(2027)).toBe(0);
    expect(getPisCofinsFractionForYear(2033)).toBe(0);
  });
});

describe("getCbsPctForYear — fase de teste vs pleno", () => {
  it("0% antes de 2026", () => {
    expect(getCbsPctForYear(2025, CBS_ALIQUOTA_PLENA)).toBe(0);
  });

  it("0,9% em 2026 (fase de teste, compensável com PIS/COFINS)", () => {
    expect(getCbsPctForYear(2026, CBS_ALIQUOTA_PLENA)).toBe(CBS_ALIQUOTA_2026_TESTE);
  });

  it("alíquota plena a partir de 2027", () => {
    expect(getCbsPctForYear(2027, CBS_ALIQUOTA_PLENA)).toBe(CBS_ALIQUOTA_PLENA);
    expect(getCbsPctForYear(2033, CBS_ALIQUOTA_PLENA)).toBe(CBS_ALIQUOTA_PLENA);
  });
});

describe("getReformaRatesForYear — integração ano-a-ano", () => {
  it("ano pré-reforma (2025): tudo zero/100% legado, sem alerta", () => {
    const r = getReformaRatesForYear(2025, cfg());
    expect(r.cbsPct).toBe(0);
    expect(r.ibsPct).toBe(0);
    expect(r.pisCofinsMult).toBe(1);
    expect(r.icmsIssMult).toBe(1);
    expect(r.alertaTransicao).toBe(false);
  });

  it("2026: CBS 0,9%, PIS/COFINS ainda 100%, ICMS 100%", () => {
    const r = getReformaRatesForYear(2026, cfg());
    expect(r.cbsPct).toBe(CBS_ALIQUOTA_2026_TESTE);
    expect(r.pisCofinsMult).toBe(1);
    expect(r.icmsIssMult).toBe(1);
  });

  it("2033 pleno: CBS+IBS full, PIS/COFINS e ICMS extintos", () => {
    const r = getReformaRatesForYear(2033, cfg());
    expect(r.cbsPct).toBe(CBS_ALIQUOTA_PLENA);
    expect(r.ibsPct).toBeCloseTo(IBS_ALIQUOTA_PLENA, 5);
    expect(r.pisCofinsMult).toBe(0);
    expect(r.icmsIssMult).toBe(0);
  });

  it("IBS cresce monotonicamente de 2029 a 2033", () => {
    const ibs = [2029, 2030, 2031, 2032, 2033].map(
      (y) => getReformaRatesForYear(y, cfg()).ibsPct,
    );
    for (let i = 1; i < ibs.length; i++) expect(ibs[i]).toBeGreaterThan(ibs[i - 1]);
  });

  it("ICMS legado decresce monotonicamente de 2028 a 2033", () => {
    const icms = [2028, 2029, 2030, 2031, 2032, 2033].map(
      (y) => getReformaRatesForYear(y, cfg()).icmsIssMult,
    );
    for (let i = 1; i < icms.length; i++) expect(icms[i]).toBeLessThanOrEqual(icms[i - 1]);
  });

  it("alertaTransicao=true quando carga combinada > carga atual + 0,01", () => {
    // Em 2030: CBS 8,8 + IBS 17,7×0,2=3,54 + ICMS 18×0,8=14,4 = 26,74 > 18
    const r = getReformaRatesForYear(2030, cfg({ issIcms: 18 }));
    expect(r.cargaCombinadaPct).toBeGreaterThan(18);
    expect(r.alertaTransicao).toBe(true);
  });

  it("respeita override de cbsAliquota e ibsAliquotaRef", () => {
    const r = getReformaRatesForYear(2033, cfg({ cbsAliquota: 10, ibsAliquotaRef: 20 }));
    expect(r.cbsPct).toBe(10);
    expect(r.ibsPct).toBeCloseTo(20, 5);
  });
});

describe("getReformaRates — versão por era discreta", () => {
  it("'atual' = zera CBS/IBS, mantém legado integral", () => {
    const r = getReformaRates("atual", cfg());
    expect(r).toEqual({ cbsPct: 0, ibsPct: 0, pisCofinsMult: 1, icmsIssMult: 1 });
  });

  it("'pleno' = CBS+IBS cheios, legado extinto", () => {
    const r = getReformaRates("pleno", cfg());
    expect(r.cbsPct).toBe(CBS_ALIQUOTA_PLENA);
    expect(r.ibsPct).toBeCloseTo(IBS_ALIQUOTA_PLENA, 5);
    expect(r.pisCofinsMult).toBe(0);
    expect(r.icmsIssMult).toBe(0);
  });

  it("'transicao' = CBS pleno, IBS×mult, PIS/COFINS extintos, ICMS×mult", () => {
    const r = getReformaRates("transicao", cfg());
    expect(r.cbsPct).toBe(CBS_ALIQUOTA_PLENA);
    expect(r.pisCofinsMult).toBe(0);
    // mults vêm dos defaults (não devem explodir e devem ser ≤ 1)
    expect(r.icmsIssMult).toBeGreaterThanOrEqual(0);
    expect(r.icmsIssMult).toBeLessThanOrEqual(1);
  });

  it("era undefined ≡ 'atual' (não lança)", () => {
    expect(() => getReformaRates(undefined, cfg())).not.toThrow();
    expect(getReformaRates(undefined, cfg()).cbsPct).toBe(0);
  });
});

describe("getCbsCredCpvPct / getIbsCredCpvPct — créditos presumidos SN", () => {
  it("zero crédito quando alíquota = 0", () => {
    expect(getCbsCredCpvPct(0, 50)).toBe(0);
    expect(getIbsCredCpvPct(0, 50)).toBe(0);
  });

  it("snFornecedorPct=0 → crédito = alíquota cheia (todos no regime regular)", () => {
    expect(getCbsCredCpvPct(8.8, 0)).toBe(8.8);
    expect(getIbsCredCpvPct(17.7, 0)).toBe(17.7);
  });

  it("snFornecedorPct=100 → crédito = presumida SN (limitada à alíquota cheia)", () => {
    expect(getCbsCredCpvPct(8.8, 100)).toBe(ALIQ_PRESUMIDA_CBS_SN);
    expect(getIbsCredCpvPct(17.7, 100)).toBe(ALIQ_PRESUMIDA_IBS_SN);
  });

  it("ponderação linear: 50/50 entre cheia e presumida", () => {
    const cbs = getCbsCredCpvPct(8.8, 50);
    expect(cbs).toBeCloseTo(0.5 * 8.8 + 0.5 * ALIQ_PRESUMIDA_CBS_SN, 5);
  });

  it("cap da presumida na alíquota cheia (fase teste 2026: CBS 0,9% < 3%)", () => {
    // Quando cheia=0,9%, presumida (3%) é capeada em 0,9% → todos pagam 0,9%
    expect(getCbsCredCpvPct(0.9, 100)).toBe(0.9);
    expect(getCbsCredCpvPct(0.9, 50)).toBeCloseTo(0.9, 5);
  });

  it("snFornecedorPct fora do range [0,100] é clamped", () => {
    expect(getCbsCredCpvPct(8.8, -50)).toBe(8.8); // tratado como 0
    expect(getCbsCredCpvPct(8.8, 200)).toBe(ALIQ_PRESUMIDA_CBS_SN); // tratado como 100
  });
});
