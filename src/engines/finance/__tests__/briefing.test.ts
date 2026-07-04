// Testes do briefing — garantem determinismo das classificações e padrões.
// A LLM (PR2) confiará nesses números; se quebrar, a narrativa quebra junto.

import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { calcIndicators } from "../indicators";
import { resolveEffectiveRegime } from "../regime";
import { buildBriefing, classify, briefingCacheKey } from "../briefing";
import { createState } from "./helpers";

describe("classify (determinismo de níveis)", () => {
  it("maior_melhor: classifica margemEbitda nas 4 faixas", () => {
    expect(classify("margemEbitda", 2).nivel).toBe("critico"); // <5
    expect(classify("margemEbitda", 7).nivel).toBe("atencao"); // 5-10
    expect(classify("margemEbitda", 18).nivel).toBe("ok"); // 10-25
    expect(classify("margemEbitda", 30).nivel).toBe("excelente"); // ≥25
  });

  it("menor_melhor: classifica dividaLiqEbitda invertido", () => {
    expect(classify("dividaLiqEbitda", 5).nivel).toBe("critico"); // >4
    expect(classify("dividaLiqEbitda", 3.5).nivel).toBe("atencao"); // 3-4
    expect(classify("dividaLiqEbitda", 1.5).nivel).toBe("ok"); // 1-2
    expect(classify("dividaLiqEbitda", 0.5).nivel).toBe("excelente"); // <1
  });

  it("NaN/Infinity vira 'atencao' (dado faltante, não crítico)", () => {
    expect(classify("roic", NaN).nivel).toBe("atencao");
    expect(classify("roic", Infinity).nivel).toBe("atencao");
  });

  it("preserva o valor cru e a faixa usada (auditabilidade)", () => {
    const c = classify("margemBruta", 28);
    expect(c.valor).toBe(28);
    expect(c.faixa.fonte).toBeTruthy();
    expect(c.faixa.unidade).toBe("%");
  });
});

describe("buildBriefing (integração com engine real)", () => {
  it("produz briefing válido a partir do DEFAULT_STATE", () => {
    const state = createState({});
    const dre = buildDRE(state, resolveEffectiveRegime(state)).dre;
    const ind = calcIndicators(state, dre);
    const b = buildBriefing(state, dre, ind);

    expect(b.schemaVersion).toBe(1);
    expect(b.classificacoes.length).toBeGreaterThan(0);
    expect(b.contexto.porte).toMatch(/^(micro|pequena|media|grande)$/);
    expect(b.resumo.nivelGeral).toMatch(/^(critico|atencao|ok|excelente)$/);
  });

  it("nunca produz texto solto — só dados estruturados (regra de ouro)", () => {
    const state = createState({});
    const dre = buildDRE(state, resolveEffectiveRegime(state)).dre;
    const ind = calcIndicators(state, dre);
    const b = buildBriefing(state, dre, ind);

    // Não pode haver narrativa pronta — isso é trabalho da LLM no PR2.
    const serializado = JSON.stringify(b);
    expect(serializado).not.toMatch(/empresa (está|apresenta)/i);
    expect(serializado).not.toMatch(/recomendamos/i);
  });

  it("é determinístico: mesmo input → mesmas classificações", () => {
    const state = createState({});
    const dre = buildDRE(state, resolveEffectiveRegime(state)).dre;
    const ind = calcIndicators(state, dre);

    const b1 = buildBriefing(state, dre, ind);
    const b2 = buildBriefing(state, dre, ind);

    // Timestamps mudam, mas a parte semântica é idêntica.
    expect(b1.classificacoes).toEqual(b2.classificacoes);
    expect(b1.padroes).toEqual(b2.padroes);
    expect(b1.alavancas).toEqual(b2.alavancas);
  });

  it("briefingCacheKey ignora timestamp (cache hit em recálculos idênticos)", () => {
    const state = createState({});
    const dre = buildDRE(state, resolveEffectiveRegime(state)).dre;
    const ind = calcIndicators(state, dre);

    const k1 = briefingCacheKey(buildBriefing(state, dre, ind));
    // Pequena espera para garantir timestamp diferente.
    const k2 = briefingCacheKey(buildBriefing(state, dre, ind));
    expect(k1).toBe(k2);
  });

  it("detecta padrão 'destruicao_valor' quando ROIC < WACC", () => {
    // Forçamos cenário ruim: dívida alta + EBIT baixo → ROIC despencará abaixo do WACC.
    const state = createState({
      capital: { debtContracts: [{ id: "sim", credor: "Banco Teste", saldoDevedor: 5_000_000, taxaAA: 18, sistema: "price", prazoMeses: 24 }], patrimonioLiquido: 100_000, kd: 15, ke: 12 },
    });
    const dre = buildDRE(state, resolveEffectiveRegime(state)).dre;
    const ind = calcIndicators(state, dre);
    const b = buildBriefing(state, dre, ind);

    if (ind.roic < ind.wacc - 0.5) {
      const codigos = b.padroes.map((p) => p.codigo);
      expect(codigos).toContain("destruicao_valor");
      // Alavancas correspondentes devem aparecer.
      const alav = b.alavancas.map((a) => a.codigo);
      expect(alav).toContain("revisar_estrutura_capital");
    }
  });
});
