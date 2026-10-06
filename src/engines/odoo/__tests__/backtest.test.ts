// Retroteste: projeção feita com o 1º ano contra o realizado do 2º ano.
import { describe, expect, it } from "vitest";
import { createState } from "@/engines/finance/__tests__/helpers";
import { DEFAULT_FORECAST_CFG } from "@/engines/finance/forecast";
import { backtest } from "../backtest";
import { classifyAccount } from "../mapping";
import { listEntities } from "../toAppState";
import type { OdooAccountSnapshot, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 24 }, (_, i) =>
  new Date(Date.UTC(2024, 9 + i, 1)).toISOString().slice(0, 7),
); // 2024-10 … 2026-09

const acc = (code: string, name: string, type: string, monthly: number[], opening = 0) =>
  ({
    id: 1,
    code,
    name,
    type,
    cls: classifyAccount({ code, name, type }),
    monthly,
    opening,
  }) as OdooAccountSnapshot;

/** Receita mensal R0·(1+g)^i, custo 40% pago à vista. */
function snapshot(g: number, meses = MONTHS): OdooSnapshot {
  const rec = meses.map((_, i) => 100_000 * Math.pow(1 + g, i));
  return {
    version: 1,
    syncedAt: "2026-10-05T00:00:00Z",
    serverVersion: "20.0",
    months: meses,
    companies: [
      {
        id: 1,
        name: "Alfa",
        vat: "11222333000181",
        parentId: null,
        partnerId: 11,
        currency: "BRL",
        lockDate: null,
      },
    ],
    perCompany: {
      "1": {
        accounts: [
          acc(
            "1.01.01.01.01.01",
            "Caixa",
            "asset_cash",
            rec.map((r) => r * 0.6),
            50_000,
          ),
          acc(
            "3.01.01.01.01.04",
            "Receita de vendas",
            "income",
            rec.map((r) => -r),
          ),
          acc(
            "3.01.01.03.01.02",
            "(-) Cost of Goods",
            "expense_direct_cost",
            rec.map((r) => r * 0.4),
          ),
          acc(
            "2.03.01.01.01.01",
            "Capital social",
            "equity",
            rec.map(() => 0),
            -50_000,
          ),
        ],
        intercompany: { lines: [] },
      },
    },
  };
}

const run = (g: number, cresc: number, meses = MONTHS) => {
  const s = snapshot(g, meses);
  const e = listEntities(s)[0];
  return backtest(s, e, createState(), { ...DEFAULT_FORECAST_CFG, crescimentoMensalPct: cresc });
};

describe("backtest", () => {
  it("receita estável e premissa de 0%: previsão = realizado = ingênuo", () => {
    const r = run(0, 0);
    if (!r.disponivel) throw new Error(r.motivo);
    expect(r.base).toEqual({ inicio: "2024-10", fim: "2025-09" });
    expect(r.teste).toEqual({ inicio: "2025-10", fim: "2026-09" });
    expect(r.mapeReceita).toBeCloseTo(0, 6);
    expect(r.mapeIngenuo).toBeCloseTo(0, 6);
    const receita = r.metricas.find((m) => m.metrica === "Receita bruta")!;
    expect(receita.realizado).toBeCloseTo(1_200_000, 2);
    expect(receita.erroPct).toBeCloseTo(0, 6);
  });

  it("receita crescendo 1% a.m.: erros mês a mês calculados à mão", () => {
    const r = run(0.01, 1);
    if (!r.disponivel) throw new Error(r.motivo);
    // Realizado no mês j do 2º ano: R0·1,01^(12+j). Ingênuo (mesmo mês do ano
    // anterior): R0·1,01^j → erro 1 − 1,01^−12 em todos os meses.
    expect(r.mapeIngenuo).toBeCloseTo((1 - Math.pow(1.01, -12)) * 100, 1);
    // Modo Odoo: o mês j projeta o mesmo mês do ano-base com 12 meses de
    // crescimento — R0·1,01^j·1,01^12 = realizado → erro zero.
    expect(r.mapeReceita).toBeCloseTo(0, 6);
    expect(r.meses[0].previsto).toBeCloseTo(100_000 * Math.pow(1.01, 12), 0);
  });

  it("receita crescendo 2% a.m. com premissa de 1%: erro constante calculado à mão", () => {
    const r = run(0.02, 1);
    if (!r.disponivel) throw new Error(r.motivo);
    // Previsto R0·1,02^j·1,01^12; realizado R0·1,02^(12+j) → erro 1 − (1,01/1,02)^12.
    const esperado = (1 - Math.pow(1.01 / 1.02, 12)) * 100;
    expect(r.mapeReceita).toBeCloseTo(esperado, 1);
    expect(r.mapeIngenuo).toBeCloseTo((1 - Math.pow(1.02, -12)) * 100, 1);
    expect(r.mapeReceita).toBeLessThan(r.mapeIngenuo);
  });

  it("menos de 24 meses: indisponível com o motivo", () => {
    const r = run(0, 0, MONTHS.slice(6));
    expect(r.disponivel).toBe(false);
    if (!r.disponivel) expect(r.motivo).toMatch(/24 meses/);
  });
});
