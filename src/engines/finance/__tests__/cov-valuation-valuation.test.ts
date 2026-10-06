import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StrategicResult } from "../strategic";

// ---------------------------------------------------------------------
// Mocks controláveis: forecast (FCL projetado) e análise estratégica.
// Assim os valores de DCF/Gordon podem ser conferidos à mão.
// ---------------------------------------------------------------------
const ctl = vi.hoisted(() => ({
  fcl: [] as number[] | null, // null → buildForecast lança erro
  strategic: null as unknown,
}));

vi.mock("../forecast", async (orig) => {
  const real = await orig<typeof import("../forecast")>();
  return {
    ...real,
    buildForecast: vi.fn((_s: unknown, cfg: { horizonteMeses: number }) => {
      if (ctl.fcl === null) throw new Error("forecast inválido");
      const n = cfg.horizonteMeses;
      const base = ctl.fcl;
      return { meses: Array.from({ length: n }, (_, i) => ({ fcl: base[i % base.length] })) };
    }),
  };
});

vi.mock("../strategic", async (orig) => {
  const real = await orig<typeof import("../strategic")>();
  return {
    ...real,
    computeStrategic: vi.fn((s: Parameters<typeof real.computeStrategic>[0]) =>
      ctl.strategic ? ctl.strategic : real.computeStrategic(s),
    ),
  };
});

import {
  buildValuation,
  traceValuation,
  logValuationTrace,
  runValuationSelfTests,
  defaultValuationParams,
  VALUATION_PRESETS,
  type PrecomputedValuationModel,
  type ValuationParams,
} from "../valuation";
import { createState, m12 } from "./helpers";

const SEM_ESTRATEGIA: StrategicResult = {
  hasAnyAnswer: false,
  index: 0,
  haircut: 0,
  level: "indefinido",
  subscores: [],
  headline: "",
};

// EBITDA 1,2M · Receita 6M · LL 600k · WACC 12% · ROIC 20% · margem EBITDA 25%.
function modelo(over: Partial<{ wacc: number; roic: number; margemEbitda: number }> = {}) {
  return {
    regime: "presumido",
    dre: {
      ebitda: m12(100_000),
      receitaBruta: m12(500_000),
      lucroLiquido: m12(50_000),
    },
    ind: { wacc: 12, roic: 20, margemEbitda: 25, ...over },
  } as unknown as PrecomputedValuationModel;
}

// Dívida 1M − caixa 200k = dívida líquida 800k; Ke 15 / Kd 14 informados.
const estado = (over: Record<string, unknown> = {}) =>
  createState({
    capital: {
      ke: 15,
      kd: 14,
      patrimonioLiquido: 500_000,
      disponibilidades: 200_000,
      debtContracts: [
        {
          id: "d1",
          credor: "Banco",
          saldoDevedor: 1_000_000,
          taxaAA: 14,
          sistema: "price" as const,
          prazoMeses: 48,
        },
      ],
      ...over,
    },
  });

const params = (p: Partial<ValuationParams> = {}): ValuationParams => ({
  ...defaultValuationParams("servicos"),
  method: "multiples",
  evEbitdaMultiple: 5,
  evRevenueMultiple: 1,
  plMultiple: 10,
  controlPremium: 0,
  liquidityDiscount: 0,
  horizonYears: 1,
  terminalGrowthRate: 0.02,
  applyStrategicHaircut: true,
  ...p,
});

// Anuidade mensal: 100k × [1 − (1+w_m)^−12] / w_m com w_m = 1,12^(1/12) − 1
const WM = Math.pow(1.12, 1 / 12) - 1;
const VPN_12x100k = (100_000 * (1 - Math.pow(1 + WM, -12))) / WM;
// Gordon: VT = 1,2M × 1,02 / (0,12 − 0,02) = 12.240.000; VP = VT / 1,12
const VT = (1_200_000 * 1.02) / 0.1;
const VP_VT = VT / 1.12;

beforeEach(() => {
  ctl.fcl = [100_000];
  ctl.strategic = SEM_ESTRATEGIA;
});

