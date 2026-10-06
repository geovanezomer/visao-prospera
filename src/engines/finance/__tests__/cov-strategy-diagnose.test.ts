// Diagnóstico — alertas OK / Warn / Danger gerados a partir de DRE e
// indicadores. DRE e indicadores são sintéticos para isolar cada regra;
// os limites (30% de conversão, folha 25/35%, fixos 50%, etc.) são os
// documentados no próprio módulo.

import { describe, it, expect } from "vitest";
import { diagnose, type Diagnostic } from "../diagnose";
import type { DRE } from "../dre";
import type { Indicators } from "../indicators";
import { createState, m12 } from "./helpers";
import type { AppState, CostLine } from "../types";

// Empresa saudável de referência (valores anuais):
//   Receita Líquida 1,2M · Folha 200k (16,7%) · LL 120k · EBITDA 240k
//   FCF 100k (conversão 83%) · Custos fixos 360k (30%)
function dre(over: Partial<DRE> = {}): DRE {
  return {
    receitaLiquida: m12(100_000),
    folhaCltAnual: 200_000,
    lucroLiquido: m12(10_000),
    ebitda: m12(20_000),
    custosFixos: m12(30_000),
    impostosTotal: m12(0),
    ...over,
  } as DRE;
}

function ind(over: Partial<Indicators> = {}): Indicators {
  return {
    fcf: 100_000,
    margemBruta: 50,
    margemEbitda: 20,
    margemLiquida: 10,
    coberturaJuros: 5,
    dividaLiqEbitda: 1,
    gapCapitalGiro: 0,
    ncg: 10_000,
    roic: 20,
    wacc: 12,
    liquidezCorrente: 1.5,
    ...over,
  } as Indicators;
}

// Estado sem rubricas de folha nem ativos → balanço de abertura zerado (fecha).
function state(over: Partial<AppState> = {}): AppState {
  const base = createState({
    revenue: { bruta: m12(110_000), inadimplencia: m12(0) },
  } as never);
  return { ...base, costs: [], ...over };
}

const titles = (d: Diagnostic[]) => d.map((x) => x.title);
const find = (d: Diagnostic[], t: string) => d.find((x) => x.title === t);

describe("diagnose — empresa saudável", () => {
  it("só emite 'cria valor econômico' (ROIC 20% ≥ WACC 12%)", () => {
    const out = diagnose(state(), dre(), ind());
    expect(out).toEqual([
      {
        level: "ok",
        title: "Empresa cria valor econômico",
        message: "ROIC 20.0% ≥ WACC 12.0%.",
      },
    ]);
  });
});

describe("diagnose — conversão de lucro em caixa", () => {
  it("conversão 25% (FCF 30k / LL 120k) → warn", () => {
    const d = find(
      diagnose(state(), dre(), ind({ fcf: 30_000 })),
      "Baixa conversão de lucro em caixa",
    );
    expect(d?.level).toBe("warn");
    expect(d?.message).toMatch(/^Apenas 25\.0% do lucro/);
  });

  it("conversão exatamente 30% não alerta", () => {
    const out = diagnose(state(), dre(), ind({ fcf: 36_000 }));
    expect(find(out, "Baixa conversão de lucro em caixa")).toBeUndefined();
  });

  it("FCF negativo com lucro → danger + divergência EBITDA × caixa", () => {
    const out = diagnose(state(), dre(), ind({ fcf: -5_000 }));
    expect(find(out, "Lucro que não vira caixa")?.level).toBe("danger");
    expect(find(out, "Divergência: EBITDA (+) vs Caixa (−)")?.level).toBe("danger");
  });

  it("lucro ≤ R$ 1.000 não avalia conversão (evita divisão por base irrelevante)", () => {
    const out = diagnose(state(), dre({ lucroLiquido: m12(80) }), ind({ fcf: 0 }));
    expect(titles(out)).not.toContain("Baixa conversão de lucro em caixa");
    expect(titles(out)).not.toContain("Lucro que não vira caixa");
  });
});

describe("diagnose — inadimplência e linhas negativas", () => {
  it("inadimplência média ≥ 95% → danger", () => {
    const out = diagnose(
      state({ revenue: { ...state().revenue, inadimplencia: m12(96) } }),
      dre(),
      ind(),
    );
    const d = find(out, "Inadimplência crítica (~100%)");
    expect(d?.level).toBe("danger");
    expect(d?.message).toContain("96.0%");
  });

  it("inadimplência média = Σ/12: seis meses a 60% → 30% → warn", () => {
    const inad = [60, 60, 60, 60, 60, 60, 0, 0, 0, 0, 0, 0];
    const out = diagnose(
      state({ revenue: { ...state().revenue, inadimplencia: inad } }),
      dre(),
      ind(),
    );
    expect(find(out, "Inadimplência elevada")?.message).toContain("30.0%");
  });

  it("rubrica com valor negativo → warn citando a primeira", () => {
    const neg: CostLine = {
      id: "rec",
      label: "Recuperação de despesas",
      category: "despesa_administrativa",
      values: [-100, ...m12(0).slice(1)],
      fixed: false,
    };
    const out = diagnose(state({ costs: [neg] }), dre(), ind());
    const d = find(out, "Linhas de custo com valores negativos");
    expect(d?.level).toBe("warn");
    expect(d?.message).toMatch(/^1 rubrica\(s\) .*"Recuperação de despesas"/);
  });
});

