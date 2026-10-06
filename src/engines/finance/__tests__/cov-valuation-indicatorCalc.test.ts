import { describe, it, expect } from "vitest";
import { buildIndicatorCalcs } from "../indicatorCalc";
import { buildDRE } from "../dre";
import { calcIndicators, type Indicators } from "../indicators";
import { resolveEffectiveRegime } from "../regime";
import { deriveAbertura } from "../aberturaDerivada";
import { sum, fmtBRL, fmtPct, fmtRatio, fmtNum, fmtAnos, fmtDays } from "../format";
import type { AppState } from "../types";
import { createState, m12 } from "./helpers";

const NA = "Base insuficiente — cálculo indisponível";
/** Lado direito da memória ("= resultado"). */
const rhs = (s: string) => s.split("\n= ")[1];

// Empresa lucrativa com dívida (120k a 14% a.a.), amortização de 3k/mês,
// depreciação de 1k/mês e 10 colaboradores.
function estado(): AppState {
  return createState({
    revenue: { bruta: m12(80_000), inadimplencia: m12(0) },
    capital: {
      patrimonioLiquido: 300_000,
      ativoTotal: 600_000,
      ke: 15,
      kd: 14,
      disponibilidades: 50_000,
      depreciacaoMensal: 1_000,
      debtContracts: [
        {
          id: "d1",
          credor: "Banco",
          saldoDevedor: 120_000,
          taxaAA: 14,
          sistema: "price" as const,
          prazoMeses: 36,
        },
      ],
    },
    cashflow: { amortizacoes: m12(3_000) },
  });
}

function pipeline(s: AppState) {
  const { dre } = buildDRE(s, resolveEffectiveRegime(s));
  const ind = calcIndicators(s, dre);
  return { dre, ind };
}

