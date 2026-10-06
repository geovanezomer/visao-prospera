/**
 * Agregadores do Balanço Detalhado — totais por grupo, fechamento
 * Ativo = Passivo + PL, propagação para os agregados de capital (SSOT),
 * sugestão a partir do state operacional, mescla e snapshot N-1.
 */
import { describe, expect, it } from "vitest";
import {
  calcAtivoCirculante,
  calcAtivoNaoCirculante,
  calcBalancoTotals,
  calcDividaOnerosa,
  calcImobilizadoLiquido,
  calcIntangivelLiquido,
  calcPassivoCirculante,
  calcPassivoNaoCirculante,
  calcPatrimonioLiquido,
  calcRealizavelLP,
  isBalancoPreenchido,
  mergeBalancoPreservandoUsuario,
  normalizeStateFromBalanco,
  snapshotAnterior,
  suggestBalancoFromState,
} from "../balanco";
import { createState, m12 } from "./helpers";
import type { AppState, BalancoDetalhado, CostLine, DebtContract } from "../types";

/**
 * Balanço que fecha:
 *  AC  = 10.000 + 5.000 + 20.000 − 1.000 (PDD) + 8.000           = 42.000
 *  ANC = RLP (3.000 + 2.000) + Invest. 4.000
 *      + Imob. (50.000 + 30.000 − 20.000 dep.) + Intang. (10.000 − 4.000)
 *      = 5.000 + 4.000 + 60.000 + 6.000                          = 75.000
 *  AT  = 117.000
 *  PC  = 12.000 + 15.000 + 3.000 + 5.000                         = 35.000
 *  PNC = 25.000 + 10.000 (debêntures) + 2.000                    = 37.000
 *  PL  = 40.000 + 6.000 + 4.000 − 3.000 (div. pagos) − 2.000 (tesouraria) = 45.000
 *  P + PL = 72.000 + 45.000 = 117.000 ✔
 */
const BAL: BalancoDetalhado = {
  dataBase: "2026-12-31",
  ativoCirculante: {
    caixaEquivalentes: 10_000,
    aplicacoesFinanceirasCP: 5_000,
    contasReceberClientes: 20_000,
    pdd: 1_000,
    estoques: 8_000,
  },
  ativoNaoCirculante: {
    realizavelLP: { creditosLP: 3_000, depositosJudiciais: 2_000 },
    investimentos: 4_000,
    imobilizado: { maquinasEquipamentos: 50_000, veiculos: 30_000, depreciacaoAcumulada: 20_000 },
    intangivel: { software: 10_000, amortizacaoAcumulada: 4_000 },
  },
  passivoCirculante: {
    fornecedores: 12_000,
    emprestimosFinanciamentosCP: 15_000,
    impostosPagar: 3_000,
    salariosEncargos: 5_000,
  },
  passivoNaoCirculante: {
    emprestimosFinanciamentosLP: 25_000,
    debentures: 10_000,
    provisoesLP: 2_000,
  },
  patrimonioLiquido: {
    capitalSocial: 40_000,
    reservasLucros: 6_000,
    resultadoExercicio: 4_000,
    dividendosPagosPeriodo: 3_000,
    acoesEmTesouraria: 2_000,
  },
};

describe("calc* — sub-totais do balanço", () => {
  it("contas redutoras (PDD, depreciação, amortização, tesouraria, dividendos) subtraem", () => {
    expect(calcAtivoCirculante(BAL)).toBe(42_000);
    expect(calcRealizavelLP(BAL)).toBe(5_000);
    expect(calcImobilizadoLiquido(BAL)).toBe(60_000);
    expect(calcIntangivelLiquido(BAL)).toBe(6_000);
    expect(calcAtivoNaoCirculante(BAL)).toBe(75_000);
    expect(calcPassivoCirculante(BAL)).toBe(35_000);
    expect(calcPassivoNaoCirculante(BAL)).toBe(37_000);
    expect(calcPatrimonioLiquido(BAL)).toBe(45_000);
    // Dívida onerosa = empréstimos CP + LP + debêntures = 15.000 + 25.000 + 10.000
    expect(calcDividaOnerosa(BAL)).toBe(50_000);
  });

  it("balanço ausente → todos os sub-totais 0", () => {
    expect(calcAtivoCirculante(undefined)).toBe(0);
    expect(calcImobilizadoLiquido(undefined)).toBe(0);
    expect(calcIntangivelLiquido(undefined)).toBe(0);
    expect(calcRealizavelLP(undefined)).toBe(0);
    expect(calcAtivoNaoCirculante(undefined)).toBe(0);
    expect(calcPassivoCirculante(undefined)).toBe(0);
    expect(calcPassivoNaoCirculante(undefined)).toBe(0);
    expect(calcPatrimonioLiquido(undefined)).toBe(0);
    expect(calcDividaOnerosa(undefined)).toBe(0);
  });

  it("valores não finitos são tratados como 0", () => {
    const b: BalancoDetalhado = {
      ativoCirculante: { caixaEquivalentes: NaN, estoques: 100, pdd: Infinity },
    };
    expect(calcAtivoCirculante(b)).toBe(100);
  });
});