describe("diagnose — receita zerada", () => {
  it("receita bruta zero com custos fixos → operação inviável", () => {
    const s = state({ revenue: { ...state().revenue, bruta: m12(0) } });
    const out = diagnose(
      s,
      dre({ receitaLiquida: m12(0), lucroLiquido: m12(-30_000), ebitda: m12(-30_000) }),
      ind({ fcf: -360_000 }),
    );
    expect(find(out, "Operação inviável: receita zero com custos fixos")?.level).toBe("danger");
    // Sem receita líquida, alertas percentuais não são emitidos (evita ÷0)
    expect(titles(out)).not.toContain("Custos fixos altos demais");
    expect(titles(out)).not.toContain("Margem bruta baixa");
    expect(titles(out)).not.toContain("Custo de mão de obra elevado");
  });

  it("receita bruta positiva mas líquida ≤ 0 → receita líquida zerada", () => {
    const out = diagnose(state(), dre({ receitaLiquida: m12(0) }), ind());
    expect(find(out, "Receita líquida zerada")?.level).toBe("danger");
  });
});

describe("diagnose — estrutura de custos e margens", () => {
  it("folha 40% da RL → danger; 30% → warn; 25% exato → sem alerta", () => {
    const f = (folha: number) => diagnose(state(), dre({ folhaCltAnual: folha }), ind());
    expect(find(f(480_000), "Custo de mão de obra elevado")?.message).toMatch(
      /^Folha \(com encargos\) 40\.0%/,
    );
    expect(find(f(360_000), "Folha em zona de atenção")?.message).toMatch(/^Folha em 30\.0%/);
    const limite = titles(f(300_000));
    expect(limite).not.toContain("Folha em zona de atenção");
    expect(limite).not.toContain("Custo de mão de obra elevado");
  });

  it("custos fixos 60% da RL → danger", () => {
    const out = diagnose(state(), dre({ custosFixos: m12(60_000) }), ind());
    expect(find(out, "Custos fixos altos demais")?.message).toMatch(/^Custos fixos somam 60\.0%/);
  });

  it("margem bruta < 25% → danger", () => {
    const out = diagnose(state(), dre(), ind({ margemBruta: 20 }));
    expect(find(out, "Margem bruta baixa")?.level).toBe("danger");
  });

  it("margem líquida entre 0 e 5% → warn; negativa → danger", () => {
    expect(
      find(diagnose(state(), dre(), ind({ margemLiquida: 3 })), "Margem líquida insuficiente")
        ?.level,
    ).toBe("warn");
    expect(
      find(diagnose(state(), dre(), ind({ margemLiquida: -2 })), "Margem líquida insuficiente")
        ?.level,
    ).toBe("danger");
  });
});

describe("diagnose — endividamento, giro e valor", () => {
  it("cobertura de juros < 2× → danger; nula/infinita é ignorada", () => {
    expect(
      find(diagnose(state(), dre(), ind({ coberturaJuros: 1.5 })), "Cobertura de juros perigosa")
        ?.message,
    ).toBe("EBIT cobre apenas 1.5× os juros.");
    expect(titles(diagnose(state(), dre(), ind({ coberturaJuros: null })))).not.toContain(
      "Cobertura de juros perigosa",
    );
    expect(titles(diagnose(state(), dre(), ind({ coberturaJuros: -Infinity })))).not.toContain(
      "Cobertura de juros perigosa",
    );
  });

  it("Dívida Líq./EBITDA > 3× → warn; infinito não alerta", () => {
    expect(
      find(diagnose(state(), dre(), ind({ dividaLiqEbitda: 3.5 })), "Alavancagem elevada")?.level,
    ).toBe("warn");
    expect(titles(diagnose(state(), dre(), ind({ dividaLiqEbitda: Infinity })))).not.toContain(
      "Alavancagem elevada",
    );
  });

  it("gap de capital de giro positivo → warn com valor em R$", () => {
    const d = find(
      diagnose(state(), dre(), ind({ gapCapitalGiro: 25_000 })),
      "Necessidade de Capital de Giro não coberta",
    );
    expect(d?.message).toMatch(/^Falta R\$\s?25\.000,00 para o ciclo operacional\.$/);
  });

  it("gap e NCG negativos → ciclo financeiro libera caixa (ok)", () => {
    const out = diagnose(state(), dre(), ind({ gapCapitalGiro: -5_000, ncg: -5_000 }));
    expect(find(out, "Ciclo financeiro libera caixa")?.level).toBe("ok");
  });

  it("ROIC < WACC → destrói valor; liquidez corrente < 1 → danger", () => {
    const out = diagnose(state(), dre(), ind({ roic: 8, wacc: 14, liquidezCorrente: 0.8 }));
    expect(find(out, "Empresa destrói valor")?.message).toBe("ROIC 8.0% < WACC 14.0%.");
    expect(find(out, "Liquidez corrente crítica")?.message).toBe("Liquidez corrente 0.80.");
    expect(titles(out)).not.toContain("Empresa cria valor econômico");
  });
});

describe("diagnose — balanço de abertura", () => {
  it("abertura desequilibrada → warn com o valor do plug", () => {
    // Caixa de abertura 50.000 sem passivo/PL → diferença = 50.000
    const base = state();
    const s = { ...base, capital: { ...base.capital, disponibilidades: 50_000 } };
    const d = find(diagnose(s, dre(), ind()), "Balanço de abertura não fecha");
    expect(d?.level).toBe("warn");
    expect(d?.message).toMatch(/diferença de R\$\s?50\.000,00/);
  });

  it("falha ao derivar a abertura é silenciosa (não derruba o diagnóstico)", () => {
    const s = { ...state(), capital: undefined } as unknown as AppState;
    const out = diagnose(s, dre(), ind());
    expect(titles(out)).toEqual(["Empresa cria valor econômico"]);
  });
});