describe("buildIndicatorCalcs — memória coerente com o card (SSOT)", () => {
  const s = estado();
  const { dre, ind } = pipeline(s);
  const c = buildIndicatorCalcs(s, dre, ind, 0.12);
  const RL = ind.receitaLiquidaAnual;

  it("margens: resultado = indicador da engine e numerador/denominador corretos", () => {
    expect(rhs(c.margemBruta)).toBe(fmtPct(ind.margemBruta / 100));
    expect(c.margemBruta).toContain(`${fmtBRL(sum(dre.lucroBruto))} ÷ ${fmtBRL(RL)}`);
    expect(rhs(c.margemEbitda)).toBe(fmtPct(ind.margemEbitda / 100));
    expect(rhs(c.margemLiquida)).toBe(fmtPct(ind.margemLiquida / 100));
    expect(rhs(c.margemContribuicao)).toBe(fmtPct(ind.margemContribuicao / 100));
  });

  it("ponto de equilíbrio operacional = (CF + Dep) ÷ MC% e financeiro = CF ÷ MC%", () => {
    const cv = sum(dre.custosVariaveis);
    const cf = sum(dre.custosFixos);
    const dep = sum(dre.depreciacao);
    const mc = (RL - cv) / RL;
    expect(dep).toBeCloseTo(12_000, 6);
    expect(ind.pontoEquilibrioOperacional).toBeCloseTo((cf + dep) / mc, 4);
    expect(ind.pontoEquilibrioFinanceiro).toBeCloseTo(cf / mc, 4);
    expect(rhs(c.pontoEquilibrioOperacional)).toBe(fmtBRL(ind.pontoEquilibrioOperacional));
    expect(rhs(c.pontoEquilibrioFinanceiro)).toBe(fmtBRL(ind.pontoEquilibrioFinanceiro));
    expect(rhs(c.pontoEquilibrioTotal)).toBe(fmtBRL(ind.pontoEquilibrio));
    // margem de segurança = (RL − PE_op) ÷ RL
    expect(rhs(c.margemSeguranca)).toBe(`${fmtNum(ind.margemSeguranca, 1)}%`);
    expect(ind.margemSeguranca).toBeCloseTo(((RL - ind.pontoEquilibrioOperacional) / RL) * 100, 6);
  });

  it("ROIC e EVA: EVA = (ROIC − WACC) × Capital Investido", () => {
    expect(rhs(c.roic)).toBe(fmtPct(ind.nopat / ind.capitalInvestido));
    expect(rhs(c.roic)).toBe(fmtPct(ind.roic / 100));
    expect(ind.eva).toBeCloseTo(((ind.roic - ind.wacc) / 100) * ind.capitalInvestido, 4);
    expect(rhs(c.eva)).toBe(fmtBRL(ind.eva));
    expect(rhs(c.wacc)).toBe(`${fmtNum(ind.wacc, 1)}%`);
    expect(c.wacc).toContain("15,0%");
    expect(c.wacc).toContain("14,0%");
  });

  it("liquidez corrente/seca/imediata batem com a engine", () => {
    expect(rhs(c.liquidezCorrente)).toBe(fmtRatio(ind.liquidezCorrente));
    expect(rhs(c.liquidezSeca)).toBe(fmtRatio(ind.liquidezSeca));
    expect(rhs(c.liquidezImediata)).toBe(fmtRatio(ind.liquidezImediata));
    expect(c.liquidezGeral).not.toBe(NA);
    expect(rhs(c.endividamentoGeral)).toBe(fmtPct(ind.endividamentoGeral / 100));
  });

  it("estrutura: capital próprio = PL reconciliado ÷ (PL + D), igual ao card", () => {
    const pl = ind.bases.pl;
    expect(c.capitalProprio).toContain(`${fmtBRL(pl)} ÷ (${fmtBRL(pl)} + ${fmtBRL(120_000)})`);
    expect(rhs(c.capitalProprio)).toBe(fmtPct(ind.proprioPercent / 100));
    expect(ind.proprioPercent / 100).toBeCloseTo(pl / (pl + 120_000), 10);
  });

  it("cobertura de juros e DSCR usam juros dos contratos: DSCR = EBITDA ÷ (juros + 36.000)", () => {
    expect(rhs(c.coberturaJuros)).toBe(`${fmtRatio(ind.coberturaJuros ?? NaN)}×`);
    expect(rhs(c.dscr)).toBe(`${fmtRatio(ind.dscr ?? NaN)}×`);
    expect(c.dscr).toContain(fmtBRL(36_000));
  });

  it("alavancagem: Dív. Líq./EBITDA igual ao card", () => {
    expect(rhs(c.dividaLiqEbitda)).toBe(`${fmtRatio(ind.dividaLiqEbitda)}×`);
    expect(c.dividaLiqEbit).not.toBe(NA);
    expect(c.dividaLiqPl).not.toBe(NA);
    expect(c.amortizacaoPlPorLucro).toContain("anos");
  });

  it("topo: EBITDA = EBIT + Depreciação e RL = RB − impostos sobre vendas", () => {
    expect(ind.ebitAnual + sum(dre.depreciacao)).toBeCloseTo(ind.ebitdaAnual, 4);
    expect(rhs(c.ebitda12m)).toBe(fmtBRL(ind.ebitdaAnual));
    expect(ind.receitaBrutaAnual - sum(dre.impostosVendas)).toBeCloseTo(RL, 4);
    expect(rhs(c.receitaLiquida12m)).toBe(fmtBRL(RL));
    expect(rhs(c.lucroLiquido12m)).toBe(fmtBRL(ind.lucroLiquidoAnual));
  });

  it("caixa/operação: CAGR informado, FCF, ciclo, NCG e conversão EBITDA→caixa", () => {
    expect(rhs(c.cagrReceitas12m)).toBe(fmtPct(0.12));
    expect(rhs(c.fcf)).toBe(fmtBRL(ind.fcf));
    expect(rhs(c.cicloFinanceiro)).toBe(fmtDays(ind.cicloFinanceiro, 1));
    expect(rhs(c.ncg)).toBe(fmtBRL(ind.ncg));
    expect(rhs(c.gapCapitalGiro)).toBe(fmtBRL(ind.gapCapitalGiro));
    expect(rhs(c.conversaoEbitdaCaixa)).toBe(fmtPct(ind.fcf / ind.ebitdaAnual));
    expect(rhs(c.gao)).toBe(`${fmtRatio(ind.gao)}×`);
    expect(rhs(c.gaf)).toBe(`${fmtRatio(ind.gaf)}×`);
    expect(rhs(c.qualidadeLucro)).toBe(`${fmtRatio(ind.qualidadeLucro)}×`);
  });

  it("RH: faturamento por colaborador = 960.000 ÷ 10 = 96.000", () => {
    expect(rhs(c.faturamentoPorColaborador)).toBe(fmtBRL(96_000));
    expect(c.faturamentoPorColaborador).toContain(`${fmtBRL(960_000)} ÷ 10 colaborador(es)`);
    expect(rhs(c.receitaPorColaborador)).toBe(fmtBRL(RL / 10));
    expect(rhs(c.ebitdaPorColaborador)).toBe(fmtBRL(ind.ebitdaPorColaborador));
    expect(rhs(c.lucroPorColaborador)).toBe(fmtBRL(ind.lucroPorColaborador));
    expect(rhs(c.folhaSobreReceita)).toBe(`${fmtNum(ind.custoPessoalSobreReceita, 1)}%`);
  });

  it("fiscal: carga sobre receita e sobre lucro", () => {
    const imp = sum(dre.impostosVendas) + sum(dre.impostos);
    expect(ind.impostosSobreReceita).toBeCloseTo((imp / ind.receitaBrutaAnual) * 100, 6);
    expect(rhs(c.impostosSobreReceita)).toBe(`${fmtNum(ind.impostosSobreReceita, 1)}%`);
    expect(rhs(c.impostosSobreLucro)).toBe(`${fmtNum(ind.impostosSobreLucro, 1)}%`);
  });

  it("CAGR default (NaN) → base insuficiente", () => {
    expect(buildIndicatorCalcs(s, dre, ind).cagrReceitas12m).toBe(NA);
  });
});

