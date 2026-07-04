// Fixture: empresa saudável — indicadores todos verdes.
// Baseline para catch de falsos positivos ("crítico" em empresa boa).
import type { AppState } from "@/engines/finance/types";
import { DEFAULT_STATE } from "@/engines/finance/defaults";
import { fill12 } from "@/engines/finance/format";

export const fixtureSaudavel: AppState = {
  ...DEFAULT_STATE,
  companyName: "Fixture Saudável LTDA",
  revenue: {
    ...DEFAULT_STATE.revenue,
    bruta: fill12(300_000),
    pmr: 20,
    pmp: 45,
    pmrMensal: fill12(20),
    pmpMensal: fill12(45),
  },
  capital: {
    ...DEFAULT_STATE.capital,
    patrimonioLiquido: 800_000,
    ativoTotal: 1_000_000,
    disponibilidades: 250_000,
  },
  cashflow: {
    ...DEFAULT_STATE.cashflow,
    amortizacoes: fill12(2_000),
    caixaMinimo: 40_000,
  },
};
