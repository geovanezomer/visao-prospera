// Análise Estratégica — sub-scores, HHI (parâmetros CADE), índice ponderado,
// haircut e quadrante financeiro × estratégico.
//
// O HHI esperado é recalculado de forma INDEPENDENTE (bisseção) a partir da
// mesma hipótese do engine: os n clientes do top-80% têm shares em PG
// decrescente a partir do maior cliente (s1) e somam exatamente 80%.

import { describe, it, expect } from "vitest";
import { computeStrategic, quadrant, type StrategicResult } from "../strategic";
import { createState } from "./helpers";
import type { AppState, StrategicAnswers } from "../types";

const withAnswers = (a: Partial<StrategicAnswers>): AppState => {
  const base = createState();
  return {
    ...base,
    strategic: {
      concentration: {},
      governance: {},
      competitive: {},
      regulatory: {},
      ...a,
    } as StrategicAnswers,
  };
};

const sub = (r: StrategicResult, key: string) => r.subscores.find((s) => s.key === key)!;

/** HHI de referência: Σ (s1·rⁱ)² com Σ s1·rⁱ = 80 (i = 0..n−1). */
function hhiReferencia(s1: number, n: number): number {
  if (s1 >= 80) return s1 * s1;
  const soma = (r: number) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += s1 * Math.pow(r, i);
    return t;
  };
  let lo = 0;
  let hi = 0.999;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (soma(mid) < 80) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  let h = 0;
  for (let i = 0; i < n; i++) h += Math.pow(s1 * Math.pow(r, i), 2);
  return h;
}

describe("computeStrategic — sem respostas", () => {
  it("nada preenchido → índice 0, haircut 0, nível indefinido", () => {
    const r = computeStrategic(withAnswers({}));
    expect(r.hasAnyAnswer).toBe(false);
    expect(r.index).toBe(0);
    expect(r.haircut).toBe(0);
    expect(r.level).toBe("indefinido");
    expect(r.subscores.every((s) => !s.filled && s.status === "unknown")).toBe(true);
    expect(r.headline).toMatch(/não preenchida/);
  });

  it("state.strategic ausente usa respostas vazias", () => {
    const s = { ...createState(), strategic: undefined } as unknown as AppState;
    expect(computeStrategic(s).level).toBe("indefinido");
  });
});

