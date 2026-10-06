// Projeção no modo Odoo: mês projetado = mesmo mês do ano realizado + N anos;
// crescimento sugerido pelo histórico de 24 meses. Valores calculados à mão.
import { describe, expect, it } from "vitest";
import { createState } from "@/engines/finance/__tests__/helpers";
import { buildForecast, DEFAULT_FORECAST_CFG } from "@/engines/finance/forecast";
import { crescimentoObservado } from "../growth";
import { classifyAccount } from "../mapping";
import {
  anchorOdooState,
  applyOdooOverlay,
  buildEntityData,
  listEntities,
  prepareOdooOverlay,
  suggestPremissas,
} from "../toAppState";
import type { OdooAccountSnapshot, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 24 }, (_, i) =>
  new Date(Date.UTC(2024, 9 + i, 1)).toISOString().slice(0, 7),
); // 2024-10 … 2026-09

/** Sazonalidade por posição na janela (out…set). */
const S = [1.0, 1.1, 1.5, 0.7, 0.8, 0.9, 0.9, 1.0, 1.0, 1.1, 1.0, 1.0];

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

/** Receita 100k·S[k]·(1+g)^k, custo 40% e aluguel fixo de 10k. */
function snapshot(g: number, meses = MONTHS, receitaZeroAte = -1): OdooSnapshot {
  const rec = meses.map((_, k) => (k <= receitaZeroAte ? 0 : 100_000 * S[k % 12] * (1 + g) ** k));
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
            rec.map((r) => r * 0.6 - 10_000),
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
            "3.01.01.07.01.98",
            "(-) Aluguéis de imóveis",
            "expense",
            rec.map(() => 10_000),
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

function estadoOdoo(g: number) {
  const s = snapshot(g);
  const data = buildEntityData(s, listEntities(s)[0]);
  return anchorOdooState(
    applyOdooOverlay(suggestPremissas(createState(), data), prepareOdooOverlay(data)),
  );
}

const cfg = (patch: Partial<typeof DEFAULT_FORECAST_CFG> = {}) => ({
  ...DEFAULT_FORECAST_CFG,
  inflacaoFixosAA: 0,
  stepReceitaPct: 1000,
  ...patch,
});

describe("projeção no modo Odoo", () => {
  it("cada mês parte do mesmo mês do ano realizado com N anos de crescimento", () => {
    const st = estadoOdoo(0.01);
    expect(st.realizado?.meses[0]).toBe("2025-10");
    const f = buildForecast(st, cfg({ crescimentoMensalPct: 1, horizonteMeses: 24 })).meses;
    // Mês-base k (k = 12…23 do retrato) vale 100k·S·1,01^k; Y1 soma 12 meses
    // de crescimento, Y2 soma 24: 100k·S[j]·1,01^(12+j)·1,01^12(ano).
    for (const i of [0, 2, 3, 11, 12, 23]) {
      const j = i % 12;
      const anos = Math.floor(i / 12) + 1;
      expect(f[i].receita).toBeCloseTo(100_000 * S[j] * 1.01 ** (12 + j) * 1.01 ** (12 * anos), 1);
    }
    // Sazonalidade preservada: dezembro (pico 1,5) acima de janeiro (0,7).
    expect(f[2].receita).toBeGreaterThan(f[3].receita * 2);
    // Rótulos e ano-calendário reais.
    expect(f[0]).toMatchObject({ label: "Out/2026", mes: 10, anoCalendario: 2026 });
    expect(f[3]).toMatchObject({ label: "Jan/2027", mes: 1, anoCalendario: 2027 });
    expect(f[12]).toMatchObject({ label: "Out/2027", anoCalendario: 2027 });
  });

  it("série com 1% a.m. e premissa de 1%: o 1º ano projetado repete a tendência", () => {
    const st = estadoOdoo(0.01);
    const f = buildForecast(st, cfg({ crescimentoMensalPct: 1, horizonteMeses: 12 })).meses;
    // (o razão guarda centavos) A série continuaria em 100k·S[j]·1,01^(24+j): é exatamente o projetado.
    f.forEach((m, j) => expect(m.receita).toBeCloseTo(100_000 * S[j] * 1.01 ** (24 + j), 1));
  });

  it("inflação dos fixos em degraus anuais: +5% no Y1, +10,25% no Y2", () => {
    const st = estadoOdoo(0);
    const sem = buildForecast(st, cfg({ crescimentoMensalPct: 0, horizonteMeses: 24 })).meses;
    const com = buildForecast(
      st,
      cfg({ crescimentoMensalPct: 0, horizonteMeses: 24, inflacaoFixosAA: 5 }),
    ).meses;
    // Aluguel de 10k/mês: −500 no EBITDA do Y1 e −1.025 no Y2 (10k·(1,05²−1)).
    for (const i of [0, 6, 11]) expect(com[i].ebitda - sem[i].ebitda).toBeCloseTo(-500, 4);
    for (const i of [12, 18, 23]) expect(com[i].ebitda - sem[i].ebitda).toBeCloseTo(-1025, 4);
  });
});

describe("crescimento observado", () => {
  const entity = (s: OdooSnapshot) => listEntities(s)[0];

  it("1% a.m. com sazonalidade: 12m sobre 12m anteriores = 1,01^12 → 1,00% a.m.", () => {
    const s = snapshot(0.01);
    const r = crescimentoObservado(s, entity(s));
    if (!r.disponivel) throw new Error(r.motivo);
    expect(r.pctMensal).toBe(1);
    expect(r.variacaoAnualPct).toBeCloseTo((1.01 ** 12 - 1) * 100, 2); // 12,68%
    expect(r.janela).toEqual({ inicio: "2024-10", fim: "2026-09" });
    expect(r.receita12mAnterior).toBeCloseTo(
      S.reduce((a, x, k) => a + 100_000 * x * 1.01 ** k, 0),
      0,
    );
  });

  it("queda de 2% a.m.: sugestão negativa de −2,00% a.m.", () => {
    const s = snapshot(-0.02);
    const r = crescimentoObservado(s, entity(s));
    if (!r.disponivel) throw new Error(r.motivo);
    expect(r.pctMensal).toBe(-2);
  });

  it("até o mês final escolhido: usa os 24 meses que terminam nele", () => {
    const meses = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2024, 3 + i, 1)).toISOString().slice(0, 7),
    );
    const s = snapshot(0.005, meses);
    const r = crescimentoObservado(s, entity(s), "2026-03");
    if (!r.disponivel) throw new Error(r.motivo);
    expect(r.janela).toEqual({ inicio: "2024-04", fim: "2026-03" });
    expect(r.pctMensal).toBe(0.5);
  });

  it("menos de 24 meses ou sem receita no ano anterior: indisponível", () => {
    const curto = snapshot(0.01, MONTHS.slice(3));
    const r1 = crescimentoObservado(curto, entity(curto));
    expect(r1).toEqual({
      disponivel: false,
      motivo: "São necessários 24 meses de histórico no Odoo.",
    });
    const semBase = snapshot(0.01, MONTHS, 11);
    const r2 = crescimentoObservado(semBase, entity(semBase));
    expect(r2.disponivel).toBe(false);
    if (!r2.disponivel) expect(r2.motivo).toMatch(/Sem receita/);
  });
});