describe("calcBalancoTotals — fechamento Ativo = Passivo + PL", () => {
  it("balanço equilibrado: diferença 0 e passivos não onerosos = PT − dívida", () => {
    const t = calcBalancoTotals(BAL);
    expect(t.ativoTotal).toBe(117_000);
    expect(t.passivoTotal).toBe(72_000);
    expect(t.patrimonioLiquido).toBe(45_000);
    expect(t.diferenca).toBe(0);
    expect(t.investimentos).toBe(4_000);
    expect(t.dividaOnerosa).toBe(50_000);
    expect(t.passivosNaoOnerosos).toBe(22_000); // 72.000 − 50.000
  });

  it("diferença mostra o descasamento quando o balanço não fecha", () => {
    const b: BalancoDetalhado = {
      ...BAL,
      ativoCirculante: { ...BAL.ativoCirculante, caixaEquivalentes: 10_500 },
    };
    expect(calcBalancoTotals(b).diferenca).toBe(500);
  });

  it("passivos não onerosos nunca ficam negativos (dívida maior que o passivo informado)", () => {
    const b: BalancoDetalhado = {
      passivoCirculante: { emprestimosFinanciamentosCP: 1_000 },
      passivoNaoCirculante: { debentures: 500 },
    };
    // PT = 1.500, dívida = 1.500 → 0
    expect(calcBalancoTotals(b).passivosNaoOnerosos).toBe(0);
  });
});

describe("isBalancoPreenchido", () => {
  it("ausente ou vazio → false; qualquer ativo, passivo ou PL ≠ 0 → true", () => {
    expect(isBalancoPreenchido(undefined)).toBe(false);
    expect(isBalancoPreenchido({})).toBe(false);
    expect(isBalancoPreenchido(BAL)).toBe(true);
    expect(isBalancoPreenchido({ passivoCirculante: { fornecedores: 1 } })).toBe(true);
    // PL negativo (passivo a descoberto) também conta como preenchido
    expect(isBalancoPreenchido({ patrimonioLiquido: { lucrosPrejuizosAcumulados: -10 } })).toBe(
      true,
    );
  });
});

describe("normalizeStateFromBalanco — balanço detalhado vira SSOT dos agregados", () => {
  it("sem balanço preenchido devolve o mesmo state (modo legado)", () => {
    const s = createState({});
    expect(normalizeStateFromBalanco(s)).toBe(s);
  });

  it("sobrescreve ativo, PL, AC/PC e capital de giro com as rubricas detalhadas", () => {
    const s = createState({
      capital: { balanco: BAL, disponibilidades: 999, contasReceber: 999 },
    });
    const c = normalizeStateFromBalanco(s).capital;
    expect(c.ativoTotal).toBe(117_000);
    expect(c.ativoCirculante).toBe(42_000);
    expect(c.passivoCirculante).toBe(35_000);
    expect(c.patrimonioLiquido).toBe(45_000);
    expect(c.passivosNaoOnerosos).toBe(22_000);
    expect(c.disponibilidades).toBe(15_000); // caixa + aplicações CP
    expect(c.contasReceber).toBe(19_000); // CR líquido de PDD
    expect(c.estoques).toBe(8_000);
    expect(c.fornecedores).toBe(12_000);
  });

  it("balanço parcial preserva caixa/CR/estoques/fornecedores digitados no Card 1", () => {
    const s = createState({
      capital: {
        balanco: { ativoNaoCirculante: { imobilizado: { veiculos: 40_000 } } },
        disponibilidades: 7_000,
        contasReceber: 3_000,
        estoques: 2_000,
        fornecedores: 1_500,
      },
    });
    const c = normalizeStateFromBalanco(s).capital;
    expect(c.ativoTotal).toBe(40_000);
    expect(c.disponibilidades).toBe(7_000);
    expect(c.contasReceber).toBe(3_000);
    expect(c.estoques).toBe(2_000);
    expect(c.fornecedores).toBe(1_500);
  });

  it("modo Odoo: o fechamento real (realizado.balancoFechamento) tem prioridade sobre a abertura", () => {
    const fechamento: BalancoDetalhado = {
      ativoCirculante: { caixaEquivalentes: 30_000 },
      patrimonioLiquido: { capitalSocial: 30_000 },
    };
    const s = createState({ capital: { balanco: BAL } });
    const comRealizado = {
      ...s,
      realizado: { balancoFechamento: fechamento },
    } as unknown as AppState;
    const c = normalizeStateFromBalanco(comRealizado).capital;
    expect(c.ativoTotal).toBe(30_000);
    expect(c.patrimonioLiquido).toBe(30_000);
    expect(c.disponibilidades).toBe(30_000);
  });
});