describe("Concentração de clientes — HHI", () => {
  it("s1 = 50% com 1–2 clientes no top-80%: PG 50 + 30 → HHI = 2500 + 900 = 3400", () => {
    // n = 2 → 50·(1 + r) = 80 → r = 0,6 → shares 50% e 30%
    const r = computeStrategic(
      withAnswers({ concentration: { pctMaiorCliente: 50, clientesPara80Pct: "1-2" } }),
    );
    expect(r.hhi).toBe(3400);
    const c = sub(r, "concentration");
    // score = 100 − 3400/5000·100 = 32
    expect(c.score).toBeCloseTo(32, 10);
    expect(c.status).toBe("danger");
    expect(c.highlights[0]).toBe("Maior cliente = 50% da receita (crítico)");
    expect(c.highlights[1]).toMatch(/alta — parâmetro CADE/);
  });

  it("maior cliente ≥ 80% → HHI = s1² (cauda pulverizada ignorada)", () => {
    const r = computeStrategic(withAnswers({ concentration: { pctMaiorCliente: 90 } }));
    expect(r.hhi).toBe(8100);
    // 100 − 8100/50 < 0 → piso em 0
    expect(sub(r, "concentration").score).toBe(0);
  });

  it.each([
    [30, "3-5", 4],
    [20, "6-15", 10],
    [10, "16+", 20],
    [25, undefined, 5], // sem faixa informada → n = 5
  ] as const)("s1 = %d%%, faixa %s → HHI bate com a PG de referência (n = %d)", (s1, faixa, n) => {
    const r = computeStrategic(
      withAnswers({ concentration: { pctMaiorCliente: s1, clientesPara80Pct: faixa } }),
    );
    const esperado = hhiReferencia(s1, n);
    // Engine arredonda para inteiro; Newton com tolerância 1e-4 em f
    expect(Math.abs(r.hhi! - esperado)).toBeLessThanOrEqual(2);
  });

  it("s1 = 30%, n = 4: HHI ≈ 1787 → concentração moderada, highlight 'alto'", () => {
    // PG: 30(1 + r + r² + r³) = 80 → r ≈ 0,7345
    // HHI ≈ 900·(1 + r² + r⁴ + r⁶) ≈ 1787
    const r = computeStrategic(
      withAnswers({ concentration: { pctMaiorCliente: 30, clientesPara80Pct: "3-5" } }),
    );
    expect(r.hhi).toBeGreaterThan(1780);
    expect(r.hhi).toBeLessThan(1795);
    const c = sub(r, "concentration");
    expect(c.highlights[0]).toBe("Maior cliente = 30% da receita (alto)");
    expect(c.highlights[1]).toMatch(/moderada/);
    // score = 100 − HHI/50
    expect(c.score).toBeCloseTo(100 - r.hhi! / 50, 10);
  });

  it("base pulverizada (s1 = 10%, 16+ clientes): HHI baixa e status ok", () => {
    const r = computeStrategic(
      withAnswers({ concentration: { pctMaiorCliente: 10, clientesPara80Pct: "16+" } }),
    );
    expect(r.hhi!).toBeLessThan(1500);
    const c = sub(r, "concentration");
    expect(c.highlights[0]).toBe("Maior cliente = 10% da receita");
    expect(c.highlights[1]).toMatch(/baixa/);
    expect(c.status).toBe("ok");
  });

  it("sem % do maior cliente → HHI indefinido e score neutro de 60", () => {
    const r = computeStrategic(withAnswers({ concentration: { clientesPara80Pct: "3-5" } }));
    expect(r.hhi).toBeUndefined();
    const c = sub(r, "concentration");
    expect(c.filled).toBe(true);
    expect(c.score).toBe(60);
    expect(c.status).toBe("warn");
    expect(c.highlights).toEqual([]);
  });

  it("maior cliente recente (< 1 ano) com ≥ 25% recebe penalidade de 15 pontos", () => {
    const semTempo = sub(
      computeStrategic(withAnswers({ concentration: { pctMaiorCliente: 50 } })),
      "concentration",
    );
    const recente = sub(
      computeStrategic(
        withAnswers({ concentration: { pctMaiorCliente: 50, tempoMaiorCliente: "lt1" } }),
      ),
      "concentration",
    );
    expect(semTempo.score - recente.score).toBeCloseTo(15, 10);
    expect(recente.highlights).toContain("Maior cliente < 1 ano: relação ainda não testada");
  });

  it("maior cliente de 1–3 anos com ≥ 40% perde 8 pontos; com 30% não perde", () => {
    const score = (s1: number, tempo?: "1-3") =>
      sub(
        computeStrategic(
          withAnswers({ concentration: { pctMaiorCliente: s1, tempoMaiorCliente: tempo } }),
        ),
        "concentration",
      ).score;
    expect(score(40) - score(40, "1-3")).toBeCloseTo(8, 10);
    expect(score(30, "1-3")).toBeCloseTo(score(30), 10);
  });
});

describe("Fornecedores & canais", () => {
  const sup = (c: StrategicAnswers["concentration"]) =>
    sub(computeStrategic(withAnswers({ concentration: c })), "suppliers");

  it("não preenchido quando não há fornecedor nem canal", () => {
    expect(sup({ pctMaiorCliente: 20 }).filled).toBe(false);
  });

  it("score cai linearmente com a participação do maior fornecedor e zera em 100%", () => {
    const a = sup({ pctMaiorFornecedor: 10 }).score;
    const b = sup({ pctMaiorFornecedor: 20 }).score;
    const c = sup({ pctMaiorFornecedor: 30 }).score;
    // Linear: diferenças iguais
    expect(a - b).toBeCloseTo(b - c, 10);
    expect(a).toBeGreaterThan(b);
    expect(sup({ pctMaiorFornecedor: 100 }).score).toBe(0);
  });

  it("faixas de destaque por participação do maior fornecedor", () => {
    expect(sup({ pctMaiorFornecedor: 60 }).highlights[0]).toMatch(/alto risco de ruptura/);
    expect(sup({ pctMaiorFornecedor: 35 }).highlights[0]).toBe("Maior fornecedor = 35% do CPV");
    expect(sup({ pctMaiorFornecedor: 10 }).highlights[0]).toMatch(/diversificado/);
  });

  it("dependência de canal: único −25, parcial −10, diversificado sem penalidade", () => {
    const nao = sup({ dependeCanal: "nao" });
    const parcial = sup({ dependeCanal: "parcial" });
    const sim = sup({ dependeCanal: "sim" });
    expect(nao.score - parcial.score).toBeCloseTo(10, 10);
    expect(nao.score - sim.score).toBeCloseTo(25, 10);
    expect(nao.highlights).toEqual(["Aquisição diversificada entre canais"]);
    expect(parcial.highlights[0]).toMatch(/parcial/);
    expect(sim.highlights[0]).toMatch(/único canal/);
  });

  it("score nunca fica negativo (fornecedor 90% + canal único)", () => {
    const r = sup({ pctMaiorFornecedor: 90, dependeCanal: "sim" });
    expect(r.score).toBe(0);
    expect(r.status).toBe("danger");
  });
});

