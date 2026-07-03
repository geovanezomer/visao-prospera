// Fixture: margem baixa — receita alta, mas margem bruta ~18%
// (custos diretos elevados) e folha inflada. Trigger para
// tools de despesas, benchmark e alavancas de eficiência.
import type { AppState } from "@/engines/finance/types";
import { DEFAULT_STATE } from "@/engines/finance/defaults";
import { fill12 } from "@/engines/finance/format";

// Infla custos diretos (proxy para "margem baixa") multiplicando
// valores existentes; não precisamos precisão cirúrgica — o objetivo
// é a IA reconhecer o padrão.
const inflatedCosts = DEFAULT_STATE.costs.map((c) =>
  c.category === "custo_vendas" || c.category === "direto_venda"
    ? { ...c, values: fill12(80_000) }
    : c,
);

export const fixtureMargemBaixa: AppState = {
  ...DEFAULT_STATE,
  companyName: "Fixture Margem Baixa LTDA",
  revenue: {
    ...DEFAULT_STATE.revenue,
    bruta: fill12(500_000),
  },
  costs: inflatedCosts,
  numColaboradores: 40,
};
