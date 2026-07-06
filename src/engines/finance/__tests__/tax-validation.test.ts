/**
 * Validação de faixas legais tributárias:
 *   1. validateTaxOverride → erro/aviso/ok conforme faixa hard × faixa legal
 *   2. Getters clampam overrides absurdos na faixa hard (defesa em profundidade)
 *   3. Todos os campos de FAIXAS_TRIBUTARIAS têm getter correspondente
 */
import { describe, it, expect } from "vitest";
import {
  FAIXAS_TRIBUTARIAS,
  validateTaxOverride,
  clampFaixa,
  clampCampo,
  taxOverridesSchema,
  type CampoTributario,
} from "../tax/validation";
import {
  getIrpjPct,
  getIrpjAdicionalPct,
  getIrpjAdicionalGatilhoTri,
  getCsllPct,
  getPisCumPct,
  getCofinsCumPct,
  getPisNaoCumPct,
  getCofinsNaoCumPct,
  getFatorRMinimoPct,
  getCbsAliquota,
  getIbsAliquotaRef,
  getPresumidoBases,
} from "../taxDefaults";
import type { TaxConfig } from "../types";

const cfg = (over: Partial<TaxConfig> = {}): TaxConfig => ({
  regime: "real",
  simplesAnexo: "I",
  fatorR: 0,
  presumidoBaseIRPJ: 8,
  presumidoBaseCSLL: 12,
  issIcms: 5,
  pisCreditos: 0,
  cofinsCreditos: 0,
  ...over,
});

describe("validateTaxOverride — ISS (LC 116: 2%–5%)", () => {
  it("dentro da faixa legal → ok", () => {
    const r = validateTaxOverride("iss", 3);
    expect(r.ok).toBe(true);
    expect(r.nivel).toBe("ok");
  });

  it("ISS 7% → aviso (fora da faixa legal, dentro do hard)", () => {
    const r = validateTaxOverride("iss", 7);
    expect(r.ok).toBe(true);
    expect(r.nivel).toBe("aviso");
    expect(r.msg).toMatch(/faixa legal usual/i);
  });

  it("ISS 30% → erro (acima do hard=25)", () => {
    const r = validateTaxOverride("iss", 30);
    expect(r.ok).toBe(false);
    expect(r.nivel).toBe("erro");
  });

  it("ISS negativo → erro", () => {
    const r = validateTaxOverride("iss", -1);
    expect(r.ok).toBe(false);
    expect(r.nivel).toBe("erro");
  });

  it("NaN/Infinity → erro", () => {
    expect(validateTaxOverride("iss", NaN).nivel).toBe("erro");
    expect(validateTaxOverride("iss", Infinity).nivel).toBe("erro");
  });
});

describe("validateTaxOverride — faixas legais pontuais (legalMin=legalMax)", () => {
  it("IRPJ 15 → ok; IRPJ 20 → aviso; IRPJ 50 → erro", () => {
    expect(validateTaxOverride("irpj", 15).nivel).toBe("ok");
    expect(validateTaxOverride("irpj", 20).nivel).toBe("aviso");
    expect(validateTaxOverride("irpj", 50).nivel).toBe("erro");
  });

  it("PIS cumulativo 0,65 → ok; 2 → aviso; 6 → erro", () => {
    expect(validateTaxOverride("pisCum", 0.65).nivel).toBe("ok");
    expect(validateTaxOverride("pisCum", 2).nivel).toBe("aviso");
    expect(validateTaxOverride("pisCum", 6).nivel).toBe("erro");
  });

  it("CBS 9 → ok (dentro 8–10); 12 → aviso; 25 → erro", () => {
    expect(validateTaxOverride("cbsAliquota", 9).nivel).toBe("ok");
    expect(validateTaxOverride("cbsAliquota", 12).nivel).toBe("aviso");
    expect(validateTaxOverride("cbsAliquota", 25).nivel).toBe("erro");
  });
});

describe("validateTaxOverride — campo desconhecido", () => {
  it("não bloqueia (ok, sem faixa registrada)", () => {
    const r = validateTaxOverride("campoInexistente", 999);
    expect(r.ok).toBe(true);
    expect(r.nivel).toBe("ok");
  });
});

