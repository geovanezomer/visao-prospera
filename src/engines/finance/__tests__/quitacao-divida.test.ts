// Quitação antecipada de dívida (simulador e alavanca): o pagamento reduz o
// saldo UMA vez no balanço de fechamento, e o balanço continua fechando.
import { describe, expect, it } from "vitest";
import { createState } from "./helpers";
import { payDownDebt } from "../levers/primitives";
import { applySimulator, DEFAULT_SIM } from "../simulator";
import { buildFinancialModel } from "../financialModel";
import { deriveAbertura } from "../aberturaDerivada";
import type { AppState } from "../types";

function comContrato(): AppState {
  const s = createState();
  return {
    ...s,
    capital: {
      ...s.capital,
      debtContracts: [
        {
          id: "c1",
          credor: "Banco",
          saldoDevedor: 100_000,
          taxaAA: 18,
          sistema: "price",
          prazoMeses: 36,
        },
      ],
    },
  };
}

function fechamento(s: AppState) {
  const m = buildFinancialModel(s);
  const b = m.balancoFechamento;
  const pc = b.balanco.passivoCirculante;
  const pnc = b.balanco.passivoNaoCirculante;
  return {
    emprestimos: (pc?.emprestimosFinanciamentosCP ?? 0) + (pnc?.emprestimosFinanciamentosLP ?? 0),
    diferenca: b.totals.diferenca,
    abertura: deriveAbertura({ state: s, impostosTotalMensais: m.dre.impostosTotal }),
  };
}

describe("quitação antecipada de 30% da dívida", () => {
  it("alavanca payDownDebt: saldo final = 70% do saldo final sem quitação", () => {
    const base = fechamento(comContrato());
    const r = fechamento(payDownDebt(comContrato(), 0.3));
    // PRICE com o mesmo prazo: o cronograma encolhe na mesma proporção.
    expect(r.emprestimos).toBeCloseTo(base.emprestimos * 0.7, 0);
    // A abertura é a mesma: a dívida existia no início do ano.
    const abertura = (x: typeof base) =>
      x.abertura.emprestimosCP.value + x.abertura.emprestimosLP.value;
    expect(abertura(r)).toBeCloseTo(abertura(base), 6);
    // Ativo cai 30 mil (caixa) e passivo cai 30 mil: a diferença do balanço
    // (abertura não informada no exemplo) fica igual — nada some ou duplica.
    expect(r.diferenca).toBeCloseTo(base.diferenca, 2);
  });

  it("simulador (debtPaydownPct = 30): mesmo resultado", () => {
    const base = fechamento(comContrato());
    const sim = applySimulator(comContrato(), { ...DEFAULT_SIM, debtPaydownPct: 30 });
    const r = fechamento(sim);
    expect(r.emprestimos).toBeCloseTo(base.emprestimos * 0.7, 0);
    expect(r.diferenca).toBeCloseTo(base.diferenca, 2);
  });
});