describe("presets e parâmetros default", () => {
  it("default usa o múltiplo central da faixa setorial", () => {
    const p = defaultValuationParams("industria");
    expect(p.evEbitdaMultiple).toBe(VALUATION_PRESETS.industria.evEbitdaRange[1]);
    expect(p.evRevenueMultiple).toBe(1.1);
    expect(p.plMultiple).toBe(13);
    expect(p.terminalGrowthRate).toBe(0.02);
    expect(p.method).toBe("blended");
    expect(p.liquidityDiscount).toBe(0.15);
  });
  it("faixas pessimista ≤ base ≤ otimista em todos os setores", () => {
    for (const p of Object.values(VALUATION_PRESETS)) {
      for (const r of [p.evEbitdaRange, p.evRevenueRange, p.plRange]) {
        expect(r[0]).toBeLessThanOrEqual(r[1]);
        expect(r[1]).toBeLessThanOrEqual(r[2]);
      }
    }
  });
});

describe("múltiplos — média ponderada 50/30/20 com P/L convertido em EV", () => {
  it("EV = 0,5·6M + 0,3·6M + 0,2·(6M + 800k) = 6,16M; equity = 6,16M − 800k", () => {
    const v = buildValuation(estado(), params(), modelo());
    const m = v.multiplesDetails;
    expect(m.ebitda).toBe(1_200_000);
    expect(m.revenue).toBe(6_000_000);
    expect(m.ll).toBe(600_000);
    expect(m.evFromEbitda).toBe(6_000_000);
    expect(m.evFromRevenue).toBe(6_000_000);
    expect(m.equityFromPL).toBe(6_000_000);
    expect(m.blendedEnterpriseValue).toBeCloseTo(6_160_000, 6);
    expect(v.netDebt).toBe(800_000);
    expect(v.enterpriseValue.base).toBeCloseTo(6_160_000, 6);
    expect(v.equityValue.base).toBeCloseTo(5_360_000, 6);
    // faixa com DCF disponível: −25% / +35%
    expect(v.enterpriseValue.low).toBeCloseTo(6_160_000 * 0.75, 6);
    expect(v.enterpriseValue.high).toBeCloseTo(6_160_000 * 1.35, 6);
    expect(v.equityValue.low).toBeCloseTo(6_160_000 * 0.75 - 800_000, 6);
    // múltiplos implícitos
    expect(v.impliedMultiple.evEbitda).toBeCloseTo(6_160_000 / 1_200_000, 10);
    expect(v.impliedMultiple.evRevenue).toBeCloseTo(6_160_000 / 6_000_000, 10);
  });

  it("pesos renormalizados quando P/L e Receita são zerados → EV = EBITDA × m", () => {
    const v = buildValuation(estado(), params({ evRevenueMultiple: 0, plMultiple: 0 }), modelo());
    expect(v.multiplesDetails.blendedEnterpriseValue).toBeCloseTo(6_000_000, 6);
  });

  it("dívida líquida negativa (caixa > dívida) é limitada a zero no equity", () => {
    const s = estado({ disponibilidades: 5_000_000 });
    const v = buildValuation(s, params(), modelo());
    expect(v.netDebt).toBe(0);
    // sem ND, EV_PL = Equity_PL = 6M → blend = 6M
    expect(v.multiplesDetails.blendedEnterpriseValue).toBeCloseTo(6_000_000, 6);
    expect(v.equityValue.base).toBeCloseTo(v.enterpriseValue.base, 6);
  });

  it("EBITDA/receita/LL ≤ 0 → nenhum múltiplo aplicável, EV = 0 e múltiplos implícitos 0", () => {
    const m = {
      ...modelo(),
      dre: { ebitda: m12(-1), receitaBruta: m12(0), lucroLiquido: m12(-1) },
    } as unknown as PrecomputedValuationModel;
    const v = buildValuation(estado(), params(), m);
    expect(v.multiplesDetails.blendedEnterpriseValue).toBe(0);
    expect(v.impliedMultiple).toEqual({ evEbitda: 0, evRevenue: 0 });
    expect(v.equityValue.base).toBe(0);
    expect(v.narrative).toMatch(/não positivo/);
  });
});

