/**
 * Validação end-to-end de Mútuos Passivos (PF→PJ).
 *
 * Garante que UM contrato cadastrado em "Retiradas e Aportes" propaga
 * corretamente para todas as abas conectadas:
 *
 *   1. Engine puro:    aggregateMutuosPassivos
 *   2. Fluxo de Caixa: captação entra em Financiamento (+), amortização sai (−)
 *   3. DRE:            juros pagos vão para Resultado Financeiro (despesa)
 *   4. Balanço:        saldo devedor compõe Passivo Não Circulante
 *   5. Capital ↔ Aportes ↔ Fluxo: sem dupla contagem com debt contracts
 */
import { describe, it, expect } from "vitest";
import { createState } from "./helpers";
import {
  aggregateMutuosPassivos,
  SELIC_MENSAL_REFERENCIA_PASSIVO,
} from "../mutuosPassivos";
import { buildDRE } from "../dre";
import { buildCashFlow } from "../cashflow";
import { suggestBalancoFromState, calcPassivoNaoCirculante } from "../balanco";
import type { MutuoPassivo, CostLine } from "../types";

/** Cria um state com 1 mútuo passivo + a linha sintética que o card injeta. */
function stateComMutuo(mutuo: MutuoPassivo) {
  const agg = aggregateMutuosPassivos([mutuo]);
  const linhaJuros: CostLine = {
    id: "__mutuos_passivos_juros__",
    label: "Juros sobre mútuos passivos (sócios)",
    category: "financeiro",
    values: agg.juros.slice() as CostLine["values"],
    fixed: true,
    custom: false,
  };
  return createState({
    mutuosPassivos: [mutuo],
    costs: [linhaJuros],
    cashflow: {
      mutuosPassivosCaptados: agg.captacao,
      mutuosPassivosAmortizados: agg.amortizacao,
    },
  });
}

describe("Mútuos Passivos (PF→PJ) — integração entre abas", () => {
  const MUTUO: MutuoPassivo = {
    id: "mp-test",
    nome: "Sócio A",
    valorCaptado: 120_000,
    mesCaptacao: 1,
    taxaMensalPct: SELIC_MENSAL_REFERENCIA_PASSIVO, // 0.9%/mês
    prazoMeses: 24, // metade das parcelas cai fora do horizonte
    mesInicioDevolucao: 2,
  };

  it("1. Engine: captação, juros e saldo devedor batem matematicamente", () => {
    const agg = aggregateMutuosPassivos([MUTUO]);
    // Captação: tudo no mês 1
    expect(agg.captacao[0]).toBeCloseTo(120_000, 2);
    expect(agg.totalCaptado).toBeCloseTo(120_000, 2);
    // Juros > 0 (taxa > 0)
    expect(agg.totalJurosAno).toBeGreaterThan(0);
    // Saldo devedor remanescente > 0 (prazo 24m > horizonte 12m)
    const amortDentroHorizonte = agg.amortizacao.reduce((a, b) => a + b, 0);
    const saldoEsperado = 120_000 - amortDentroHorizonte;
    expect(saldoEsperado).toBeGreaterThan(0);
    // Juros do mês 2 = saldo antes × taxa
    expect(agg.juros[1]).toBeCloseTo(120_000 * 0.009, 2);
  });

  it("2. Fluxo de Caixa: Financiamento reflete captação (+) e amortização (−)", () => {
    const s = stateComMutuo(MUTUO);
    const cf = buildCashFlow(s, s.tax.regime);
    const agg = aggregateMutuosPassivos([MUTUO]);

    // SSOT: o cashflow do state expõe os arrays sincronizados pelo card.
    expect(s.cashflow.mutuosPassivosCaptados).toEqual(agg.captacao);
    expect(s.cashflow.mutuosPassivosAmortizados).toEqual(agg.amortizacao);

    // Variação líquida anual de financiamento incorpora (+captação − amortização).
    const deltaEsperado =
      agg.captacao.reduce((a, b) => a + b, 0) -
      agg.amortizacao.reduce((a, b) => a + b, 0);
    expect(cf.totais.fluxoFinanciamento).toBeGreaterThanOrEqual(deltaEsperado - 1);

    // Mês da captação: fluxo de financiamento contém o ingresso de 120k.
    expect(cf.fluxoFinanciamento[0]).toBeGreaterThanOrEqual(agg.captacao[0] - 1);
  });

  it("3. DRE: juros pagos entram em Resultado Financeiro como DESPESA", () => {
    const sBase = createState();
    const sCom = stateComMutuo(MUTUO);
    const baseDre = buildDRE(sBase, sBase.tax.regime).dre;
    const comDre = buildDRE(sCom, sCom.tax.regime).dre;
    const agg = aggregateMutuosPassivos([MUTUO]);

    // Delta de custos financeiros = exatamente os juros do mútuo (isolamento).
    for (let i = 0; i < 12; i++) {
      const delta = comDre.custosFinanceirosTotal[i] - baseDre.custosFinanceirosTotal[i];
      expect(delta).toBeCloseTo(agg.juros[i], 2);
    }
    // Resultado Financeiro CAI exatamente o total de juros pagos.
    const deltaResFin =
      comDre.resultadoFinanceiro.reduce((a, b) => a + b, 0) -
      baseDre.resultadoFinanceiro.reduce((a, b) => a + b, 0);
    expect(deltaResFin).toBeCloseTo(-agg.totalJurosAno, 1);
  });

  it("4. Balanço: saldo devedor compõe Passivo Não Circulante", () => {
    const s = stateComMutuo(MUTUO);
    const { dre } = buildDRE(s, s.tax.regime);
    const lucroLiquidoAnual = dre.lucroLiquido.reduce((a, b) => a + b, 0);
    const impostosLucroAnual = dre.impostos.reduce((a, b) => a + b, 0);

    const balanco = suggestBalancoFromState(s, {
      dreLucroLiquido: lucroLiquidoAnual,
      dreImpostosLucroAnual: impostosLucroAnual,
    });

    const agg = aggregateMutuosPassivos([MUTUO]);
    const saldoEsperado = 120_000 - agg.amortizacao.reduce((a, b) => a + b, 0);

    expect(balanco.passivoNaoCirculante?.outrasObrigacoesLP).toBeCloseTo(
      saldoEsperado,
      1,
    );
    // PNC total considera a obrigação
    expect(calcPassivoNaoCirculante(balanco)).toBeGreaterThanOrEqual(saldoEsperado);
  });

  it("5. Sem mútuos: não há contribuição ao Passivo de mútuos no Balanço", () => {
    const s = createState();
    const bal = suggestBalancoFromState(s, { dreLucroLiquido: 0 });
    expect(bal.passivoNaoCirculante?.outrasObrigacoesLP ?? 0).toBe(0);
  });

  it("6. Conservação: Σ juros pagos (DRE) + Σ amortização (Fluxo) ≤ PV·(1+i)^n", () => {
    const agg = aggregateMutuosPassivos([MUTUO]);
    const pagoNoHorizonte =
      agg.amortizacao.reduce((a, b) => a + b, 0) +
      agg.juros.reduce((a, b) => a + b, 0);
    const limiteTeto = 120_000 * Math.pow(1 + 0.009, 24);
    expect(pagoNoHorizonte).toBeLessThan(limiteTeto);
    expect(pagoNoHorizonte).toBeGreaterThan(0);
  });
});