describe("clampFaixa / clampCampo — defesa em profundidade", () => {
  it("clampa acima do hard.max", () => {
    expect(clampCampo("iss", 999)).toBe(FAIXAS_TRIBUTARIAS.iss.max);
    expect(clampCampo("irpj", 500)).toBe(FAIXAS_TRIBUTARIAS.irpj.max);
  });

  it("clampa abaixo do hard.min", () => {
    expect(clampCampo("iss", -50)).toBe(0);
    expect(clampCampo("csll", -1)).toBe(0);
  });

  it("mantém valor dentro do intervalo", () => {
    expect(clampCampo("iss", 3)).toBe(3);
    expect(clampFaixa(15, FAIXAS_TRIBUTARIAS.irpj)).toBe(15);
  });

  it("NaN vai para o mínimo", () => {
    expect(clampCampo("iss", NaN)).toBe(0);
  });
});

describe("taxOverridesSchema (Zod) — bloqueia valores absurdos", () => {
  it("aceita override plausível", () => {
    const r = taxOverridesSchema.safeParse({ iss: 4, irpj: 15 });
    expect(r.success).toBe(true);
  });

  it("rejeita ISS 80%", () => {
    const r = taxOverridesSchema.safeParse({ iss: 80 });
    expect(r.success).toBe(false);
  });

  it("rejeita IRPJ negativo", () => {
    const r = taxOverridesSchema.safeParse({ irpj: -5 });
    expect(r.success).toBe(false);
  });
});

describe("Getters clampam override fora do range (snapshot corrompido)", () => {
  it("getPisCumPct: override 99 → clampado em 5 (hard.max)", () => {
    const t = cfg({ ratesOverride: { pisCum: 99 } });
    expect(getPisCumPct(t)).toBe(5);
  });

  it("getIrpjPct: override -100 → clampado em 0", () => {
    const t = cfg({ ratesOverride: { irpj: -100 } });
    expect(getIrpjPct(t)).toBe(0);
  });

  it("getCbsAliquota: tax.cbsAliquota=999 → clampado em 20", () => {
    const t = cfg({ cbsAliquota: 999 });
    expect(getCbsAliquota(t)).toBe(20);
  });

  it("getIbsAliquotaRef: tax.ibsAliquotaRef=-10 → clampado em 0", () => {
    const t = cfg({ ibsAliquotaRef: -10 });
    expect(getIbsAliquotaRef(t)).toBe(0);
  });

  it("getPresumidoBases: base IRPJ absurda (999) → clampada em 100", () => {
    const t = cfg({ ratesOverride: { presumidoBases: { servicos: { irpj: 999, csll: 32 } } } });
    const b = getPresumidoBases(t, "servicos");
    expect(b.irpj).toBe(100);
    expect(b.csll).toBe(32);
  });

  it("valor plausível NÃO é clampado", () => {
    const t = cfg({ ratesOverride: { irpj: 15 }, issIcms: 4 });
    expect(getIrpjPct(t)).toBe(15);
  });
});

describe("Cobertura: cada campo de FAIXAS_TRIBUTARIAS tem getter/uso associado", () => {
  // Map campo → função que resolve o valor efetivo a partir de TaxConfig.
  const GETTERS: Record<CampoTributario, (t: TaxConfig) => number> = {
    irpj:              (t) => getIrpjPct(t),
    irpjAdicional:     (t) => getIrpjAdicionalPct(t),
    irpjAdicionalGatilhoTri: (t) => getIrpjAdicionalGatilhoTri(t),
    csll:              (t) => getCsllPct(t),
    pisCum:            (t) => getPisCumPct(t),
    cofinsCum:         (t) => getCofinsCumPct(t),
    pisNaoCum:         (t) => getPisNaoCumPct(t),
    cofinsNaoCum:      (t) => getCofinsNaoCumPct(t),
    iss:               (t) => t.issIcms, // valor direto do state.tax — usado na engine
    cbsAliquota:       (t) => getCbsAliquota(t),
    ibsAliquotaRef:    (t) => getIbsAliquotaRef(t),
    presumidoBaseIRPJ: (t) => getPresumidoBases(t, "servicos").irpj,
    presumidoBaseCSLL: (t) => getPresumidoBases(t, "servicos").csll,
    fatorRMinimo:      (t) => getFatorRMinimoPct(t),
  };

  it("todos os campos declarados têm getter", () => {
    for (const campo of Object.keys(FAIXAS_TRIBUTARIAS) as CampoTributario[]) {
      expect(typeof GETTERS[campo]).toBe("function");
    }
  });

  it("todos os getters devolvem valor dentro da faixa hard para o default", () => {
    const t = cfg();
    for (const campo of Object.keys(FAIXAS_TRIBUTARIAS) as CampoTributario[]) {
      const f = FAIXAS_TRIBUTARIAS[campo];
      const v = GETTERS[campo](t);
      expect(v).toBeGreaterThanOrEqual(f.min);
      expect(v).toBeLessThanOrEqual(f.max);
    }
  });
});