describe("DCF — VPN mensal + valor terminal de Gordon", () => {
  it("12 × FCL 100k a 12% a.a. + Gordon(g = 2%)", () => {
    const v = buildValuation(estado(), params({ method: "dcf" }), modelo());
    const d = v.dcfDetails!;
    expect(d.fcfProjected).toHaveLength(12);
    expect(d.horizonMonths).toBe(12);
    expect(d.wacc).toBeCloseTo(12, 10);
    expect(d.npvFlows).toBeCloseTo(VPN_12x100k, 4);
    expect(d.terminalValue).toBeCloseTo(12_240_000, 4);
    // (1 + w_m)^12 = 1,12 → VP do terminal = VT / 1,12
    expect(d.npvTerminal).toBeCloseTo(VP_VT, 4);
    expect(d.growthTerminal).toBe(0.02);
    expect(d.warnings).toEqual([]);
    expect(v.enterpriseValue.base).toBeCloseTo(VPN_12x100k + VP_VT, 4);
  });

  it("horizonte de 3 anos: VT usa só o FCL dos últimos 12 meses e desconta 36 meses", () => {
    const v = buildValuation(estado(), params({ method: "dcf", horizonYears: 3 }), modelo());
    const d = v.dcfDetails!;
    expect(d.fcfProjected).toHaveLength(36);
    expect(d.terminalValue).toBeCloseTo(12_240_000, 4);
    expect(d.npvTerminal).toBeCloseTo(12_240_000 / Math.pow(1.12, 3), 3);
    const vpn36 = (100_000 * (1 - Math.pow(1 + WM, -36))) / WM;
    expect(d.npvFlows).toBeCloseTo(vpn36, 3);
  });

  it("blended = média simples de múltiplos e DCF; prêmio de controle e desconto de liquidez multiplicam", () => {
    const v = buildValuation(
      estado(),
      params({ method: "blended", controlPremium: 0.2, liquidityDiscount: 0.15 }),
      modelo(),
    );
    const evBase = (6_160_000 + VPN_12x100k + VP_VT) / 2;
    expect(v.enterpriseValue.base).toBeCloseTo(evBase * 1.2 * 0.85, 3);
  });

  it("WACC ausente → assume 10% a.a. com alerta; VT = 1,2M × 1,02 / 0,08", () => {
    const v = buildValuation(estado(), params({ method: "dcf" }), modelo({ wacc: 0 }));
    const d = v.dcfDetails!;
    expect(d.wacc).toBeCloseTo(10, 10);
    expect(d.warnings[0]).toMatch(/WACC não definido/);
    expect(d.terminalValue).toBeCloseTo((1_200_000 * 1.02) / 0.08, 4);
    expect(d.npvTerminal).toBeCloseTo(d.terminalValue / 1.1, 4);
    // NaN também cai no default
    const vNaN = buildValuation(estado(), params({ method: "dcf" }), modelo({ wacc: NaN }));
    expect(vNaN.dcfDetails!.wacc).toBeCloseTo(10, 10);
  });

  it("WACC > 50% gera alerta de faixa irreal (mas é usado)", () => {
    const v = buildValuation(estado(), params({ method: "dcf" }), modelo({ wacc: 60 }));
    expect(v.dcfDetails!.wacc).toBeCloseTo(60, 10);
    expect(v.dcfDetails!.warnings.some((w) => /fora de faixa realista/.test(w))).toBe(true);
    expect(v.confidenceRationale).toMatch(/WACC fora de faixa/);
  });

  it("g ≥ WACC − 0,5pp → fallback VT = FCL × 5 com alerta", () => {
    const v = buildValuation(
      estado(),
      params({ method: "dcf", terminalGrowthRate: 0.118 }),
      modelo(),
    );
    const d = v.dcfDetails!;
    expect(d.terminalValue).toBeCloseTo(1_200_000 * 5, 4);
    expect(d.warnings.some((w) => /Spread WACC − g/.test(w))).toBe(true);
  });

  it("FCL do último ano negativo → VT negativo e alerta; EV não positivo na narrativa", () => {
    ctl.fcl = [-10_000];
    const v = buildValuation(estado(), params({ method: "dcf" }), modelo());
    const d = v.dcfDetails!;
    expect(d.terminalValue).toBeCloseTo((-120_000 * 1.02) / 0.1, 4);
    expect(d.warnings.some((w) => /negativo/.test(w))).toBe(true);
    expect(v.enterpriseValue.base).toBeLessThan(0);
    expect(v.equityValue.base).toBe(0);
    expect(v.narrative).toMatch(/Enterprise Value não positivo/);
  });

  it("forecast que lança erro → DCF indisponível; faixa de múltiplos −10% / +15%", () => {
    ctl.fcl = null;
    const v = buildValuation(estado(), params({ method: "blended" }), modelo());
    expect(v.dcfDetails).toBeUndefined();
    // blended com DCF = 0 → metade do EV de múltiplos
    expect(v.enterpriseValue.base).toBeCloseTo(3_080_000, 6);
    expect(v.enterpriseValue.low).toBeCloseTo(3_080_000 * 0.9, 6);
    expect(v.enterpriseValue.high).toBeCloseTo(3_080_000 * 1.15, 6);
  });
});

