// Fixture: dívida crítica — DSCR ≈ 0,9, DL/EBITDA ≈ 4,5×.
// EBITDA saudável mas serviço da dívida pesado. Trigger para
// tools de contratos, indicadores e alavancas de renegociação.
import type { AppState } from "@/engines/finance/types";
import { DEFAULT_STATE } from "@/engines/finance/defaults";
import { fill12 } from "@/engines/finance/format";

export const fixtureDividaCritica: AppState = {
  ...DEFAULT_STATE,
  companyName: "Fixture Dívida Crítica LTDA",
  revenue: {
    ...DEFAULT_STATE.revenue,
    bruta: fill12(120_000),
  },
  capital: {
    ...DEFAULT_STATE.capital,
    kd: 22,
    patrimonioLiquido: 200_000,
    ativoTotal: 1_100_000,
    disponibilidades: 40_000,
  },
  cashflow: {
    ...DEFAULT_STATE.cashflow,
    amortizacoes: fill12(18_000), // ~R$216k/ano
  },
  tax: { ...DEFAULT_STATE.tax, regime: "presumido" },
};
