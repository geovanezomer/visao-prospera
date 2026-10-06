/**
 * Lucro Presumido — Lei 9.430/96 art. 25, II: aluguéis e ganho de capital
 * entram integrais na base de IRPJ/CSLL.
 */
import { describe, expect, it } from "vitest";
import { calcPresumido } from "../tax/presumido";
import { createState, m12 } from "./helpers";
import type { AppState } from "../types";

function comAluguel(base: AppState, mensal: number): AppState {
  return {
    ...base,
    revenue: {
      ...base.revenue,
      receitasFinanceiras: [
        { id: "alugueis", label: "Aluguéis Recebidos", valores: m12(mensal), tipo: "operacional" },
      ],
    },
  };
}

describe("calcPresumido — demais receitas", () => {
  // Serviços R$ 30 mil/mês: base presumida 32% = 9,6 mil; + 10 mil de aluguel
  // = 19,6 mil/mês (abaixo do limite do adicional de R$ 20 mil/mês).
  const base = createState({
    tax: { regime: "presumido" },
    businessType: "servicos",
    revenue: { bruta: m12(30_000) },
  });

  it("R$ 10 mil/mês de aluguel somam R$ 2.400/mês de IRPJ (15%) + CSLL (9%)", () => {
    const sem = calcPresumido(comAluguel(base, 0));
    const com = calcPresumido(comAluguel(base, 10_000));
    expect(com.annualLucro - sem.annualLucro).toBeCloseTo(2_400 * 12, 0);
  });
});