describe("haircut estratégico, confiança e narrativa", () => {
  const critico: StrategicResult = {
    hasAnyAnswer: true,
    index: 30,
    haircut: 0.2,
    level: "crítico",
    subscores: [],
    headline: "",
  };

  it("haircut de 20% reduz o EV final; ignorado quando applyStrategicHaircut = false", () => {
    ctl.strategic = critico;
    const com = buildValuation(estado(), params(), modelo());
    expect(com.haircutApplied).toBe(0.2);
    expect(com.enterpriseValue.base).toBeCloseTo(6_160_000 * 0.8, 6);
    expect(com.narrative).toMatch(/Risco estratégico crítico/);
    const sem = buildValuation(estado(), params({ applyStrategicHaircut: false }), modelo());
    expect(sem.haircutApplied).toBe(0);
    expect(sem.enterpriseValue.base).toBeCloseTo(6_160_000, 6);
  });

  it("nota A quando tudo preenchido e estratégia robusta", () => {
    ctl.strategic = { ...critico, index: 80, haircut: 0, level: "robusto" };
    const v = buildValuation(estado(), params(), modelo());
    expect(v.confidenceScore).toBe("A");
    expect(v.confidenceRationale).toBe("Dados financeiros e estratégicos robustos.");
    expect(v.narrative).toContain("Empresa cria valor econômico (ROIC > WACC)");
    expect(v.narrative).toContain("Perfil estratégico robusto");
    expect(v.narrative).toContain("Margem EBITDA sólida");
  });

  it("nível 'adequado' não acrescenta frase estratégica; ROIC < WACC sinaliza destruição de valor", () => {
    ctl.strategic = { ...critico, index: 60, haircut: 0.05, level: "adequado" };
    const v = buildValuation(estado(), params(), modelo({ roic: 5, margemEbitda: 10 }));
    expect(v.narrative).toBe(
      "Valuation positivo, mas ROIC < WACC indica destruição de valor econômico.",
    );
  });

  it("penalidades acumuladas: sem estratégia (−25), g > 5% (−10) → 65 = C", () => {
    const v = buildValuation(estado(), params({ terminalGrowthRate: 0.06 }), modelo());
    expect(v.confidenceScore).toBe("C");
    expect(v.confidenceRationale).toContain("análise estratégica não preenchida");
    expect(v.confidenceRationale).toContain("g terminal acima de 5%");
  });

  it("sem estratégia (−25) → 75 = B", () => {
    expect(buildValuation(estado(), params(), modelo()).confidenceScore).toBe("B");
  });

  it("risco estratégico (−15) + capital não informado (−20) + Kd = 0 (−10) + WACC 0 (−15) → 40 = D", () => {
    ctl.strategic = critico;
    const s = estado({ debtContracts: [], patrimonioLiquido: 0, kd: 0 });
    const v = buildValuation(s, params(), modelo({ wacc: 0 }));
    expect(v.confidenceScore).toBe("D");
    expect(v.confidenceRationale).toContain("estrutura de capital não informada");
    expect(v.confidenceRationale).toContain("custo de capital não definido");
  });

  it("todas as penalidades → E", () => {
    const s = estado({ debtContracts: [], patrimonioLiquido: 0, kd: 0 });
    const v = buildValuation(s, params({ terminalGrowthRate: 0.06 }), modelo({ wacc: 0 }));
    // 100 − 25 − 20 − 10 − 10 − 15 = 20
    expect(v.confidenceScore).toBe("E");
  });
});