describe("suggestBalancoFromState — pré-preenchimento a partir das páginas operacionais", () => {
  const cost = (id: string, category: CostLine["category"], v: number): CostLine => ({
    id,
    label: id,
    category,
    values: m12(v),
    fixed: true,
  });
  const contrato = (id: string, saldo: number, prazo: number): DebtContract => ({
    id,
    credor: id,
    saldoDevedor: saldo,
    taxaAA: 12,
    sistema: "price",
    prazoMeses: prazo,
  });

  const base = createState({
    revenue: { bruta: m12(10_000), pmr: 30, pmp: 45 },
    costs: [
      cost("cmv", "custo_vendas", 3_000),
      cost("dv", "direto_venda", 2_000),
      cost("adm", "fixo", 2_000),
      cost("com", "variavel", 1_000),
    ],
    capital: {
      contasReceber: 0,
      fornecedores: 0,
      estoques: 4_000,
      disponibilidades: 15_000,
      caixaOcioso: 5_000,
      depreciacaoMensal: 100,
      capexAtivacao: [
        { id: "k1", label: "Máquina", mes: 1, valor: 12_000, vidaUtilMeses: 60 },
        { id: "k2", label: "Móveis", mes: 7, valor: 6_000, vidaUtilMeses: 0 },
      ],
      debtContracts: [contrato("cp", 10_000, 12), contrato("lp", 20_000, 36)],
    },
  });

  it("deriva CR/fornecedores por prazos médios, imobilizado por CAPEX e dívida por maturidade", () => {
    const b = suggestBalancoFromState(base, {
      dreLucroLiquido: 18_000,
      dreImpostosLucroAnual: 24_000,
    });
    // Caixa operacional = 15.000 − 5.000 ocioso; ocioso vai para aplicações CP
    expect(b.ativoCirculante?.caixaEquivalentes).toBe(10_000);
    expect(b.ativoCirculante?.aplicacoesFinanceirasCP).toBe(5_000);
    // CR = 120.000 × 30/360 = 10.000
    expect(b.ativoCirculante?.contasReceberClientes).toBeCloseTo(10_000, 6);
    expect(b.ativoCirculante?.estoques).toBe(4_000);
    // CAPEX 18.000; depreciação acumulada:
    //   100 × 12 = 1.200 (depreciação mensal)
    // + 12.000/60 × 12 meses (jan→dez) = 2.400
    // +  6.000/60 (vida 0 → 60) × 6 meses (jul→dez) = 600   ⇒ 4.200
    expect(b.ativoNaoCirculante?.imobilizado?.outrosImobilizados).toBe(18_000);
    expect(b.ativoNaoCirculante?.imobilizado?.depreciacaoAcumulada).toBeCloseTo(4_200, 6);
    // Sem mútuos ativos → nenhum crédito com sócio no RLP
    expect(b.ativoNaoCirculante?.realizavelLP?.creditosLP).toBe(0);
    // Fornecedores = CPV (3.000 + 2.000) × 12 × 45/360 = 60.000 × 0,125 = 7.500
    expect(b.passivoCirculante?.fornecedores).toBeCloseTo(7_500, 6);
    // Dívida: prazo 12 → CP; prazo 36 → LP
    expect(b.passivoCirculante?.emprestimosFinanciamentosCP).toBe(10_000);
    expect(b.passivoNaoCirculante?.emprestimosFinanciamentosLP).toBe(20_000);
    // Provisões ≈ 1 mês: impostos 24.000/12; salários (fixo+variável) 36.000/12
    expect(b.passivoCirculante?.impostosPagar).toBe(2_000);
    expect(b.passivoCirculante?.salariosEncargos).toBe(3_000);
    expect(b.patrimonioLiquido?.resultadoExercicio).toBe(18_000);
  });

  it("usa os saldos digitados em capital quando informados; sem impostos/folha, provisões = 0", () => {
    const s: AppState = {
      ...base,
      costs: [cost("cmv", "custo_vendas", 3_000)],
      capital: { ...base.capital, contasReceber: 7_777, fornecedores: 3_333, capexAtivacao: [] },
    };
    const b = suggestBalancoFromState(s, { dreLucroLiquido: -500 });
    expect(b.ativoCirculante?.contasReceberClientes).toBe(7_777);
    expect(b.passivoCirculante?.fornecedores).toBe(3_333);
    expect(b.passivoCirculante?.impostosPagar).toBe(0);
    expect(b.passivoCirculante?.salariosEncargos).toBe(0);
    expect(b.ativoNaoCirculante?.imobilizado?.depreciacaoAcumulada).toBe(1_200);
    expect(b.patrimonioLiquido?.resultadoExercicio).toBe(-500);
  });

  it("mútuo PJ→PF quitado dentro do ano não deixa crédito no RLP", () => {
    const s = {
      ...base,
      mutuosSocios: [
        {
          id: "m",
          nome: "Sócio",
          valorConcedido: 6_000,
          mesConcessao: 1,
          taxaMensalPct: 0,
          prazoMeses: 6,
          mesInicioDevolucao: 2,
        },
      ],
    } as AppState;
    const b = suggestBalancoFromState(s, { dreLucroLiquido: 0 });
    expect(b.ativoNaoCirculante?.realizavelLP?.creditosLP).toBeCloseTo(0, 9);
  });

  it("caixa ocioso maior que disponibilidades não gera caixa operacional negativo; sem PMR/PMP → 0", () => {
    const s = createState({
      revenue: { bruta: m12(1_000), pmr: 0, pmp: 0 },
      costs: [],
      capital: {
        disponibilidades: 1_000,
        caixaOcioso: 3_000,
        contasReceber: 0,
        fornecedores: 0,
        debtContracts: [],
      },
    });
    const b = suggestBalancoFromState(s, { dreLucroLiquido: 0 });
    expect(b.ativoCirculante?.caixaEquivalentes).toBe(0);
    expect(b.ativoCirculante?.contasReceberClientes).toBe(0);
    expect(b.passivoCirculante?.fornecedores).toBe(0);
  });
});

