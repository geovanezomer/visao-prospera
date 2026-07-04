// Testes de IDENTIDADE do Balanço de Fechamento — pós-refatoração para
// conservação de massa. Cada teste valida Ativo ≡ Passivo + PL sob cenários
// distintos (PMR, sazonalidade, contratos de dívida, CAPEX, aportes,
// dividendos, regimes, Split Payment).
//
// Tolerância padrão: aceita pequenos ruídos de aproximação da provisão de
// folha (folha/12) — quando a folha é uniforme, deve fechar em centavos.

import { describe, expect, it } from "vitest";
import { deriveBalancoFechamento } from "../balancoFechamento";
import { buildDRE } from "../dre";
import { buildCashFlow, buildRecebivelMensal } from "../cashflow";
import { resolveEffectiveRegime } from "../regime";
import { createState, m12 } from "./helpers";

const sumArr = (a: number[] | undefined) =>
  (a ?? []).reduce((x, y) => x + (y || 0), 0);

/** Executa a pipeline completa e retorna balanço + totais. */
function run(state = createState()) {
  const regime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, regime);
  const cf = buildCashFlow(state);
  const res = deriveBalancoFechamento({ state, dre, cf });
  return { res, dre, cf };
}

/** Tolerância: 0.5% do ativo OU R$ 100 (o maior). Absorve provisão de folha. */
function assertFechado(diferenca: number, ativo: number) {
  const tol = Math.max(100, ativo * 0.005);
  expect(Math.abs(diferenca)).toBeLessThanOrEqual(tol);
}

describe("Balanço de Fechamento — identidade contábil por conservação de massa", () => {
  it("(a) empresa uniforme, sem PMR/PMP — fecha com diferença desprezível", () => {
    const st = createState({
      revenue: { bruta: m12(50_000), pmr: 0, pmp: 0 },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(b) receita sazonal com PMR 45 — fecha (CR_fim ≠ ini, sem inflar)", () => {
    const bruta = [80_000, 40_000, 60_000, 100_000, 30_000, 70_000, 90_000, 55_000, 65_000, 45_000, 85_000, 75_000];
    const st = createState({ revenue: { bruta, pmr: 45, pmp: 30 } });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(c) contratos de dívida com amortização → passivo cai junto do caixa", () => {
    const st = createState({
      revenue: { bruta: m12(60_000) },
      cashflow: {
        emprestimosCaptados: m12(0),
        amortizacoes: [
          10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
          10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
        ],
      },
      capital: {
        balanco: {
          passivoNaoCirculante: { emprestimosFinanciamentosLP: 240_000 },
          patrimonioLiquido: { capitalSocial: 100_000 },
        },
      },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(d) CAPEX ativado no meio do ano — imobilizado sobe, caixa cai", () => {
    const st = createState({
      revenue: { bruta: m12(70_000) },
      capital: {
        capexAtivacao: [
          { id: "c1", label: "Máquina", valor: 120_000, mes: 6, vidaUtilMeses: 60 },
        ],
      },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(e) aporte de capital — capital social sobe, caixa sobe", () => {
    const aportes = m12(0);
    aportes[2] = 200_000;
    const st = createState({
      revenue: { bruta: m12(50_000) },
      cashflow: { aportes },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(f) dividendos pagos — PL cai (resultadoExercicio líquido), caixa cai", () => {
    const dividendos = m12(0);
    dividendos[11] = 30_000;
    const st = createState({
      revenue: { bruta: m12(60_000) },
      cashflow: { dividendos },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(g) regime Simples fecha", () => {
    const st = createState({
      tax: { regime: "simples", era: "atual" },
      revenue: { bruta: m12(40_000) },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(g) regime Presumido fecha", () => {
    const st = createState({
      tax: { regime: "presumido", era: "atual" },
      revenue: { bruta: m12(80_000) },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(g) regime Real fecha", () => {
    const st = createState({
      tax: { regime: "real", era: "atual" },
      revenue: { bruta: m12(150_000) },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(h) era plena com Split Payment ativo — fecha (CBS/IBS lag 0)", () => {
    const st = createState({
      tax: { regime: "real", era: "pleno", splitPaymentAtivo: true },
      revenue: { bruta: m12(120_000) },
    });
    const { res } = run(st);
    assertFechado(res.totals.diferenca, res.totals.ativo);
  });

  it("(i) consistência: ΔCR = Recebível − Recebimentos DFC", () => {
    const st = createState({
      revenue: { bruta: m12(80_000), pmr: 60 },
    });
    const { res, dre, cf } = run(st);
    const recebivel = sumArr(buildRecebivelMensal(st, dre));
    const recebimentos = sumArr(cf.recebimentos);
    // CR_fim vem de CR_ini + recebivel − recebimentos (clamp em 0). Como o
    // kick da DFC já liquida CR_ini, o resultado deve bater com essa fórmula.
    // Aqui a abertura pode ter CR_ini > 0 (via balanco.ativoCirculante),
    // então validamos a fórmula geral usando o próprio CR do balanço.
    const cr = res.balanco.ativoCirculante!.contasReceberClientes!;
    // Recebido no ano = recebível − CR_fim + CR_ini
    const crIni = 0; // createState default não define abertura
    expect(recebimentos).toBeCloseTo(recebivel - cr + crIni, 0);
  });

  it("(j) à vista (PMR 0) — CR_fim = 0", () => {
    const st = createState({
      revenue: { bruta: m12(50_000), pmr: 0 },
    });
    const { res } = run(st);
    expect(res.balanco.ativoCirculante!.contasReceberClientes!).toBeCloseTo(0, 0);
  });
});
