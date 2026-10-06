/**
 * Memória de cálculo × card — consistência aritmética (SSOT).
 *
 * Para cada indicador cuja memória tem a forma "<fórmula numérica>\n= <resultado>":
 *  1. os números mostrados na fórmula, recalculados, dão o resultado exibido
 *     (dentro do arredondamento de exibição);
 *  2. o resultado exibido é EXATAMENTE o valor formatado do card (`indicators.ts`).
 *
 * Bug histórico: ROE/ROA/Liquidez Geral/Giro/WACC usavam `capital.patrimonioLiquido`
 * e `capital.ativoTotal` crus enquanto o card usava o balanço reconciliado; PE total e
 * Lucro Líquido mostravam juros de contratos enquanto o resultado usava os custos
 * financeiros da DRE; o gap de capital de giro mostrava AC − PC em vez de PL + PNC − ANC.
 */
import { describe, it, expect } from "vitest";
import { buildIndicatorCalcs, type IndicatorCalcs } from "../indicatorCalc";
import { buildDRE } from "../dre";
import { calcIndicators, type Indicators } from "../indicators";
import { resolveEffectiveRegime } from "../regime";
import { fmtBRL, fmtPct, fmtRatio, fmtNum, fmtAnos, fmtDays } from "../format";
import type { AppState } from "../types";
import { createState, m12 } from "./helpers";

