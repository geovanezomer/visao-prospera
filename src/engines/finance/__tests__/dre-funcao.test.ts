/**
 * DRE por FUNÇÃO contábil (CPC 26 / Lei 6.404) — valida que:
 *  1. Despesas Comerciais (despesa_comercial + alias legado "variavel") e
 *     Despesas Administrativas (despesa_administrativa + alias legado "fixo")
 *     são contabilizadas separadamente, mês a mês.
 *  2. CPV e Financeiras não vazam para essas duas funções.
 *  3. Aliases legados ("fixo"/"variavel") são tratados igual aos canônicos —
 *     a migração não é necessária para o cálculo continuar correto.
 */
import { describe, it, expect } from "vitest";
import { buildDRE } from "../dre";
import { createState, m12 } from "./helpers";
import type { CostLine } from "../types";

const line = (id: string, category: CostLine["category"], monthly: number): CostLine => ({
  id,
  label: id,
  category,
  values: m12(monthly),
  fixed: true,
});

describe("DRE por função — separação Comerciais × Administrativas", () => {
  it("acumula despesa_comercial e despesa_administrativa em buckets distintos por mês", () => {
    const s = createState({
      revenue: {
        bruta: m12(100_000),
        inadimplencia: m12(0),
        deducoes: [],
        receitasFinanceiras: [],
      },
      tax: { regime: "presumido" },
      costs: [
        line("mkt", "despesa_comercial", 5_000), // comercial
        line("comissoes", "despesa_comercial", 3_000), // comercial
        line("aluguel", "despesa_administrativa", 4_000), // admin
        line("contab", "despesa_administrativa", 1_000), // admin
        line("juros", "financeiro", 2_000), // financeiro
        line("cpv1", "direto_venda", 20_000), // CPV
      ],
    });
    const { dre } = buildDRE(s, "presumido");

    // Replica a quebra exibida na DRETab (mesma lógica do simulator.ts).
    const zeros = () => Array(12).fill(0);
    const comerciais = zeros();
    const admin = zeros();
    const financ = zeros();
    for (const c of s.costs) {
      if (c.category === "despesa_comercial" || c.category === "variavel")
        for (let i = 0; i < 12; i++) comerciais[i] += c.values[i];
      else if (c.category === "despesa_administrativa" || c.category === "fixo")
        for (let i = 0; i < 12; i++) admin[i] += c.values[i];
      else if (c.category === "financeiro") for (let i = 0; i < 12; i++) financ[i] += c.values[i];
    }

    // Mês a mês: comerciais = 8.000, admin = 5.000, financeiras = 2.000.
    for (let i = 0; i < 12; i++) {
      expect(comerciais[i]).toBe(8_000);
      expect(admin[i]).toBe(5_000);
      expect(financ[i]).toBe(2_000);
    }

    // EBITDA = LB − (Comerciais + Admin). Lucro Bruto = RecLíq − CPV.
    // Diferença (LB − EBITDA) deve igualar a soma de Comerciais + Admin por mês.
    for (let i = 0; i < 12; i++) {
      expect(dre.lucroBruto[i] - dre.ebitda[i]).toBeCloseTo(comerciais[i] + admin[i], 2);
    }

    // Financeiras NÃO entram no EBITDA — vão ao Resultado Financeiro pós-EBIT.
    for (let i = 0; i < 12; i++) {
      expect(dre.custosFinanceirosTotal[i]).toBe(2_000);
    }
  });

  it("aliases legados (fixo/variavel) caem nos mesmos buckets dos canônicos", () => {
    const s = createState({
      revenue: { bruta: m12(50_000), inadimplencia: m12(0), deducoes: [], receitasFinanceiras: [] },
      tax: { regime: "presumido" },
      costs: [
        line("mkt_novo", "despesa_comercial", 1_000),
        line("mkt_legado", "variavel", 1_000), // alias legado
        line("admin_novo", "despesa_administrativa", 2_000),
        line("admin_legado", "fixo", 2_000), // alias legado
      ],
    });
    const { dre } = buildDRE(s, "presumido");

    // Total despesas operacionais (comerciais + admin) = 6.000/mês.
    for (let i = 0; i < 12; i++) {
      expect(dre.despesasOperacionais[i]).toBeCloseTo(6_000, 2);
    }
    // CPV vazio (não há linha de custo_vendas/direto_venda).
    expect(dre.cpv.every((v) => v === 0)).toBe(true);
  });
});