describe("Governança & pessoas-chave", () => {
  it("média simples das respostas: (10 + 35 + 10 + 5) / 4 = 15", () => {
    const g = sub(
      computeStrategic(
        withAnswers({
          governance: {
            socioAfastado60d: "para",
            quemFechaContrato: "socios",
            processosDocumentados: "nenhum",
            planoSucessao: "nunca",
          },
        }),
      ),
      "governance",
    );
    expect(g.score).toBeCloseTo(15, 10);
    expect(g.status).toBe("danger");
    expect(g.highlights).toHaveLength(4);
    expect(g.highlights[0]).toMatch(/bus factor = 1/);
  });

  it("empresa madura: (100 + 100 + 95 + 100) / 4 = 98,75 → ok, sem alertas", () => {
    const g = sub(
      computeStrategic(
        withAnswers({
          governance: {
            socioAfastado60d: "normal",
            quemFechaContrato: "equipe",
            processosDocumentados: "maioria",
            planoSucessao: "sim",
          },
        }),
      ),
      "governance",
    );
    expect(g.score).toBeCloseTo(98.75, 10);
    expect(g.status).toBe("ok");
    expect(g.highlights).toEqual([]);
  });

  it("média só das respostas dadas: perde_eficiencia (55) + ninguem (5) = 30", () => {
    const g = sub(
      computeStrategic(
        withAnswers({
          governance: { socioAfastado60d: "perde_eficiencia", quemFechaContrato: "ninguem" },
        }),
      ),
      "governance",
    );
    expect(g.score).toBeCloseTo(30, 10);
    expect(g.highlights[0]).toMatch(/sobrevive/);
    expect(g.highlights[1]).toMatch(/dependentes dos sócios/);
  });

  it("plano de sucessão 'nao' (25) sozinho → danger com alerta de sucessão", () => {
    const g = sub(
      computeStrategic(withAnswers({ governance: { planoSucessao: "nao" } })),
      "governance",
    );
    expect(g.score).toBe(25);
    expect(g.highlights).toEqual(["Sem plano de sucessão para posições-chave"]);
  });
});

describe("Posição competitiva (Porter simplificado)", () => {
  it("sem moat: (5 + 15 + 20 + 25 + 10) / 5 = 15", () => {
    const c = sub(
      computeStrategic(
        withAnswers({
          competitive: {
            reajustePrecos: "reduziu",
            elasticidade10pct: "mais_20",
            razaoContratacao: "preco",
            concorrentes: "10+",
            switchingCost: "commodity",
          },
        }),
      ),
      "competitive",
    );
    expect(c.score).toBeCloseTo(15, 10);
    expect(c.status).toBe("danger");
    expect(c.highlights).toEqual([
      "Sem poder de precificação — guerra de preço corrói margem",
      "Demanda muito elástica: 10% no preço derruba 20%+ dos clientes",
      "Cliente compra por preço — sem moat competitivo",
      "Mercado fragmentado e concorrido",
      "Produto commodity — sem barreira de troca",
    ]);
  });

  it("moat forte: (100 + 100 + 95 + 100 + 100) / 5 = 99", () => {
    const c = sub(
      computeStrategic(
        withAnswers({
          competitive: {
            reajustePrecos: "sem_resistencia",
            elasticidade10pct: "menos_5",
            razaoContratacao: "marca",
            concorrentes: "nenhum",
            switchingCost: "alto",
          },
        }),
      ),
      "competitive",
    );
    expect(c.score).toBeCloseTo(99, 10);
    expect(c.status).toBe("ok");
    expect(c.highlights).toContain("Forte poder de precificação (preço sobe sem resistência)");
    expect(c.highlights).toContain("Diferencial percebido além de preço");
    expect(c.highlights).toContain("Alto switching cost: cliente preso por integração/contrato");
  });

  it("intermediário: nao_repassou (25) + qualidade (85) = 55 → warn", () => {
    const c = sub(
      computeStrategic(
        withAnswers({
          competitive: { reajustePrecos: "nao_repassou", razaoContratacao: "qualidade" },
        }),
      ),
      "competitive",
    );
    expect(c.score).toBeCloseTo(55, 10);
    expect(c.status).toBe("warn");
  });
});

