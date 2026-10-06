// =====================================================================
// Escopo da folha por finalidade legal:
//   - Fator R (LC 123 art. 18 §24): remuneração a pessoa física + encargos.
//   - Pessoal (Folha/Receita): escopo amplo.
//   - Crédito CBS/IBS (LC 214/2025): serviço tomado de PJ gera crédito.
// =====================================================================
import { describe, expect, it } from "vitest";
import { folhaAnual, folhaFatorR, resolveSimplesAnexo } from "@/engines/finance/regime";
import { isCreditoAmploCbsIbs, isLaborLine } from "@/engines/finance/costs";
import type { AppState, CostLine } from "@/engines/finance/types";

function line(label: string, monthly = 10_000): CostLine {
  return {
    id: label,
    label,
    category: "despesa_administrativa",
    values: Array(12).fill(monthly),
    encargosAuto: false,
  } as unknown as CostLine;
}

function state(costs: CostLine[], fatorRAuto = true): AppState {
  return {
    company: { name: "Test", segment: "servicos" },
    revenue: { bruta: Array(12).fill(100_000), recebimentos: Array(12).fill(100_000) },
    costs,
    capital: [],
    tax: { regime: "simples", simplesAnexo: "V", fatorRAuto },
    socios: { lista: [], distribuicoes: [] },
    mutuos: [],
  } as unknown as AppState;
}

describe("pró-labore", () => {
  it('"Pró-labore sócios" é folha (antes saía pela regra de distribuição a sócio)', () => {
    expect(isLaborLine(line("Pró-labore sócios"))).toBe(true);
    expect(folhaFatorR(state([line("Pró-labore sócios")]))).toBe(120_000);
  });

  it("pró-labore não gera crédito de CBS/IBS", () => {
    expect(isCreditoAmploCbsIbs(line("Pró-labore sócios"))).toBe(false);
  });

  it("distribuição de lucros a sócios continua fora", () => {
    expect(isLaborLine(line("Distribuição de lucros sócios"))).toBe(false);
  });
});

describe("Fator R", () => {
  it("terceirização via PJ e benefícios ficam fora do Fator R, mas dentro de Pessoal", () => {
    const s = state([
      line("Salários", 10_000),
      line("Mão de obra terceirizada", 10_000),
      line("Benefícios (VR/VT)", 5_000),
    ]);
    expect(folhaFatorR(s)).toBe(120_000);
    expect(folhaAnual(s)).toBe(300_000);
  });

  it("terceirização não migra mais a empresa do Anexo V para o III", () => {
    // RBT12 1,2M: salários 240k (20%) + terceirizado 120k → com a regra antiga 30% ≥ 28%.
    const s = state([line("Salários", 20_000), line("Serviços terceirizados", 10_000)]);
    expect(folhaFatorR(s) / 1_200_000).toBeCloseTo(0.2, 5);
    expect(resolveSimplesAnexo(s)).toBe("V");
  });
});

describe("crédito CBS/IBS", () => {
  it("terceirização via PJ gera crédito; salários não", () => {
    expect(isCreditoAmploCbsIbs(line("Mão de obra terceirizada"))).toBe(true);
    expect(isCreditoAmploCbsIbs(line("Salários"))).toBe(false);
  });
});