describe("mergeBalancoPreservandoUsuario", () => {
  it("só preenche campos vazios (0/ausentes); nunca sobrescreve o que o usuário digitou", () => {
    const current: BalancoDetalhado = {
      ativoCirculante: { caixaEquivalentes: 500, estoques: 0 },
    };
    const suggested: BalancoDetalhado = {
      ativoCirculante: { caixaEquivalentes: 999, estoques: 300, contasReceberClientes: 100 },
      passivoCirculante: { fornecedores: 50 },
    };
    const out = mergeBalancoPreservandoUsuario(current, suggested);
    expect(out.ativoCirculante).toEqual({
      caixaEquivalentes: 500,
      estoques: 300,
      contasReceberClientes: 100,
    });
    expect(out.passivoCirculante).toEqual({ fornecedores: 50 });
    // Não muta o objeto do usuário
    expect(current.ativoCirculante?.estoques).toBe(0);
  });

  it("sem balanço atual usa a sugestão; null/undefined na sugestão preserva o atual", () => {
    expect(mergeBalancoPreservandoUsuario(undefined, { investimentos: 1 } as never)).toEqual({
      investimentos: 1,
    });
    const out = mergeBalancoPreservandoUsuario({ ativoCirculante: { estoques: 10 } }, {
      ativoCirculante: null,
      passivoCirculante: undefined,
    } as unknown as BalancoDetalhado);
    expect(out.ativoCirculante).toEqual({ estoques: 10 });
  });

  it("campos não numéricos da sugestão (ex.: dataBase) não substituem o atual", () => {
    const out = mergeBalancoPreservandoUsuario(
      { dataBase: "2025-12-31" },
      { dataBase: "2026-12-31" },
    );
    expect(out.dataBase).toBe("2025-12-31");
  });
});

describe("snapshotAnterior — congela N como N-1", () => {
  it("copia profunda do balanço atual (sem o anterior antigo) em `anterior`", () => {
    const comAnterior: BalancoDetalhado = {
      ...BAL,
      anterior: { ativoCirculante: { caixaEquivalentes: 1 } },
    };
    const snap = snapshotAnterior(comAnterior);
    expect(snap.anterior).toEqual(BAL);
    expect((snap.anterior as BalancoDetalhado).anterior).toBeUndefined();
    // Cópia independente: mudar o N não altera o N-1 congelado
    snap.ativoCirculante!.caixaEquivalentes = 0;
    expect(snap.anterior?.ativoCirculante?.caixaEquivalentes).toBe(10_000);
    // E o N-1 congelado fecha como o original
    expect(calcBalancoTotals(snap.anterior as BalancoDetalhado).diferenca).toBe(0);
  });
});