describe("buildIndicatorCalcs — médias de abertura/fechamento e ramos alternativos", () => {
  it("ROA/Giro com ativo médio: (abertura 400k + fechamento do balanço) ÷ 2", () => {
    const s = estado();
    s.capital.ativoTotalAbertura = 400_000;
    const { dre, ind } = pipeline(s);
    const c = buildIndicatorCalcs(s, dre, ind);
    const atMedio = (400_000 + ind.bases.ativoTotal) / 2;
    expect(ind.bases.ativoMedio).toBeCloseTo(atMedio, 6);
    expect(c.roa).toContain(`÷ ${fmtBRL(atMedio)} × 100`);
    expect(rhs(c.roa)).toBe(fmtPct(ind.roa / 100));
    expect(rhs(c.roa)).toBe(fmtPct(ind.lucroLiquidoAnual / atMedio));
    expect(rhs(c.giroAtivo)).toBe(`${fmtRatio(ind.receitaLiquidaAnual / atMedio)}×`);
  });

  it("payback do CAPEX = CAPEX ÷ FCF (60k ÷ 30k = 2,0 anos)", () => {
    const s = estado();
    const { dre, ind } = pipeline(s);
    const c = buildIndicatorCalcs(s, dre, {
      ...ind,
      capexAnual: 60_000,
      fcf: 30_000,
      paybackCapex: 2,
    });
    expect(c.paybackCapex).toContain(`${fmtBRL(60_000)} ÷ ${fmtBRL(30_000)}`);
    expect(rhs(c.paybackCapex)).toBe(fmtAnos(2));
  });

  it("gap de capital de giro mostra o CDG de Fleuriet (PL + PNC − ANC) usado pela engine", () => {
    const s = estado();
    s.capital.ativoCirculante = 200_000;
    s.capital.passivoCirculante = 80_000;
    const { dre, ind } = pipeline(s);
    const c = buildIndicatorCalcs(s, dre, ind);
    const b = ind.bases;
    expect(c.gapCapitalGiro).toContain(
      `(${fmtBRL(b.cdgPl)} + ${fmtBRL(b.cdgPnc)} − ${fmtBRL(b.cdgAnc)})`,
    );
    expect(c.gapCapitalGiro).toContain(`${fmtBRL(ind.ncg)} − ${fmtBRL(b.cdg)}`);
    expect(ind.ncg - b.cdg).toBeCloseTo(ind.gapCapitalGiro, 6);
    expect(rhs(c.gapCapitalGiro)).toBe(fmtBRL(ind.gapCapitalGiro));
  });
});