describe("Exposição regulatória", () => {
  it.each([
    ["sim", 25, "danger", /risco binário/],
    ["parcial", 60, "warn", /parcial/],
    ["nao", 95, "ok", /Sem dependência/],
  ] as const)("%s → score %d (%s)", (resp, score, status, re) => {
    const r = sub(
      computeStrategic(withAnswers({ regulatory: { exposicaoRegulatoria: resp } })),
      "regulatory",
    );
    expect(r.score).toBe(score);
    expect(r.status).toBe(status);
    expect(r.highlights[0]).toMatch(re);
  });
});

describe("Agregação — índice, haircut e nível", () => {
  it("renormaliza pesos só entre dimensões preenchidas", () => {
    // Governança = 15 (peso 0,25) e Regulatória = 95 (peso 0,05)
    // índice = (15·0,25 + 95·0,05) / 0,30 = (3,75 + 4,75) / 0,30 = 28,333…
    // haircut = (75 − 28,333)/75 · 0,4 = 0,248888…
    const r = computeStrategic(
      withAnswers({
        governance: {
          socioAfastado60d: "para",
          quemFechaContrato: "socios",
          processosDocumentados: "nenhum",
          planoSucessao: "nunca",
        },
        regulatory: { exposicaoRegulatoria: "nao" },
      }),
    );
    expect(r.hasAnyAnswer).toBe(true);
    expect(r.index).toBe(28);
    expect(r.haircut).toBeCloseTo(((75 - 8.5 / 0.3) / 75) * 0.4, 10);
    expect(r.level).toBe("crítico");
    expect(r.headline).toMatch(/^Risco estratégico crítico/);
    expect(r.headline).toContain("Maior fragilidade: governança & pessoas-chave");
    expect(r.headline).toContain("(2/5 dimensões respondidas)");
  });

  it("índice ≥ 75 → robusto, haircut 0", () => {
    const r = computeStrategic(withAnswers({ regulatory: { exposicaoRegulatoria: "nao" } }));
    expect(r.index).toBe(95);
    expect(r.haircut).toBe(0);
    expect(r.level).toBe("robusto");
    expect(r.headline).toMatch(/^Risco estratégico baixo/);
  });

  it("índice 60 → adequado; haircut = 15/75·0,4 = 0,08", () => {
    const r = computeStrategic(withAnswers({ regulatory: { exposicaoRegulatoria: "parcial" } }));
    expect(r.index).toBe(60);
    expect(r.haircut).toBeCloseTo(0.08, 10);
    expect(r.level).toBe("adequado");
    expect(r.headline).toMatch(/moderado/);
  });

  it("índice ≈ 42 → frágil; haircut proporcional à distância de 75", () => {
    // Governança: 'perde_eficiencia' (55) + 'socios' (35) → 45 (peso 0,25)
    // Regulatória 'sim' → 25 (peso 0,05)
    // índice = (45·0,25 + 25·0,05) / 0,30 = 41,666…
    const r = computeStrategic(
      withAnswers({
        governance: { socioAfastado60d: "perde_eficiencia", quemFechaContrato: "socios" },
        regulatory: { exposicaoRegulatoria: "sim" },
      }),
    );
    const idx = (45 * 0.25 + 25 * 0.05) / 0.3;
    expect(r.index).toBe(Math.round(idx));
    expect(r.haircut).toBeCloseTo(((75 - idx) / 75) * 0.4, 10);
    expect(r.level).toBe("frágil");
    expect(r.headline).toMatch(/elevado/);
  });

  it("haircut máximo é 0,40 (índice 0)", () => {
    const r = computeStrategic(withAnswers({ concentration: { pctMaiorCliente: 95 } }));
    // Concentração = 0 e fornecedores não preenchido → índice 0
    expect(r.index).toBe(0);
    expect(r.haircut).toBeCloseTo(0.4, 10);
  });
});

describe("quadrant — financeiro × estratégico", () => {
  const strat = (index: number, has = true) =>
    ({ hasAnyAnswer: has, index }) as unknown as StrategicResult;

  it("indefinida quando estratégico não avaliado", () => {
    expect(quadrant(90, strat(0, false)).q).toBe("indefinida");
  });

  it("limites: financeiro ≥ 60 e estratégico ≥ 55", () => {
    expect(quadrant(60, strat(55)).q).toBe("robusta");
    expect(quadrant(60, strat(54)).q).toBe("fragil_rica");
    expect(quadrant(59, strat(55)).q).toBe("vulneravel");
    expect(quadrant(59, strat(54)).q).toBe("critica");
  });

  it("rótulos legíveis em pt-BR", () => {
    expect(quadrant(80, strat(80)).label).toBe("Robusta");
    expect(quadrant(80, strat(20)).label).toBe("Frágil-rica");
    expect(quadrant(20, strat(80)).label).toBe("Vulnerável");
    expect(quadrant(20, strat(20)).label).toBe("Crítica");
  });
});
