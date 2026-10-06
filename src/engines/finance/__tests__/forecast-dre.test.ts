// Projeção sem crescimento, inflação nem saltos de folha reproduz a DRE do
// ano-base: mesmo EBITDA (deduções, PDD, IR/CSLL abaixo do EBITDA) e, fora do
// Lucro Real, o mesmo lucro líquido.
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { buildForecast, DEFAULT_FORECAST_CFG } from "../forecast";
import { buildDRE } from "../dre";
import { resolveEffectiveRegime } from "../regime";
import { sum } from "../format";
import type { AppState, TaxRegime } from "../types";

const neutro = {
  ...DEFAULT_FORECAST_CFG,
  crescimentoMensalPct: 0,
  inflacaoFixosAA: 0,
  ganhoEscalaCpvAA: 0,
  stepReceitaPct: 1000,
  horizonteMeses: 12,
};

const comRegime = (regime: TaxRegime, patch: Partial<AppState["revenue"]> = {}) => {
  const s = createState({ tax: { regime } as never });
  return { ...s, revenue: { ...s.revenue, ...patch } };
};

function compara(s: AppState) {
  const { dre } = buildDRE(s, resolveEffectiveRegime(s));
  const f = buildForecast(s, neutro).meses;
  return {
    ebitdaDre: sum(dre.ebitda),
    ebitdaProj: sum(f.map((m) => m.ebitda)),
    llDre: sum(dre.lucroLiquido),
    llProj: sum(f.map((m) => m.lucroLiquido)),
    receitaDre: sum(dre.receitaBruta),
    receitaProj: sum(f.map((m) => m.receita)),
  };
}

describe("projeção neutra = DRE do ano-base", () => {
  it.each(["simples", "presumido", "real"] as const)("EBITDA igual no %s", (regime) => {
    const r = compara(comRegime(regime));
    expect(r.receitaProj).toBeCloseTo(r.receitaDre, 4);
    expect(r.ebitdaProj).toBeCloseTo(r.ebitdaDre, 2);
  });

  it.each(["simples", "presumido"] as const)("lucro líquido igual no %s", (regime) => {
    const r = compara(comRegime(regime));
    expect(r.llProj).toBeCloseTo(r.llDre, 2);
  });

  it("inadimplência como PDD (despesa) também fecha o EBITDA", () => {
    const r = compara(comRegime("presumido", { inadimplenciaComoPDD: true }));
    expect(r.ebitdaProj).toBeCloseTo(r.ebitdaDre, 2);
  });

  it("despesa comercial acompanha a receita; administrativa não", () => {
    const base = comRegime("simples");
    const s: AppState = {
      ...base,
      costs: [
        {
          id: "com",
          label: "Comissões",
          category: "despesa_comercial",
          values: Array(12).fill(10_000),
          fixed: true,
        },
        {
          id: "adm",
          label: "Aluguel",
          category: "despesa_administrativa",
          values: Array(12).fill(5_000),
          fixed: true,
        },
      ] as AppState["costs"],
    };
    const cfg = { ...neutro, crescimentoMensalPct: 3, horizonteMeses: 24 };
    const f = buildForecast(s, cfg).meses;
    const semCustos = buildForecast({ ...s, costs: [] }, cfg).meses;
    // Mês 24: comissão = 120k/receita anual × receita do mês (proporcional);
    // aluguel fixo em 5k.
    const receitaAnual = sum(buildDRE(s, resolveEffectiveRegime(s)).dre.receitaBruta);
    const custo = semCustos[23].ebitda - f[23].ebitda;
    expect(custo).toBeCloseTo((120_000 / receitaAnual) * f[23].receita + 5_000, 4);
    expect(f[23].receita / f[11].receita).toBeCloseTo(1.03 ** 12, 9);
  });
});