describe("buildIndicatorCalcs — bases insuficientes", () => {
  // Empresa vazia: sem receita, sem custos, sem capital, sem colaboradores.
  const s = createState({
    revenue: { bruta: m12(0), inadimplencia: m12(0) },
    costs: [],
    numColaboradores: 0,
  });
  const { dre } = buildDRE(s, resolveEffectiveRegime(s));
  const zeros = new Proxy({}, { get: () => 0 });
  const zeroInd = new Proxy(
    {},
    { get: (_t, k) => (k === "bases" ? zeros : 0) },
  ) as unknown as Indicators;
  const c = buildIndicatorCalcs(s, dre, zeroInd);

  it("todas as razões com denominador nulo devolvem a mensagem de base insuficiente", () => {
    const naKeys: (keyof typeof c)[] = [
      "margemBruta",
      "margemEbitda",
      "eva",
      "margemLiquida",
      "margemContribuicao",
      "pontoEquilibrioOperacional",
      "pontoEquilibrioFinanceiro",
      "pontoEquilibrioTotal",
      "roe",
      "roa",
      "roic",
      "wacc",
      "liquidezCorrente",
      "liquidezSeca",
      "liquidezImediata",
      "liquidezGeral",
      "endividamentoGeral",
      "capitalProprio",
      "giroAtivo",
      "dividaLiqEbitda",
      "dividaLiqEbit",
      "dividaLiqPl",
      "amortizacaoPlPorLucro",
      "paybackCapex",
      "cagrReceitas12m",
      "gao",
      "gaf",
      "qualidadeLucro",
      "conversaoEbitdaCaixa",
      "folhaSobreReceita",
      "margemSeguranca",
      "impostosSobreReceita",
      "impostosSobreLucro",
    ];
    for (const k of naKeys) expect(c[k], k).toBe(NA);
  });

  it("sem dívida: cobertura de juros e DSCR viram N/A explicativo", () => {
    expect(c.coberturaJuros).toBe("Sem dívida onerosa — indicador não aplicável (N/A)");
    expect(c.dscr).toBe("Sem serviço da dívida no período — indicador não aplicável (N/A)");
  });

  it("sem colaboradores: pede o headcount", () => {
    expect(c.faturamentoPorColaborador).toBe(
      "Informe o nº de colaboradores em Configurações Rápidas",
    );
  });

  it("memórias sempre disponíveis (FCF, ciclo, NCG, topo) mesmo zeradas", () => {
    expect(rhs(c.fcf)).toBe(fmtBRL(0));
    expect(rhs(c.ncg)).toBe(fmtBRL(0));
    expect(rhs(c.receitaLiquida12m)).toBe(fmtBRL(0));
  });

  it("PL de abertura informado manualmente entra na média do ROE (mesma base do card)", () => {
    const s2 = createState({
      revenue: { bruta: m12(0), inadimplencia: m12(0) },
      costs: [],
      capital: { patrimonioLiquido: 300_000, patrimonioLiquidoAbertura: 100_000 },
    });
    const { dre: d2, ind: i2 } = pipeline(s2);
    const c2 = buildIndicatorCalcs(s2, d2, i2);
    // Se a SSOT de abertura (deriveAbertura) não trouxer PL, usa o campo manual.
    const plSSOT = deriveAbertura({ state: s2, impostosTotalMensais: d2.impostosTotal }).totals.pl;
    const plAb = plSSOT > 0 ? plSSOT : 100_000;
    expect(i2.bases.plAbertura).toBe(plAb);
    const plMedio = (plAb + i2.bases.pl) / 2;
    expect(i2.bases.plMedio).toBeCloseTo(plMedio, 6);
    expect(c2.roe).toBe(
      `${fmtBRL(i2.lucroLiquidoAnual)} ÷ ${fmtBRL(plMedio)} × 100\n= ${fmtPct((i2.roe ?? NaN) / 100)}`,
    );
  });
});