describe("traceValuation — memória de cálculo coerente com buildValuation", () => {
  it("passos e inputs batem com o resultado (método blended, haircut 10%)", () => {
    ctl.strategic = {
      hasAnyAnswer: true,
      index: 70,
      haircut: 0.1,
      level: "frágil",
      subscores: [],
      headline: "",
    };
    const p = params({ method: "blended", controlPremium: 0.1, liquidityDiscount: 0.2 });
    const t = traceValuation(estado(), p, modelo());
    const v = buildValuation(estado(), p, modelo());
    const passo = (l: string) => t.steps.find((s) => s.label.startsWith(l))!;
    expect(passo("EV via EBITDA").value).toBe(6_000_000);
    expect(passo("EV múltiplos").value).toBeCloseTo(6_160_000, 6);
    expect(passo("VPN fluxos DCF").value).toBeCloseTo(VPN_12x100k, 4);
    expect(passo("Valor terminal").value).toBeCloseTo(VT, 4);
    expect(passo("VP do terminal").value).toBeCloseTo(VP_VT, 4);
    const evBase = (6_160_000 + VPN_12x100k + VP_VT) / 2;
    expect(passo("EV método selecionado").value).toBeCloseTo(evBase, 3);
    expect(passo("EV ajustado").value).toBeCloseTo(evBase * 1.1 * 0.8, 3);
    expect(passo("Haircut estratégico (10.0%)").value).toBeCloseTo(evBase * 1.1 * 0.8 * 0.9, 3);
    expect(passo("Haircut estratégico").value).toBeCloseTo(v.enterpriseValue.base, 3);
    expect(passo("Dívida líquida").value).toBe(800_000);
    expect(passo("Equity Value final").value).toBeCloseTo(v.equityValue.base, 3);
    expect(t.inputs).toMatchObject({
      ebitda: 1_200_000,
      receita: 6_000_000,
      ll: 600_000,
      dividaOnerosa: 1_000_000,
      dividaLiquida: 800_000,
      wacc: 12,
      ke: 15,
      kd: 14,
      horizonAnos: 1,
      g: 0.02,
      haircut: 0.1,
    });
  });

  it("métodos 'multiples' e 'dcf' selecionam o EV correto", () => {
    const tm = traceValuation(estado(), params({ method: "multiples" }), modelo());
    expect(tm.steps.find((s) => s.label === "EV método selecionado")!.value).toBeCloseTo(
      6_160_000,
      6,
    );
    const td = traceValuation(estado(), params({ method: "dcf" }), modelo());
    expect(td.steps.find((s) => s.label === "EV método selecionado")!.value).toBeCloseTo(
      VPN_12x100k + VP_VT,
      3,
    );
  });

  it("forecast inválido → passo 'DCF indisponível' e equity nunca negativo", () => {
    ctl.fcl = null;
    const t = traceValuation(estado(), params({ method: "dcf" }), modelo());
    const dcf = t.steps.find((s) => s.label === "DCF")!;
    expect(dcf.formula).toMatch(/indisponível/);
    expect(dcf.value).toBe(0);
    expect(t.steps[t.steps.length - 1].value).toBe(0);
  });

  it("sem modelo pré-computado resolve DRE/indicadores internamente", () => {
    ctl.strategic = null;
    const s = createState({ revenue: { bruta: m12(80_000), inadimplencia: m12(1) } });
    const t = traceValuation(s, params());
    expect(t.inputs.receita).toBeGreaterThan(0);
    expect(t.steps.length).toBeGreaterThan(5);
  });
});

describe("logValuationTrace e self-tests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logValuationTrace agrupa e imprime a tabela de passos", () => {
    ctl.strategic = null;
    const g = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const tb = vi.spyOn(console, "table").mockImplementation(() => {});
    const ge = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    logValuationTrace(createState(), params(), "teste");
    expect(g).toHaveBeenCalledWith(expect.stringContaining("teste"));
    expect(tb).toHaveBeenCalledTimes(1);
    expect(ge).toHaveBeenCalledTimes(1);
  });

  it("runValuationSelfTests: todos os casos de referência passam", () => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const { results, allPassed } = runValuationSelfTests();
    expect(allPassed).toBe(true);
    expect(results.length).toBe(11);
    const gordon = results.find((r) => r.name.startsWith("Valor terminal Gordon"))!;
    // 600k × 1,02 / 0,10 = 6.120.000
    expect(gordon.actual).toBeCloseTo(6_120_000, 6);
    expect(gordon.delta).toBeCloseTo(0, 6);
  });
});
