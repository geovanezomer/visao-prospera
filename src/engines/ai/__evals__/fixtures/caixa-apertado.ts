// Fixture: caixa apertado — EBITDA positivo mas 3 meses de caixa negativo,
// NCG alta (PMR longo, PMP curto).
import type { AppState } from "@/engines/finance/types";
import { DEFAULT_STATE } from "@/engines/finance/defaults";
import { fill12 } from "@/engines/finance/format";

export const fixtureCaixaApertado: AppState = {
  ...DEFAULT_STATE,
  companyName: "Fixture Caixa Apertado LTDA",
  revenue: {
    ...DEFAULT_STATE.revenue,
    bruta: fill12(200_000),
    pmr: 90,
    pmp: 15,
    pmrMensal: fill12(90),
    pmpMensal: fill12(15),
  },
  capital: {
    ...DEFAULT_STATE.capital,
    disponibilidades: 5_000,
    capitalGiroDisponivel: 2_000,
  },
  cashflow: {
    ...DEFAULT_STATE.cashflow,
    caixaMinimo: 30_000,
    capex: fill12(20_000),
  },
};
