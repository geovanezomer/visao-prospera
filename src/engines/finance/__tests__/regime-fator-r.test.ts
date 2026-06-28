// =====================================================================
// Testes do regex de Fator R / Folha (regime.ts)
// Foca na ambiguidade de "participação nos lucros":
//   - PLR de empregado CLT → ENTRA.
//   - Distribuição/PL a sócio → NÃO entra (é remuneração de capital).
// =====================================================================
import { describe, it, expect } from "vitest";
import { folhaAnual } from "@/engines/finance/regime";
import type { AppState, CostLine } from "@/engines/finance/types";

function baseState(costs: CostLine[]): AppState {
  // Estrutura mínima para o teste. `folhaAnual` só lê tax e costs.
  return {
    company: { name: "Test", segment: "servicos" },
    revenue: { bruta: Array(12).fill(100_000), recebimentos: Array(12).fill(100_000) },
    costs,
    capital: [],
    tax: { regime: "simples", simplesAnexo: "III", fatorRAuto: false },
    socios: { lista: [], distribuicoes: [] },
    mutuos: [],
  } as unknown as AppState;
}

function line(label: string, monthly = 10_000): CostLine {
  return {
    id: label,
    label,
    category: "administrativa",
    values: Array(12).fill(monthly),
    fixed: true,
    encargosAuto: false,
  } as unknown as CostLine;
}

describe("folhaAnual — Fator R / ambiguidade de PLR", () => {
  it("inclui PLR de funcionários", () => {
    const s = baseState([line("PLR funcionários", 5_000)]);
    expect(folhaAnual(s)).toBeGreaterThan(0);
  });

  it("EXCLUI participação nos lucros de diretoria sócia", () => {
    const s = baseState([line("Participação nos lucros — diretoria sócia", 5_000)]);
    expect(folhaAnual(s)).toBe(0);
  });

  it("EXCLUI distribuição de lucros a sócio", () => {
    const s = baseState([line("Distribuição de lucros sócio", 5_000)]);
    expect(folhaAnual(s)).toBe(0);
  });

  it("EXCLUI dividendos pagos a acionistas", () => {
    const s = baseState([line("Dividendos acionistas", 5_000)]);
    expect(folhaAnual(s)).toBe(0);
  });

  it("inclui salários CLT normalmente", () => {
    const s = baseState([line("Salários CLT", 8_000)]);
    expect(folhaAnual(s)).toBe(96_000);
  });
});
