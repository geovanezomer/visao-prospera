// Termômetro de Kanitz — valores esperados calculados à mão a partir da
// fórmula original (Kanitz, 1974):
//   FI = 0,05·X1 + 1,65·X2 + 3,55·X3 − 1,06·X4 − 0,33·X5
// Os indicadores de entrada são montados sinteticamente para isolar a
// fórmula do restante da engine.

import { describe, it, expect } from "vitest";
import { calcKanitz, kanitzCalcMemo } from "../kanitz";
import type { Indicators } from "../indicators";
import { createState } from "./helpers";
import type { AppState, DebtContract } from "../types";

function ind(over: Partial<Indicators>): Indicators {
  return {
    roe: 0,
    liquidezGeral: 0,
    liquidezSeca: 0,
    liquidezCorrente: 0,
    ...over,
  } as Indicators;
}

function stateCap(capital: Partial<AppState["capital"]>): AppState {
  return createState({ capital } as never);
}

const divida = (saldo: number): DebtContract => ({
  id: "c1",
  credor: "Banco",
  saldoDevedor: saldo,
  taxaAA: 24,
  sistema: "price",
  prazoMeses: 24,
});

describe("calcKanitz — fórmula e faixas", () => {
  it("empresa solvente: FI calculado termo a termo", () => {
    // PL = 500k, Ativo = 800k → Passivo de terceiros = 300k → X5 = 0,6
    // X1 = 20% → 0,20 ; X2 = 1,5 ; X3 = 1,2 ; X4 = 1,8
    // c1 = 0,05·0,20 = 0,01
    // c2 = 1,65·1,5 = 2,475
    // c3 = 3,55·1,2 = 4,26
    // c4 = −1,06·1,8 = −1,908
    // c5 = −0,33·0,6 = −0,198
    // FI = 0,01 + 2,475 + 4,26 − 1,908 − 0,198 = 4,639
    const s = stateCap({ patrimonioLiquido: 500_000, ativoTotal: 800_000 });
    const k = calcKanitz(
      s,
      ind({ roe: 20, liquidezGeral: 1.5, liquidezSeca: 1.2, liquidezCorrente: 1.8 }),
    );
    expect(k.baseInsuficiente).toBe(false);
    expect(k.x1).toBeCloseTo(0.2, 10);
    expect(k.x5).toBeCloseTo(0.6, 10);
    expect(k.c1).toBeCloseTo(0.01, 10);
    expect(k.c2).toBeCloseTo(2.475, 10);
    expect(k.c3).toBeCloseTo(4.26, 10);
    expect(k.c4).toBeCloseTo(-1.908, 10);
    expect(k.c5).toBeCloseTo(-0.198, 10);
    expect(k.fi).toBeCloseTo(4.639, 10);
    expect(k.status).toBe("solvencia");
    expect(k.tone).toBe("pos");
    expect(k.label).toBe("Solvência");
  });

  it("FI exatamente 0 ainda é solvência (limite inclusivo)", () => {
    // Tudo zero, exceto X5 = 0 (ativo = PL e sem dívidas) → FI = 0
    const s = stateCap({ patrimonioLiquido: 100_000, ativoTotal: 100_000 });
    const k = calcKanitz(s, ind({}));
    expect(k.fi).toBe(0);
    expect(k.status).toBe("solvencia");
  });

  it("penumbra: −3 ≤ FI < 0", () => {
    // Liquidez corrente alta com seca baixa (estoque pesado) e alavancagem:
    // PL = 100k, Ativo = 300k → X5 = 2
    // X1 = 0 ; X2 = 0,5 ; X3 = 0,2 ; X4 = 2,0
    // FI = 1,65·0,5 + 3,55·0,2 − 1,06·2 − 0,33·2
    //    = 0,825 + 0,71 − 2,12 − 0,66 = −1,245
    const s = stateCap({ patrimonioLiquido: 100_000, ativoTotal: 300_000 });
    const k = calcKanitz(
      s,
      ind({ roe: 0, liquidezGeral: 0.5, liquidezSeca: 0.2, liquidezCorrente: 2 }),
    );
    expect(k.fi).toBeCloseTo(-1.245, 10);
    expect(k.status).toBe("penumbra");
    expect(k.tone).toBe("warn");
    expect(k.label).toBe("Penumbra");
  });

  it("FI = −3 exatamente fica na penumbra; abaixo disso é insolvência", () => {
    // Só X4 ativo: FI = −1,06·X4. X4 = 3/1,06 → FI = −3
    const s = stateCap({ patrimonioLiquido: 100_000, ativoTotal: 100_000 });
    const limite = calcKanitz(s, ind({ liquidezCorrente: 3 / 1.06 }));
    expect(limite.fi).toBeCloseTo(-3, 10);
    // Pode haver erro de ponto flutuante — confere pela faixa do próprio FI
    expect(limite.status).toBe(limite.fi >= -3 ? "penumbra" : "insolvencia");

    // X4 = 4 → FI = −4,24 → insolvência
    const k = calcKanitz(s, ind({ liquidezCorrente: 4 }));
    expect(k.fi).toBeCloseTo(-4.24, 10);
    expect(k.status).toBe("insolvencia");
    expect(k.tone).toBe("neg");
    expect(k.label).toBe("Insolvência");
  });

  it("ROE nulo é tratado como 0 no termo X1", () => {
    const s = stateCap({ patrimonioLiquido: 100_000, ativoTotal: 100_000 });
    const k = calcKanitz(s, ind({ roe: null, liquidezGeral: 1 }));
    expect(k.x1).toBe(0);
    expect(k.c1).toBe(0);
    expect(k.fi).toBeCloseTo(1.65, 10);
  });

  it("X5 sem ativo total informado usa Dívida Onerosa + Passivos Não Onerosos", () => {
    // Ativo total (0) ≤ PL → fallback: D (contratos 60k) + PNO 40k = 100k
    // X5 = 100k / 200k = 0,5 → c5 = −0,165
    const s = stateCap({
      patrimonioLiquido: 200_000,
      ativoTotal: 0,
      passivosNaoOnerosos: 40_000,
      debtContracts: [divida(60_000)],
    });
    const k = calcKanitz(s, ind({}));
    expect(k.x5).toBeCloseTo(0.5, 10);
    expect(k.c5).toBeCloseTo(-0.165, 10);
    expect(k.fi).toBeCloseTo(-0.165, 10);
  });

  it("X5 usa fornecedores quando passivosNaoOnerosos está ausente", () => {
    // PNO ausente → fornecedores 50k; sem dívida → X5 = 50k/100k = 0,5
    const base = stateCap({ patrimonioLiquido: 100_000, ativoTotal: 0, fornecedores: 50_000 });
    const s: AppState = {
      ...base,
      capital: { ...base.capital, passivosNaoOnerosos: undefined },
    };
    expect(calcKanitz(s, ind({})).x5).toBeCloseTo(0.5, 10);
  });

  it("PL ≤ 0 → base insuficiente (modelo perde sentido econômico)", () => {
    for (const pl of [0, -50_000]) {
      const k = calcKanitz(stateCap({ patrimonioLiquido: pl, ativoTotal: 100_000 }), ind({}));
      expect(k.baseInsuficiente).toBe(true);
      expect(Number.isNaN(k.fi)).toBe(true);
      expect(k.status).toBe("indisponivel");
      expect(k.tone).toBe("muted");
      expect([k.x1, k.x2, k.x3, k.x4, k.x5, k.c1, k.c2, k.c3, k.c4, k.c5]).toEqual(
        Array(10).fill(0),
      );
    }
  });
});

describe("kanitzCalcMemo — memória de cálculo pt-BR", () => {
  it("lista os 5 termos com vírgula decimal e o FI final", () => {
    const s = stateCap({ patrimonioLiquido: 500_000, ativoTotal: 800_000 });
    const k = calcKanitz(
      s,
      ind({ roe: 20, liquidezGeral: 1.5, liquidezSeca: 1.2, liquidezCorrente: 1.8 }),
    );
    const memo = kanitzCalcMemo(k);
    const linhas = memo.split("\n");
    expect(linhas).toHaveLength(6);
    expect(linhas[0]).toContain("0,2");
    expect(linhas[1]).toContain("1,5");
    expect(linhas[2]).toContain("4,26");
    expect(linhas[3]).toContain("−1,06");
    expect(linhas[4]).toContain("0,6");
    // FI = 4,639 → arredondado a 2 casas = 4,64
    expect(linhas[5]).toBe("FI = 4,64");
  });

  it("base insuficiente orienta a informar PL", () => {
    const k = calcKanitz(stateCap({ patrimonioLiquido: 0 }), ind({}));
    expect(kanitzCalcMemo(k)).toMatch(/Patrimônio Líquido > 0/);
  });
});
