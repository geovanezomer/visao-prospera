// Testes do passivo tributário no Balanço de Fechamento.
//
// Após a refatoração de conservação de massa (2026-07-04), a rotina paralela
// `computeImpostosPagarFechamento` deixou de ser chamada por
// `deriveBalancoFechamento`. O passivo tributário agora obedece:
//
//   impostosPagarFim = impostosPagarIni + Σ dre.impostosTotal − Σ cf.pagamentosImpostos
//
// Estes testes validam essa conservação em vários regimes/eras — o efeito
// do lag e do Split Payment é herdado automaticamente via cf.pagamentosImpostos.

import { describe, expect, it } from "vitest";
import { deriveBalancoFechamento } from "../balancoFechamento";
import { buildDRE } from "../dre";
import { buildCashFlow } from "../cashflow";
import { resolveEffectiveRegime } from "../regime";
import { deriveAbertura } from "../aberturaDerivada";
import { createState, m12 } from "./helpers";

const sumArr = (a: number[] | undefined) =>
  (a ?? []).reduce((x, y) => x + (y || 0), 0);

function conservationCheck(state = createState()) {
  const regime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, regime);
  const cf = buildCashFlow(state);
  const res = deriveBalancoFechamento({ state, dre, cf });
  const abertura = deriveAbertura({
    state,
    impostosTotalMensais: dre.impostosTotal,
  });
  const esperado = Math.max(
    0,
    abertura.impostosPagar.value +
      sumArr(dre.impostosTotal) -
      sumArr(cf.pagamentosImpostos),
  );
  return { res, esperado, cf, dre };
}

describe("balancoFechamento — impostosPagar (conservação de massa)", () => {
  it("Simples: passivo respeita ini + competência − pagamentos DFC", () => {
    const state = createState({
      tax: { regime: "simples", era: "atual" },
      revenue: { bruta: m12(50_000) },
    });
    const { res, esperado } = conservationCheck(state);
    expect(res.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(esperado, 0);
  });

  it("Presumido: passivo respeita conservação (inclui IRPJ/CSLL Q4)", () => {
    const state = createState({
      tax: { regime: "presumido", era: "atual" },
      revenue: { bruta: m12(80_000) },
    });
    const { res, esperado } = conservationCheck(state);
    expect(res.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(esperado, 0);
    expect(res.balanco.passivoCirculante!.impostosPagar).toBeGreaterThanOrEqual(0);
  });

  it("Real + Split Payment ativo: CBS/IBS zeram lag → passivo menor que sem Split", () => {
    const stateSplit = createState({
      tax: { regime: "real", era: "pleno", splitPaymentAtivo: true },
      revenue: { bruta: m12(100_000) },
    });
    const stateNoSplit = createState({
      tax: { regime: "real", era: "pleno", splitPaymentAtivo: false },
      revenue: { bruta: m12(100_000) },
    });
    const rSplit = conservationCheck(stateSplit);
    const rNoSplit = conservationCheck(stateNoSplit);
    // Cada um respeita sua própria conservação.
    expect(rSplit.res.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(
      rSplit.esperado,
      0,
    );
    expect(rNoSplit.res.balanco.passivoCirculante!.impostosPagar).toBeCloseTo(
      rNoSplit.esperado,
      0,
    );
    // Split ativo faz CBS/IBS liquidarem no mesmo mês (lag 0), então o
    // passivo tributário de fechamento é MENOR do que sem Split (lag 30).
    expect(rSplit.res.balanco.passivoCirculante!.impostosPagar!).toBeLessThan(
      rNoSplit.res.balanco.passivoCirculante!.impostosPagar!,
    );

  });

  it("Passivo nunca é negativo (guard)", () => {
    for (const regime of ["simples", "presumido", "real"] as const) {
      const st = createState({
        tax: { regime, era: "atual" },
        revenue: { bruta: m12(30_000) },
      });
      const { res } = conservationCheck(st);
      expect(res.balanco.passivoCirculante!.impostosPagar).toBeGreaterThanOrEqual(0);
    }
  });

  it("Conservação de massa preservada — |Δresíduo| ≈ 0 em todos os regimes", () => {
    const cases = [
      createState({ tax: { regime: "simples", era: "atual" } }),
      createState({ tax: { regime: "presumido", era: "atual" } }),
      createState({ tax: { regime: "real", era: "pleno", splitPaymentAtivo: true } }),
      createState({ tax: { regime: "real", era: "pleno", splitPaymentAtivo: false } }),
    ];
    for (const st of cases) {
      const regime = resolveEffectiveRegime(st);
      const { dre } = buildDRE(st, regime);
      const cf = buildCashFlow(st);
      const res = deriveBalancoFechamento({ state: st, dre, cf });
      const abertura = deriveAbertura({
        state: st,
        impostosTotalMensais: dre.impostosTotal,
      });
      // Conservação: fechamento herda o gap da abertura SEM amplificar.
      const delta = Math.abs(res.totals.diferenca - abertura.totals.diferenca);
      const tol = Math.max(1, res.totals.ativo * 0.001);
      expect(delta).toBeLessThanOrEqual(tol);
    }
  });

});
