// Fixture: prestador de serviços no Simples, Anexo V, Fator R próximo
// do limite de 28% — pode migrar para Anexo III (alíquotas menores).
import type { AppState } from "@/engines/finance/types";
import { DEFAULT_STATE } from "@/engines/finance/defaults";
import { fill12 } from "@/engines/finance/format";

export const fixtureServicosFatorR: AppState = {
  ...DEFAULT_STATE,
  companyName: "Fixture Serviços Fator R LTDA",
  businessType: "servicos",
  revenue: {
    ...DEFAULT_STATE.revenue,
    bruta: fill12(150_000),
  },
  tax: {
    ...DEFAULT_STATE.tax,
    regime: "simples",
    simplesAnexo: "V",
    fatorR: 27, // 1 p.p. abaixo do limite — cenário clássico Fator R
    fatorRAuto: false,
  },
};