const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d+)?`;
const TOKEN = new RegExp(String.raw`(-?R\$\s*-?${NUM})|(-?${NUM}%)|(-?${NUM})`, "g");

/** "R$ 1.234,56" / "12,5%" / "1,25" → número JS (percentual vira fração). */
function ptNumber(raw: string): number {
  const neg = raw.trim().startsWith("-") || /R\$\s*-/.test(raw);
  const digits = raw.replace(/[^\d,]/g, "").replace(",", ".");
  const v = Number(digits) * (neg ? -1 : 1);
  return raw.includes("%") ? v / 100 : v;
}

/** Converte a expressão exibida em JS e avalia. Devolve null se houver texto não numérico. */
function evalFormula(expr: string): number | null {
  const js = expr
    .replace(/ dias| anos| colaborador\(es\)/g, "")
    .replace(TOKEN, (m) => `(${ptNumber(m)})`)
    .replace(/÷/g, "/")
    .replace(/×/g, "*")
    .replace(/−/g, "-");
  if (!/^[\d\s.()+\-*/e]+$/.test(js)) return null;
  return Function(`"use strict"; return (${js});`)() as number;
}

/** Quebra a memória em { fórmula numérica, resultado exibido }. */
function parseMemoria(memo: string) {
  const [lhsLine, rhsLine] = memo.split("\n= ");
  // Anotações vêm após dois espaços; rótulos simbólicos vêm antes do último " = ".
  const formula = lhsLine.split("  ")[0].split(" = ").pop() as string;
  const result = rhsLine.split("  ")[0];
  return { formula, result };
}

/** Valor esperado no card, formatado como a memória exibe o resultado. */
function cardValues(ind: Indicators): Partial<Record<keyof IndicatorCalcs, string>> {
  const pct = (v: number) => fmtPct(v / 100);
  const x = (v: number | null) => `${fmtRatio(v ?? NaN)}×`;
  return {
    margemBruta: pct(ind.margemBruta),
    margemEbitda: pct(ind.margemEbitda),
    margemLiquida: pct(ind.margemLiquida),
    margemContribuicao: pct(ind.margemContribuicao),
    eva: fmtBRL(ind.eva),
    pontoEquilibrioOperacional: fmtBRL(ind.pontoEquilibrioOperacional),
    pontoEquilibrioFinanceiro: fmtBRL(ind.pontoEquilibrioFinanceiro),
    pontoEquilibrioTotal: fmtBRL(ind.pontoEquilibrio),
    roe: pct(ind.roe ?? NaN),
    roa: pct(ind.roa),
    roic: pct(ind.roic),
    wacc: `${fmtNum(ind.wacc, 1)}%`,
    liquidezCorrente: fmtRatio(ind.liquidezCorrente),
    liquidezSeca: fmtRatio(ind.liquidezSeca),
    liquidezImediata: fmtRatio(ind.liquidezImediata),
    liquidezGeral: fmtRatio(ind.liquidezGeral),
    endividamentoGeral: pct(ind.endividamentoGeral),
    capitalProprio: pct(ind.proprioPercent),
    coberturaJuros: x(ind.coberturaJuros),
    giroAtivo: x(ind.giroAtivo),
    dividaLiqEbitda: x(ind.dividaLiqEbitda),
    dividaLiqEbit: x(ind.dividaLiqEbit),
    dividaLiqPl: x(ind.dividaLiqPl),
    amortizacaoPlPorLucro: fmtAnos(ind.amortizacaoPlPorLucro),
    paybackCapex: fmtAnos(ind.paybackCapex),
    fcf: fmtBRL(ind.fcf),
    gao: x(ind.gao),
    gaf: x(ind.gaf),
    qualidadeLucro: x(ind.qualidadeLucro),
    conversaoEbitdaCaixa: pct(ind.conversaoEbitdaCaixa),
    cicloFinanceiro: fmtDays(ind.cicloFinanceiro, 1),
    ncg: fmtBRL(ind.ncg),
    gapCapitalGiro: fmtBRL(ind.gapCapitalGiro),
    faturamentoPorColaborador: fmtBRL(ind.faturamentoPorColaborador),
    receitaPorColaborador: fmtBRL(ind.receitaPorColaborador),
    ebitdaPorColaborador: fmtBRL(ind.ebitdaPorColaborador),
    lucroPorColaborador: fmtBRL(ind.lucroPorColaborador),
    folhaSobreReceita: `${fmtNum(ind.custoPessoalSobreReceita, 1)}%`,
    margemSeguranca: `${fmtNum(ind.margemSeguranca, 1)}%`,
    dscr: x(ind.dscr),
    impostosSobreReceita: `${fmtNum(ind.impostosSobreReceita, 1)}%`,
    impostosSobreLucro: `${fmtNum(ind.impostosSobreLucro, 1)}%`,
    receitaLiquida12m: fmtBRL(ind.receitaLiquidaAnual),
    ebitda12m: fmtBRL(ind.ebitdaAnual),
    lucroLiquido12m: fmtBRL(ind.lucroLiquidoAnual),
    cagrReceitas12m: fmtPct(CAGR),
  };
}

/** Memórias sem fórmula 100% numérica (texto descritivo) — só checa o resultado. */
const CAGR = 0.1;

const SO_RESULTADO = new Set<keyof IndicatorCalcs>(["cagrReceitas12m"]);

const contrato = (id: string, saldo: number, taxa: number) => ({
  id,
  credor: "Banco",
  saldoDevedor: saldo,
  taxaAA: taxa,
  sistema: "price" as const,
  prazoMeses: 36,
});

const ESTADOS: Record<string, () => AppState> = {
  "default createState()": () => createState(),
  // Caso do tester: PL 300k, AT 600k, receita 80k/mês, dívida 120k.
  "PL/AT informados + contrato de dívida": () =>
    createState({
      revenue: { bruta: m12(80_000), inadimplencia: m12(0) },
      capital: {
        patrimonioLiquido: 300_000,
        ativoTotal: 600_000,
        ke: 15,
        kd: 14,
        disponibilidades: 50_000,
        depreciacaoMensal: 1_000,
        debtContracts: [contrato("d1", 120_000, 14)],
      },
      cashflow: { amortizacoes: m12(3_000) },
    }),
  "balanço detalhado + dois contratos + abertura": () =>
    createState({
      revenue: { bruta: m12(150_000) },
      numColaboradores: 12,
      capital: {
        patrimonioLiquido: 250_000,
        patrimonioLiquidoAbertura: 200_000,
        ativoTotal: 700_000,
        ativoTotalAbertura: 550_000,
        ke: 16,
        kd: 18,
        disponibilidades: 80_000,
        estoques: 60_000,
        depreciacaoMensal: 2_500,
        debtContracts: [contrato("d1", 200_000, 18), contrato("d2", 90_000, 24)],
        balanco: {
          passivoCirculante: {
            fornecedores: 45_000,
            impostosPagar: 18_000,
            salariosEncargos: 22_000,
          },
        },
      },
      cashflow: { amortizacoes: m12(6_000) },
    }),
};

function pipeline(s: AppState) {
  const { dre } = buildDRE(s, resolveEffectiveRegime(s));
  const ind = calcIndicators(s, dre);
  return { dre, ind, calcs: buildIndicatorCalcs(s, dre, ind, CAGR) };
}

/** Tolerância: meia unidade da última casa exibida no resultado + 0,5% (bases arredondadas). */
function tolerancia(result: string, valor: number): number {
  const dec = /,(\d+)/.exec(result.replace(/[^\d,]/g, ""))?.[1]?.length ?? 0;
  const unidade = result.includes("%") ? 10 ** -dec / 100 : 10 ** -dec;
  return unidade / 2 + Math.abs(valor) * 0.005 + 1e-9;
}

describe.each(Object.entries(ESTADOS))("memória × card — %s", (_nome, mk) => {
  const { ind, calcs } = pipeline(mk());
  const esperado = cardValues(ind);
  const chaves = (Object.keys(calcs) as (keyof IndicatorCalcs)[]).filter((k) =>
    calcs[k].includes("\n= "),
  );

  it("há memórias suficientes no formato '... = resultado'", () => {
    expect(chaves.length).toBeGreaterThan(20);
  });

  it.each(chaves)("%s: resultado exibido = valor do card", (k) => {
    const { result } = parseMemoria(calcs[k]);
    expect(esperado[k], `sem valor de card mapeado para ${k}`).toBeDefined();
    expect(result).toBe(esperado[k]);
  });

  it.each(chaves.filter((k) => !SO_RESULTADO.has(k)))(
    "%s: números da fórmula recompõem o resultado",
    (k) => {
      const memo = calcs[k];
      const { formula, result } = parseMemoria(memo);
      if (/limitado a/.test(memo)) return; // card com teto (cap): fórmula bruta > teto
      const calc = evalFormula(formula);
      expect(calc, `fórmula não numérica: ${formula}`).not.toBeNull();
      const alvo = ptNumber(result.replace(/×$/, "").replace(/ (dias|anos)$/, ""));
      // "... × 100" com resultado em % → fórmula está em pontos percentuais.
      const emPp = /× 100$/.test(formula.trim()) && result.includes("%");
      const obtido = (calc as number) / (emPp ? 100 : 1);
      expect(Math.abs(obtido - alvo), `${memo}\n→ ${obtido}`).toBeLessThanOrEqual(
        tolerancia(result, alvo),
      );
    },
  );
});

describe("memória × card — regressões do relatório do tester", () => {
  const { ind, calcs } = pipeline(ESTADOS["PL/AT informados + contrato de dívida"]());

  it("ROE e Liquidez Geral usam o PL/AT do balanço reconciliado (não os campos crus)", () => {
    expect(parseMemoria(calcs.roe).result).toBe(fmtPct((ind.roe ?? NaN) / 100));
    expect(calcs.roe).toContain(fmtBRL(ind.bases.plMedio));
    expect(parseMemoria(calcs.liquidezGeral).result).toBe(fmtRatio(ind.liquidezGeral));
    expect(calcs.liquidezGeral).toContain(fmtBRL(ind.bases.ativoTotal));
  });

  it("PE total e Lucro Líquido mostram os custos financeiros da DRE", () => {
    expect(calcs.pontoEquilibrioTotal).toContain(fmtBRL(ind.bases.custosFinanceirosAnual));
    expect(calcs.lucroLiquido12m).toContain(fmtBRL(ind.bases.custosFinanceirosAnual));
  });

  it("gap de capital de giro: NCG − (PL + PNC − ANC)", () => {
    expect(calcs.gapCapitalGiro).toContain(`− ${fmtBRL(ind.bases.cdg)}`);
    expect(ind.ncg - ind.bases.cdg).toBeCloseTo(ind.gapCapitalGiro, 6);
  });
});
