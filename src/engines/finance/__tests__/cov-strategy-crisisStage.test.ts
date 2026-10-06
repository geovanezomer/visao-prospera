// Termômetro de Crise — estágios 0..4 (Lei 11.101/2005 + Lei 14.112/2020).
// Indicadores sintéticos isolam a regra de decisão de cada estágio.

import { describe, it, expect } from "vitest";
import { assessCrisisStage } from "../crisisStage";
import type { Indicators } from "../indicators";
import { createState } from "./helpers";
import type { AppState } from "../types";

// Empresa "saudável" de referência: todos os gatilhos fora de faixa.
const SAUDAVEL: Partial<Indicators> = {
  ebitdaAnual: 200_000,
  fcoAnual: 150_000,
  liquidezCorrente: 1.8,
  dividaLiqEbitda: 1.5,
  margemLiquida: 12,
  margemEbitda: 20,
};

const ind = (over: Partial<Indicators> = {}) => ({ ...SAUDAVEL, ...over }) as Indicators;
const st = (pl: number): AppState => createState({ capital: { patrimonioLiquido: pl } } as never);

describe("assessCrisisStage — estágios", () => {
  it("estágio 0 (Saudável) quando nenhum gatilho dispara", () => {
    const r = assessCrisisStage(st(500_000), ind());
    expect(r.stage).toBe(0);
    expect(r.label).toBe("Saudável");
    expect(r.tone).toBe("pos");
    expect(r.triggers).toHaveLength(1);
  });

  it("estágio 1 (Declínio): margem líquida ≤ 0 e/ou margem EBITDA ≤ 5%", () => {
    const soLiq = assessCrisisStage(st(500_000), ind({ margemLiquida: 0 }));
    expect(soLiq.stage).toBe(1);
    expect(soLiq.tone).toBe("warn");
    expect(soLiq.triggers).toEqual(["Margem Líquida 0.0% ≤ 0"]);

    // 5% é o limite inclusivo da margem EBITDA
    const ambos = assessCrisisStage(st(500_000), ind({ margemLiquida: -2, margemEbitda: 5 }));
    expect(ambos.stage).toBe(1);
    expect(ambos.triggers).toHaveLength(2);
    expect(ambos.triggers[1]).toBe("Margem EBITDA 5.0% ≤ 5%");
  });

  it("estágio 2 (Iliquidez): FCO < 0 ou 0 < Liquidez Corrente < 1", () => {
    const fco = assessCrisisStage(st(500_000), ind({ fcoAnual: -10_000 }));
    expect(fco.stage).toBe(2);
    expect(fco.label).toBe("Iliquidez");
    expect(fco.triggers).toHaveLength(1);
    expect(fco.triggers[0]).toMatch(/^FCO anual .*10\.000 < 0$/);

    const lc = assessCrisisStage(st(500_000), ind({ liquidezCorrente: 0.85 }));
    expect(lc.stage).toBe(2);
    expect(lc.triggers).toEqual(["Liquidez Corrente 0.85× < 1,00×"]);

    // Iliquidez prevalece sobre declínio (avaliação em cascata)
    const ambos = assessCrisisStage(
      st(500_000),
      ind({ fcoAnual: -1, liquidezCorrente: 0.5, margemLiquida: -5 }),
    );
    expect(ambos.stage).toBe(2);
    expect(ambos.triggers).toHaveLength(2);
  });

  it("liquidez corrente 0 (não informada) não dispara iliquidez; exatamente 1,00 também não", () => {
    expect(assessCrisisStage(st(500_000), ind({ liquidezCorrente: 0 })).stage).toBe(0);
    expect(assessCrisisStage(st(500_000), ind({ liquidezCorrente: 1 })).stage).toBe(0);
  });

  it("estágio 3 (Insolvência Técnica) por Dívida Líquida/EBITDA > 7×", () => {
    const r = assessCrisisStage(st(500_000), ind({ dividaLiqEbitda: 7.5 }));
    expect(r.stage).toBe(3);
    expect(r.legalBasis).toMatch(/art\. 161/);
    expect(r.triggers).toEqual(["Dívida Líquida/EBITDA = 7.5× (> 7×)"]);
    // 7× exato ainda não dispara
    expect(assessCrisisStage(st(500_000), ind({ dividaLiqEbitda: 7 })).stage).toBe(0);
  });

  it("alavancagem > 7× com EBITDA ≤ 0 não usa o múltiplo (sem sentido econômico)", () => {
    // EBITDA negativo com PL positivo: múltiplo ignorado, cai em declínio/iliquidez
    const r = assessCrisisStage(
      st(500_000),
      ind({ ebitdaAnual: -10_000, dividaLiqEbitda: 50, margemEbitda: -3 }),
    );
    expect(r.stage).toBe(1);
  });

  it("estágio 3 por PL negativo com EBITDA positivo", () => {
    const r = assessCrisisStage(st(-80_000), ind());
    expect(r.stage).toBe(3);
    expect(r.label).toBe("Insolvência Técnica");
    expect(r.tone).toBe("neg");
    expect(r.triggers).toHaveLength(1);
    expect(r.triggers[0]).toMatch(/^Patrimônio Líquido negativo \(-R\$\s?80\.000\)$/);
  });

  it("estágio 4 (Insolvência Jurídica): PL negativo + EBITDA ≤ 0", () => {
    const r = assessCrisisStage(st(-80_000), ind({ ebitdaAnual: 0 }));
    expect(r.stage).toBe(4);
    expect(r.tone).toBe("crit");
    expect(r.recommendation).toMatch(/Recuperação Judicial/);
    expect(r.legalBasis).toMatch(/art\. 47/);
    expect(r.triggers).toHaveLength(2);
    expect(r.triggers[1]).toMatch(/^EBITDA R\$\s?0 ≤ 0$/);
  });

  it("PL não informado (0 ou sem capital) não é insolvência", () => {
    const base = createState();
    const s = { ...base, capital: undefined } as unknown as AppState;
    expect(assessCrisisStage(s, ind({ ebitdaAnual: -1 })).stage).toBeLessThan(3);
    expect(assessCrisisStage(st(0), ind({ ebitdaAnual: -1 })).stage).toBeLessThan(3);
    expect(assessCrisisStage(st(-1), ind({ ebitdaAnual: -1 })).stage).toBe(4);
  });

  it("cada estágio retorna cópia nova dos gatilhos (função pura)", () => {
    const a = assessCrisisStage(st(500_000), ind());
    const b = assessCrisisStage(st(500_000), ind());
    expect(a.triggers).not.toBe(b.triggers);
    expect(a).toEqual(b);
  });
});
