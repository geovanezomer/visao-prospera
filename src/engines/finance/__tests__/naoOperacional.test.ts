import { describe, expect, it } from "vitest";
import { createState, m12 } from "./helpers";
import { buildDRE } from "../dre";
import { buildCashFlow } from "../cashflow";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("resultado não operacional e depreciação mensal", () => {
  it("não operacional fica abaixo do EBIT (fora do EBITDA), entra no LAIR e no caixa", () => {
    const base = createState({
      tax: { regime: "presumido" },
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
    } as never);
    const com = {
      ...base,
      revenue: {
        ...base.revenue,
        receitasFinanceiras: [
          {
            id: "x",
            label: "Venda de veículo",
            valores: [0, 0, 30_000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            tipo: "nao_operacional" as const,
          },
        ],
      },
    };
    const a = buildDRE(base, "presumido").dre;
    const b = buildDRE(com, "presumido").dre;
    expect(sum(b.ebitda)).toBeCloseTo(sum(a.ebitda), 6);
    expect(sum(b.ebit)).toBeCloseTo(sum(a.ebit), 6);
    expect(sum(b.resultadoNaoOperacional)).toBe(30_000);
    expect(sum(b.lair) - sum(a.lair)).toBeCloseTo(30_000, 6);
    expect(buildCashFlow(com).saldoFinal[11] - buildCashFlow(base).saldoFinal[11]).toBeGreaterThan(
      20_000,
    );
  });

  it("série mensal de depreciação substitui o valor fixo", () => {
    const serie = [0, 0, 0, 1_000, 1_000, 1_000, 2_000, 2_000, 2_000, 3_000, 3_000, 3_000];
    const s = createState({
      capital: { depreciacaoMensal: 500, depreciacaoMensalSerie: serie },
    } as never);
    const d = buildDRE(s, "presumido").dre.depreciacao;
    expect(d).toEqual(serie);
  });
});
