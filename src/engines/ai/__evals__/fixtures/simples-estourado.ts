// Fixture: Simples estourado — RBT12 acima do teto (R$ 4,8M).
// Deve disparar recomendação de downgrade para Presumido.
import type { AppState } from "@/engines/finance/types";
import { DEFAULT_STATE } from "@/engines/finance/defaults";
import { fill12 } from "@/engines/finance/format";

export const fixtureSimplesEstourado: AppState = {
  ...DEFAULT_STATE,
  companyName: "Fixture Simples Estourado LTDA",
  revenue: {
    ...DEFAULT_STATE.revenue,
    bruta: fill12(450_000), // ~R$ 5,4M/ano — acima do teto do Simples
  },
  tax: { ...DEFAULT_STATE.tax, regime: "simples", simplesAnexo: "III" },
};
