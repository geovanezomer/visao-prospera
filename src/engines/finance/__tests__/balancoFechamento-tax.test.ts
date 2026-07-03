// Testes do passivo tributário no Balanço de Fechamento.
// Garante que `impostosPagar` no fechamento respeita regime (Simples/Presumido/Real)
// e Split Payment CBS/IBS — alinhado ao `computeImpostos` do cashflow.ts.

import { describe, expect, it } from "vitest";
import { deriveBalancoFechamento } from "../balancoFechamento";
import { buildDRE } from "../dre";
import { buildCashFlow } from "../cashflow";
import { resolveEffectiveRegime } from "../regime";
import { createState, m12 } from "./helpers";
import type { MonthlyTax } from "../tax/shared";

const ZERO12 = () => m12(0);

/** Constrói opts padronizados para deriveBalancoFechamento. */
function run(state = createState()) {
  const regime = resolveEffectiveRegime(state);
  const { dre, tax } = buildDRE(state, regime);
  const cf = buildCashFlow(state);
  const res = deriveBalancoFechamento({ state, dre, cf, tax });
  return { res, tax };
}

/** MonthlyTax sintético para testar a função de passivo isoladamente. */
function synthTax(over: Partial<MonthlyTax> = {}): MonthlyTax {
  return {
    monthly: ZERO12(),
    monthlyVendas: ZERO12(),
    monthlyLucro: ZERO12(),
    monthlyCbsIbs: ZERO12(),
    annual: 0,
    annualVendas: 0,
    annualLucro: 0,
    effective: 0,
    detail: {},
    ...over,
  };
}

describe("balancoFechamento — impostosPagar (regime + Split Payment)", () => {
  it("Simples: passivo ≈ DAS de dezembro (1 mês, sem IRPJ/CSLL separado)", () => {
    const state = createState({
      tax: { regime: "simples", era: "atual" },
      revenue: { bruta: m12(50_000) },
    });
    const { res, tax } = run(state);
    const dezVendas = tax.monthlyVendas[11] ?? 0;
    // Regime efetivo pode ser presumido se estourar; garantir que testamos Simples.
    if (resolveEffectiveRegime(state) === "simples") {
      expect(res.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(dezVendas, 0);
    }
  });

  it("Presumido: passivo = vendas(dez) + IRPJ/CSLL(out+nov+dez)", () => {
    const state = createState({
      tax: { regime: "presumido", era: "atual" },
      revenue: { bruta: m12(80_000) },
    });
    const { res, tax } = run(state);
    const esperado =
      (tax.monthlyVendas[11] ?? 0) +
      (tax.monthlyLucro[9] ?? 0) +
      (tax.monthlyLucro[10] ?? 0) +
      (tax.monthlyLucro[11] ?? 0);
    expect(res.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(esperado, 0);
    // No Presumido, quase sempre há IRPJ/CSLL trimestral quando lucro > 0.
    if ((tax.annualLucro ?? 0) > 0) {
      expect(res.balanco.passivoCirculante!.impostosPagar).toBeGreaterThan(tax.monthlyVendas[11] ?? 0);
    }
  });

  it("Era pleno + Split Payment ATIVO: CBS/IBS de dez saem do passivo", () => {
    const tax = synthTax({
      monthlyVendas: [...Array(11).fill(0), 10_000],
      monthlyCbsIbs: [...Array(11).fill(0), 6_000], // parte do monthlyVendas
      monthlyLucro: ZERO12(),
    });
    const stateSplit = createState({
      tax: { regime: "real", era: "pleno", splitPaymentAtivo: true },
    });
    const stateNoSplit = createState({
      tax: { regime: "real", era: "pleno", splitPaymentAtivo: false },
    });
    // Reaproveita a função pública via um dre/cf mockados minimamente.
    // Aqui usamos a rota completa: instanciamos deriveBalancoFechamento
    // passando tax sintético e um dre/cf reais só para preencher o balanço.
    const regime = resolveEffectiveRegime(stateSplit);
    const dre = buildDRE(stateSplit, regime).dre;
    const cf = buildCashFlow(stateSplit);
    const rSplit = deriveBalancoFechamento({ state: stateSplit, dre, cf, tax });
    const rNoSplit = deriveBalancoFechamento({ state: stateNoSplit, dre, cf, tax });
    // Split ativo → passivoVendas = 10k - 6k = 4k (sem lucro no synthTax).
    expect(rSplit.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(4_000, 0);
    // Sem Split → passivoVendas = 10k (CBS/IBS entram no lag 30).
    expect(rNoSplit.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(10_000, 0);
  });

  it("Identidade contábil: nova lógica não piora o gap vs fallback legado (impostosAnual/12)", () => {
    const cases = [
      createState({ tax: { regime: "simples", era: "atual" } }),
      createState({ tax: { regime: "presumido", era: "atual" } }),
      createState({ tax: { regime: "real", era: "pleno", splitPaymentAtivo: true } }),
      createState({ tax: { regime: "real", era: "pleno", splitPaymentAtivo: false } }),
    ];
    for (const st of cases) {
      const regime = resolveEffectiveRegime(st);
      const { dre, tax } = buildDRE(st, regime);
      const cf = buildCashFlow(st);
      // Novo caminho (com tax) vs fallback legado (sem tax).
      const novo = deriveBalancoFechamento({ state: st, dre, cf, tax });
      const legado = deriveBalancoFechamento({ state: st, dre, cf });
      // O gap absoluto do balanço não deve piorar significativamente
      // (tolerância = maior entre 100 e 5% do ativo — mesma escala de `fechado`).
      const tol = Math.max(100, novo.totals.ativo * 0.05);
      expect(Math.abs(novo.totals.diferenca) - Math.abs(legado.totals.diferenca))
        .toBeLessThanOrEqual(tol);
    }
  });
});
