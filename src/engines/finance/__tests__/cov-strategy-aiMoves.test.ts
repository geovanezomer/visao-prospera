// Catálogo whitelisted de movimentos da IA propositiva — garante que a IA só
// consegue gerar parâmetros dentro das faixas seguras e com o sinal correto.

import { describe, it, expect } from "vitest";
import {
  AI_MOVE_CATALOG,
  compileAiMove,
  describeMoveCatalogForPrompt,
  getAiMove,
} from "../levers/aiMoves";

describe("AI_MOVE_CATALOG", () => {
  it("ids únicos e faixas válidas (min < max)", () => {
    const ids = AI_MOVE_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of AI_MOVE_CATALOG) expect(m.range[0]).toBeLessThan(m.range[1]);
  });

  it("getAiMove encontra por id e devolve undefined para desconhecido", () => {
    expect(getAiMove("repasse_preco")?.unit).toBe("pct");
    expect(getAiMove("inexistente")).toBeUndefined();
  });

  it("cada movimento compila para os parâmetros esperados do simulador", () => {
    const esperado: Record<string, [number, Record<string, number>]> = {
      corte_custos_fixos: [10, { fixedCutPct: 10, fixedCutTopN: 3 }],
      repasse_preco: [-5, { priceDeltaPct: -5 }],
      ajuste_volume: [12, { volumeDeltaPct: 12 }],
      reduzir_cpv: [-8, { cpvDeltaPct: -8 }],
      ajuste_folha: [-10, { payrollDeltaPct: -10 }],
      // PMR: reduzir = delta NEGATIVO de dias
      reduzir_pmr: [15, { pmrDeltaDays: -15 }],
      // PMP: aumentar = delta POSITIVO de dias
      aumentar_pmp: [20, { pmpDeltaDays: 20 }],
      captar_emprestimo_giro: [
        150_000,
        { loanPrincipal: 150_000, loanRatePctAm: 2, loanTermMonths: 12 },
      ],
      quitar_divida: [40, { debtPaydownPct: 40 }],
    };
    expect(Object.keys(esperado).sort()).toEqual(AI_MOVE_CATALOG.map((m) => m.id).sort());
    for (const [id, [mag, params]] of Object.entries(esperado)) {
      const r = compileAiMove(id, mag)!;
      expect(r.magnitude).toBe(mag);
      expect(r.params).toEqual(params);
      expect(r.move.id).toBe(id);
    }
  });
});

describe("compileAiMove — validação e clipping", () => {
  it("magnitude acima do teto é clipada (preço +9999% → +15%)", () => {
    const r = compileAiMove("repasse_preco", 9999)!;
    expect(r.magnitude).toBe(15);
    expect(r.params).toEqual({ priceDeltaPct: 15 });
  });

  it("magnitude abaixo do piso é clipada (corte de fixos 1% → 5%)", () => {
    expect(compileAiMove("corte_custos_fixos", 1)!.params).toEqual({
      fixedCutPct: 5,
      fixedCutTopN: 3,
    });
  });

  it("magnitude negativa em PMR é clipada no piso e mantém sinal de redução", () => {
    // −30 dias → clip em 5 → pmrDeltaDays = −5
    expect(compileAiMove("reduzir_pmr", -30)!.params).toEqual({ pmrDeltaDays: -5 });
  });

  it("empréstimo acima de R$ 2 mi é limitado a R$ 2 mi", () => {
    expect(compileAiMove("captar_emprestimo_giro", 10_000_000)!.params.loanPrincipal).toBe(
      2_000_000,
    );
  });

  it("aceita magnitude numérica em string", () => {
    expect(compileAiMove("quitar_divida", "25")!.magnitude).toBe(25);
  });

  it("rejeita id desconhecido e magnitudes não numéricas/infinitas", () => {
    expect(compileAiMove("vender_empresa", 10)).toBeNull();
    expect(compileAiMove("repasse_preco", "abc")).toBeNull();
    expect(compileAiMove("repasse_preco", NaN)).toBeNull();
    expect(compileAiMove("repasse_preco", Infinity)).toBeNull();
    expect(compileAiMove("repasse_preco", undefined)).toBeNull();
  });
});

describe("describeMoveCatalogForPrompt", () => {
  it("uma linha por movimento, com unidade e faixa", () => {
    const txt = describeMoveCatalogForPrompt();
    const linhas = txt.split("\n");
    expect(linhas).toHaveLength(AI_MOVE_CATALOG.length);
    expect(linhas[0]).toMatch(/^- "corte_custos_fixos" — .* Unidade: pct\. Faixa: 5\.\.30\.$/);
    expect(txt).toContain('"captar_emprestimo_giro"');
    expect(txt).toContain("Faixa: 10000..2000000.");
  });
});
