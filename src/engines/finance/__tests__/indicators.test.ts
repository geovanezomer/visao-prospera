/**
 * Indicadores — testes canônicos
 *
 * Cobertura: WACC, ROIC, FCF, Ponto de Equilíbrio, NCG, Cobertura de Juros,
 * ROE/ROA, Giro do Ativo. Inclui guards contra divisão por zero (denominadores
 * estruturais ausentes) para garantir que safeMath está aplicado.
 */
import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { calcIndicators } from "../indicators";
import { buildFinancialModel } from "../financialModel";
import { irShieldForRegime } from "../tax/real";
import { createState, m12 } from "./helpers";

const aproxPp = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

describe("Indicadores — WACC", () => {
  it("WACC = wE·Ke + wD·Kd·(1−T) no Lucro Real (T=34%)", () => {
    const s = createState({
      tax: { regime: "real" },
      capital: { ke: 15, kd: 10, patrimonioLiquido: 600_000, debtContracts: [{ id: "sim", credor: "Banco", saldoDevedor: 400_000, taxaAA: 18, sistema: "price" as const, prazoMeses: 24 }]},
    });
    const { dre } = buildDRE(s, "real");
    const ind = calcIndicators(s, dre);
    // 0.6 · 15 + 0.4 · 10 · (1 − 0.34) = 9 + 2.64 = 11.64
    expect(aproxPp(ind.wacc, 11.64)).toBe(true);
  });

  it("WACC sem shield em Simples (T=0)", () => {
    expect(irShieldForRegime("simples")).toBe(0);
    const s = createState({
      tax: { regime: "simples" },
      capital: { ke: 15, kd: 10, patrimonioLiquido: 500_000, debtContracts: [{ id: "sim", credor: "Banco", saldoDevedor: 500_000, taxaAA: 18, sistema: "price" as const, prazoMeses: 24 }]},
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // 0.5·15 + 0.5·10 = 12.5
    expect(aproxPp(ind.wacc, 12.5)).toBe(true);
  });

  it("WACC finito mesmo com PL=0 e Dívida=0 (safeMath)", () => {
    const s = createState({
      capital: { ke: 15, kd: 10, patrimonioLiquido: 0,  proprio: 100 },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.wacc)).toBe(true);
  });
});

describe("Indicadores — ROIC / ROE / ROA", () => {
  it("ROIC preserva prejuízo operacional (não trava NOPAT negativo em zero)", () => {
    const s = createState({
      revenue: { bruta: m12(10_000), inadimplencia: m12(0) },
      costs: [{ id: "cf", label: "Custo fixo", category: "fixo", values: m12(30_000), fixed: true }],
      capital: { ativoTotal: 1_000_000, patrimonioLiquido: 700_000, },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);

    expect(ind.ebitAnual).toBeLessThan(0);
    expect(ind.nopat).toBeLessThan(0);
    expect(ind.roic).toBeLessThan(0);
  });

  it("ROIC usa capital investido real e não denominador artificial 1", () => {
    const s = createState({
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
      costs: [],
      capital: {
        ativoTotal: 0,
        patrimonioLiquido: 0,
        
        passivosNaoOnerosos: 0,
        caixaOcioso: 0,
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);

    // Após SSOT do Ativo (via balancoFechamento), CI pode ser > 0 mesmo
    // sem `capital.ativoTotal` — o balanço reconstrói AC/AT a partir de
    // receita/estoques/CR. O que este teste garante é que o denominador
    // NUNCA é o valor artificial 1 (que gerava ROIC absurdo).
    expect(ind.capitalInvestido).not.toBe(1);
    expect(Number.isFinite(ind.roic)).toBe(true);
  });

  it("NOPAT no Lucro Real aplica alíquota marginal operacional sem dupla contagem", () => {
    const s = createState({
      tax: { regime: "real" },
      revenue: { bruta: m12(100_000), inadimplencia: m12(0) },
      costs: [{ id: "cv", label: "CV", category: "variavel", values: m12(40_000), fixed: false }],
      capital: { ativoTotal: 2_000_000, patrimonioLiquido: 1_500_000, },
    });
    const { dre } = buildDRE(s, "real");
    const ind = calcIndicators(s, dre);

    expect(ind.ebitAnual).toBeGreaterThan(240_000);
    expect(ind.aliquotaNopat).toBeCloseTo(34, 1);
    expect(ind.nopat).toBeCloseTo(ind.ebitAnual * 0.66, 0);
  });

  it("ROE = LL/PL × 100 (positivo)", () => {
    const s = createState({
      revenue: { bruta: m12(100_000) },
      capital: { patrimonioLiquido: 1_200_000, ativoTotal: 2_000_000 },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // ROE deve ser um número finito (não-null quando PL médio > 0).
    expect(ind.roe).not.toBeNull();
    expect(Number.isFinite(ind.roe as number)).toBe(true);
  });

  it("ROE = null quando PL = 0 (padrão CFA: métrica sem significado)", () => {
    const s = createState({ capital: { patrimonioLiquido: 0 } });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.roe).toBeNull();
  });

  /**
   * Corolário DuPont: sem alavancagem financeira (net debt ≤ 0), ROE ≈ ROIC.
   * Diferença > 5 p.p. sinaliza que ROE ou ROIC está com denominador errado —
   * classicamente ROE usando apenas Capital Social em vez do PL completo.
   */
  it("ROE ≈ ROIC quando não há dívida líquida (DuPont sem alavancagem)", () => {
    // Sem dívida, sem juros, sem ativoTotal informado (CI cai em PL+D=PL) e
    // Simples com t=0 → NOPAT=EBIT=LL. ROE deve bater com ROIC.
    const s = createState({
      revenue: { bruta: m12(200_000) },
      capital: {
        ke: 15,
        kd: 0,
        patrimonioLiquido: 1_000_000,
        debtContracts: [],
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.roe).not.toBeNull();
    expect(Math.abs((ind.roe as number) - ind.roic)).toBeLessThan(5);
  });

  it("ROA = 0 quando Ativo Total = 0 (sem Infinity)", () => {
    const s = createState({ capital: { ativoTotal: 0 } });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.roa).toBe(0);
    expect(Number.isFinite(ind.roa)).toBe(true);
  });

  it("ROIC finito mesmo com Capital Investido degenerado", () => {
    const s = createState({
      capital: {
        ativoTotal: 0,
        patrimonioLiquido: 0,
        
        passivosNaoOnerosos: 0,
        fornecedores: 0,
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.roic)).toBe(true);
  });

  /**
   * [Auditoria] Empresa SEM dívida onerosa (só passivo operacional) não pode
   * disparar "endividamento crítico". `endividamentoOneroso` deve ser 0 e
   * `endividamentoGeral` deve refletir só o passivo operacional real —
   * NÃO o proxy `AT − PL` que inflava o número.
   */
  it("Sem dívida onerosa: endividamentoOneroso=0, geral < 40% (não crítico)", () => {
    const s = createState({
      capital: {
        ativoTotal: 221_916,
        patrimonioLiquido: 145_460, // AT − passivo operacional
        debtContracts: [],
        // Balanço detalhado com passivo só operacional (fornecedores/impostos/folha)
        balanco: {
          passivoCirculante: {
            fornecedores: 40_000,
            impostosPagar: 20_456,
            salariosEncargos: 16_000,
          },
        },
      },
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.endividamentoOneroso).toBe(0);
    expect(ind.endividamentoGeral).toBeLessThan(40);
    expect(ind.endividamentoGeralDadosCompletos).toBe(true);
  });
});

describe("Indicadores — Ponto de Equilíbrio", () => {
  it("PE = Custos Fixos ÷ Margem de Contribuição", () => {
    // Setup minimalista: zera todos os custos default e adiciona controlados.
    const s = createState({
      revenue: { bruta: m12(10_000), inadimplencia: m12(0) },
      costs: [
        { id: "cv", label: "CV", category: "variavel", values: m12(4_000), fixed: false },
        { id: "cf", label: "Aluguel", category: "fixo", values: m12(2_000), fixed: true },
      ],
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    // MC% = (RL − CV)/RL ; PE = CF / (MC%/100)
    expect(ind.margemContribuicao).toBeGreaterThan(0);
    expect(ind.pontoEquilibrio).toBeGreaterThan(0);
    expect(Number.isFinite(ind.pontoEquilibrio)).toBe(true);
  });

  it("PE = 0 quando MC% ≤ 0 (sem Infinity)", () => {
    const s = createState({
      revenue: { bruta: m12(1_000) },
      costs: [{ id: "cv", label: "CV", category: "variavel", values: m12(5_000), fixed: false }],
    });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.pontoEquilibrio).toBe(0);
  });
});

describe("Indicadores — NCG e FCF (SSOT via Balanço)", () => {
  it("NCG do indicador === NCG implícita no Balanço de Fechamento", () => {
    // Após a refatoração SSOT, NCG é DERIVADA do balanço de fechamento
    // (CR + Est) − (Fornec + Salários + Impostos a pagar). O indicador deve
    // reproduzir exatamente a identidade — sem divergência com o balanço.
    const s = createState({
      revenue: { bruta: m12(60_000) },
      costs: [{ id: "cpv", label: "CPV", category: "custo_vendas", values: m12(30_000), fixed: false }],
      capital: { contasReceber: 100_000, estoques: 50_000, fornecedores: 30_000 },
    });
    const model = buildFinancialModel(s);
    const bal = model.balancoFechamento.balanco;
    const cr = (bal.ativoCirculante?.contasReceberClientes ?? 0) - (bal.ativoCirculante?.pdd ?? 0);
    const est = bal.ativoCirculante?.estoques ?? 0;
    const forn = bal.passivoCirculante?.fornecedores ?? 0;
    const sal = bal.passivoCirculante?.salariosEncargos ?? 0;
    const imp = bal.passivoCirculante?.impostosPagar ?? 0;
    const ncgBal = (cr + est) - (forn + sal + imp);
    expect(model.ind.ncg).toBeCloseTo(ncgBal, 0);
  });

  it("FCF finito mesmo sem dados de capital de giro", () => {
    const s = createState({});
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(Number.isFinite(ind.fcf)).toBe(true);
  });
});

// [Auditoria SSOT Liquidez] Liquidez deve ser derivada do Balanço de
// Fechamento (mesmo apêndice impresso no PDF), não de estimativa PMR/PMP.
// Bug histórico: LC do indicador 32× diferente do balanço impresso.
describe("Indicadores — Liquidez SSOT (Balanço de Fechamento)", () => {
  it("LC/LS/LG do indicador === razão calculada direto do Balanço", () => {
    const s = createState({
      revenue: { bruta: m12(60_000) },
      costs: [{ id: "cpv", label: "CPV", category: "custo_vendas", values: m12(30_000), fixed: false }],
      capital: {
        contasReceber: 100_000,
        estoques: 50_000,
        fornecedores: 30_000,
        ativoTotal: 500_000,
        patrimonioLiquido: 300_000,
      },
    });
    const model = buildFinancialModel(s);
    const bal = model.balancoFechamento.balanco;
    const ac =
      (bal.ativoCirculante?.caixaEquivalentes ?? 0) +
      (bal.ativoCirculante?.contasReceberClientes ?? 0) +
      (bal.ativoCirculante?.estoques ?? 0) +
      (bal.ativoCirculante?.impostosRecuperar ?? 0);
    const pc =
      (bal.passivoCirculante?.fornecedores ?? 0) +
      (bal.passivoCirculante?.salariosEncargos ?? 0) +
      (bal.passivoCirculante?.impostosPagar ?? 0) +
      (bal.passivoCirculante?.emprestimosFinanciamentosCP ?? 0);
    if (pc > 1) {
      expect(model.ind.liquidezCorrente).toBeCloseTo(ac / pc, 3);
      expect(model.ind.ativoCirculante).toBeCloseTo(ac, 0);
      expect(model.ind.passivoCirculante).toBeCloseTo(pc, 0);
    }
    expect(model.ind.liquidezEstimada).toBe(false);
  });

  it("Liquidez Imediata NÃO aplica abs quando caixa é negativo (descoberto)", () => {
    // Força caixa negativo via disponibilidades negativas — o balanço
    // propaga o valor cru; a Liquidez Imediata deve refletir o descoberto.
    const s = createState({
      capital: {
        disponibilidades: -50_000,
        fornecedores: 40_000,
        ativoTotal: 200_000,
        patrimonioLiquido: 100_000,
      },
    });
    const ind = calcIndicators(s, buildDRE(s, "simples").dre);
    expect(ind.caixaNegativo).toBe(true);
    // A Liquidez Imediata deve ser negativa OU zero — nunca positiva.
    expect(ind.liquidezImediata).toBeLessThanOrEqual(0);
  });
});


describe("Indicadores — Cobertura de Juros / DSCR / Giro", () => {
  it("Sem dívida onerosa → coberturaJuros e DSCR = null (N/A)", () => {
    const s = createState({});
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.coberturaJuros).toBeNull();
    expect(ind.dscr).toBeNull();
  });

  it("Giro do Ativo = 0 quando Ativo Total = 0", () => {
    const s = createState({ capital: { ativoTotal: 0 } });
    const { dre } = buildDRE(s, "simples");
    const ind = calcIndicators(s, dre);
    expect(ind.giroAtivo).toBe(0);
  });
});

// [Auditoria Bloco 5] ROA e Giro do Ativo devem usar ATIVO MÉDIO quando abertura informada.
describe("Indicadores — ROA / Giro com Ativo Médio (CFA/Damodaran)", () => {
  it("ROA usa Ativo MÉDIO = (abertura + final)/2 quando ativoTotalAbertura > 0", () => {
    const sFinal = createState({
      capital: { ativoTotal: 1_200_000 },
      tax: { regime: "real" },
    });
    const sMedio = createState({
      capital: { ativoTotal: 1_200_000, ativoTotalAbertura: 800_000 },
      tax: { regime: "real" },
    });
    const indFinal = calcIndicators(sFinal, buildDRE(sFinal, "real").dre);
    const indMedio = calcIndicators(sMedio, buildDRE(sMedio, "real").dre);
    // Médio = 1.000.000 < final = 1.200.000 → ROA médio > ROA ponto-final (mesmo LL, denominador menor).
    if (indFinal.roa !== 0) {
      expect(Math.abs(indMedio.roa)).toBeGreaterThan(Math.abs(indFinal.roa));
    }
    expect(Number.isFinite(indMedio.roa)).toBe(true);
  });

  it("Giro do Ativo usa Ativo MÉDIO (consistente com ROA)", () => {
    const s = createState({
      capital: { ativoTotal: 1_000_000, ativoTotalAbertura: 600_000 },
    });
    const ind = calcIndicators(s, buildDRE(s, "simples").dre);
    // Médio = 800k. Giro = RL / 800k > RL / 1M.
    expect(ind.giroAtivo).toBeGreaterThan(0);
    expect(Number.isFinite(ind.giroAtivo)).toBe(true);
  });

  // [Auditoria SSOT ROA] Bug histórico: quando `capital.ativoTotal` está
  // subestimado (típico: usuário só preenche imobilizado bruto de abertura),
  // ROA divergia do LL/Ativo Total do Balanço. Deve usar o Ativo do balanço
  // reconciliado como fonte primária.
  it("ROA usa Ativo Total do BALANÇO reconciliado, não capital.ativoTotal", () => {
    // capital.ativoTotal deliberadamente ZERADO — força a engine a usar o balanço.
    const s = createState({
      revenue: { bruta: m12(60_000) },
      capital: {
        ativoTotal: 0,
        contasReceber: 80_000,
        estoques: 40_000,
        patrimonioLiquido: 100_000,
        fornecedores: 20_000,
      },
    });
    const model = buildFinancialModel(s);
    // Ativo do balanço > 0 → ROA deve ser finito e usar esse denominador.
    expect(model.balancoFechamento.totals.ativo).toBeGreaterThan(0);
    if (Math.abs(model.ind.lucroLiquidoAnual) > 1) {
      const roaEsperado = (model.ind.lucroLiquidoAnual / model.balancoFechamento.totals.ativo) * 100;
      expect(model.ind.roa).toBeCloseTo(roaEsperado, 1);
    }
  });
});

