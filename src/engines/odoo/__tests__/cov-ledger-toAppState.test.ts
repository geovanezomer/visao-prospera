/**
 * Retrato do Odoo → AppState: linhas de custo por natureza (folha, encargos
 * com/sem CPP, benefícios, comercial, financeiro), contratos sintéticos de
 * dívida, prazos médios, mix de produtos, DFC do razão, janela curta e
 * proteções (empresa sem retrato, árvore muito profunda).
 *
 * Empresa sintética equilibrada (débitos = créditos todo mês), 12 meses de 2025:
 *   Receita 20.000 · CPV 8.000 · Salários 3.000 · Pró-labore 2.000 · INSS 600
 *   FGTS 240 · Vale-alimentação 300 · Aluguel 1.000 · Propaganda 500
 *   Juros 400 · ICMS 1.800 · IRPJ 500  ⇒ resultado = 20.000 − 18.340 = 1.660/mês
 *   Clientes +1.000/mês · Fornecedores +500/mês · Empréstimo CP +200/mês
 *   Financiamento LP −300/mês ⇒ caixa = 1.660 − 1.000 + 500 + 200 − 300 = 1.060/mês
 */
import { describe, expect, it } from "vitest";
import { createState } from "@/engines/finance/__tests__/helpers";
import { classifyAccount } from "../mapping";
import {
  aggregateAccounts,
  anchorOdooState,
  applyOdooOverlay,
  buildEntityData,
  closedMonthOf,
  listEntities,
  prepareOdooOverlay,
  withoutAnchor,
} from "../toAppState";
import type { OdooAccountSnapshot, OdooCompanyInfo, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 7),
); // 2025-01 … 2025-12
const flat = (v: number) => MONTHS.map(() => v);

function acc(code: string, name: string, type: string, mensal: number, opening = 0) {
  return {
    id: Number(code.replace(/\D/g, "").slice(-6)),
    code,
    name,
    type,
    cls: classifyAccount({ code, name, type }),
    monthly: flat(mensal),
    opening,
  } as OdooAccountSnapshot;
}

const company = (over: Partial<OdooCompanyInfo>): OdooCompanyInfo => ({
  id: 1,
  name: "Alfa",
  vat: "11222333000181",
  parentId: null,
  partnerId: 9,
  currency: "BRL",
  lockDate: null,
  ...over,
});

function snapshot(): OdooSnapshot {
  return {
    version: 1,
    syncedAt: "2026-03-01T00:00:00Z",
    serverVersion: "20.0",
    months: MONTHS,
    companies: [company({})],
    perCompany: {
      "1": {
        accounts: [
          acc("1.01.01.01.01", "Caixa", "asset_cash", 1_060, 60_000),
          acc("1.01.02.02.01", "Clientes", "asset_receivable", 1_000),
          acc("2.01.01.03.01", "Fornecedores", "liability_payable", -500),
          acc("2.01.01.04.01", "Empréstimo capital de giro", "liability_current", -200, -10_000),
          acc("2.02.01.01", "Financiamento BNDES", "liability_non_current", 300, -40_000),
          acc("2.03.01.01", "Capital social", "equity", 0, -10_000),
          acc("3.01.01.01.01.01", "Receita de vendas", "income", -20_000),
          acc("3.01.01.03.01.01", "(-) CMV", "expense_direct_cost", 8_000),
          acc("3.01.01.07.01.02", "(-) Salários e ordenados", "expense", 3_000),
          acc("3.01.01.07.01.05", "(-) INSS", "expense", 600),
          acc("3.01.01.07.01.06", "(-) FGTS", "expense", 240),
          acc("3.01.01.07.01.01", "(-) Pró-labore", "expense", 2_000),
          acc("3.01.01.07.01.13", "(-) Vale alimentação", "expense", 300),
          acc("3.01.01.07.01.18", "(-) Aluguéis", "expense", 1_000),
          acc("3.01.01.07.01.20", "(-) Propaganda", "expense", 500),
          acc("3.01.01.09.01.06", "(-) Juros sobre empréstimos", "expense", 400),
          acc("3.01.01.01.02.03", "(-) ICMS", "expense", 1_800),
          acc("3.02.01.01", "(-) IRPJ", "expense", 500),
        ],
        intercompany: {
          // Conta inexistente no plano desta empresa: eliminação ignorada.
          lines: [{ counterpartCompanyId: 1, code: "9.9.9", monthly: flat(1), opening: 0 }],
        },
        products: [
          { productId: 10, name: "Produto A", revenue: flat(15_000), cogs: flat(6_000) },
          { productId: null, name: "Outros", revenue: flat(5_000), cogs: flat(2_000) },
          { productId: 11, name: "Sem venda", revenue: flat(0), cogs: flat(0) },
        ],
      },
    },
  };
}

const entity = () => listEntities(snapshot())[0];

describe("buildEntityData — janela, conciliação de tributos e mix de produtos", () => {
  it("12 meses fechados; tributos contabilizados vão para a conferência", () => {
    const d = buildEntityData(snapshot(), entity());
    expect(d.months).toEqual(MONTHS);
    // ICMS 1.800 × 12 e IRPJ 500 × 12
    expect(d.taxReconciliation).toEqual({ impostosVendasOdoo: 21_600, irCsllOdoo: 6_000 });
  });

  it("mix de produtos: soma na janela, descarta itens zerados e ordena por receita", () => {
    const d = buildEntityData(snapshot(), entity());
    expect(d.products).toEqual([
      { nome: "Produto A", receita: 180_000, cmv: 72_000 },
      { nome: "Outros", receita: 60_000, cmv: 24_000 },
    ]);
  });

  it("balanço de fechamento fecha: ativo 84.720 = passivo 54.800 + PL 29.920", () => {
    const { closing } = buildEntityData(snapshot(), entity()).actuals;
    expect(closing.caixa).toBe(72_720); // 60.000 + 12 × 1.060
    expect(closing.contas_receber).toBe(12_000);
    expect(closing.fornecedores).toBe(6_000);
    expect(closing.emprestimos_cp).toBe(12_400);
    expect(closing.emprestimos_lp).toBe(36_400);
    expect(closing.lucros_acumulados).toBe(19_920); // 12 × 1.660
    const ativo = closing.caixa + closing.contas_receber;
    const passivoPl =
      closing.fornecedores +
      closing.emprestimos_cp +
      closing.emprestimos_lp +
      closing.capital_social +
      closing.lucros_acumulados;
    expect(ativo).toBe(passivoPl);
  });
});

describe("prepareOdooOverlay — custos, dívida, prazos e balanço", () => {
  const ov = prepareOdooOverlay(buildEntityData(snapshot(), entity()));
  const byId = (code: string) => ov.costs.find((c) => c.id === `odoo:${code}`);

  it("cada natureza vira a categoria certa; receitas, impostos e IR/CSLL não viram custo", () => {
    expect(byId("3.01.01.03.01.01")).toMatchObject({
      label: "CMV",
      category: "custo_vendas",
      comportamento: "variavel",
    });
    expect(byId("3.01.01.07.01.02")).toMatchObject({
      label: "Folha: Salários e ordenados",
      category: "despesa_administrativa",
      comportamento: "fixo",
    });
    expect(byId("3.01.01.07.01.01")?.label).toBe("Pró-labore: Pró-labore");
    expect(byId("3.01.01.07.01.13")).toMatchObject({
      label: "Benefícios: Vale alimentação",
      cppPatronal: false,
    });
    expect(byId("3.01.01.07.01.18")).toMatchObject({
      category: "despesa_administrativa",
      comportamento: "fixo",
    });
    expect(byId("3.01.01.07.01.20")).toMatchObject({
      category: "despesa_comercial",
      comportamento: "variavel",
    });
    expect(byId("3.01.01.09.01.06")).toMatchObject({ category: "financeiro" });
    for (const code of ["3.01.01.01.01.01", "3.01.01.01.02.03", "3.02.01.01"])
      expect(byId(code)).toBeUndefined();
    expect(ov.costs).toHaveLength(9);
    expect(byId("3.01.01.03.01.01")?.values).toEqual(flat(8_000));
  });

  it("INSS patronal é CPP (fica no DAS do Simples); FGTS não é", () => {
    expect(byId("3.01.01.07.01.05")).toMatchObject({
      label: "Folha (encargos): INSS",
      cppPatronal: true,
    });
    expect(byId("3.01.01.07.01.06")).toMatchObject({
      label: "Folha (encargos): FGTS",
      cppPatronal: false,
    });
  });

  it("custos ordenados por categoria e depois por rótulo", () => {
    const keys = ov.costs.map((c) => `${c.category}|${c.label}`);
    const sorted = [...ov.costs]
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
      .map((c) => `${c.category}|${c.label}`);
    expect(keys).toEqual(sorted);
  });

  it("contratos sintéticos: saldo de fechamento e taxa = juros ÷ dívida média", () => {
    // Dívida média = (48.800 fim + 50.000 início) / 2 = 49.400
    // Taxa = 4.800 / 49.400 = 9,7166% → 9,72% a.a.
    expect(ov.capital.debtContracts).toEqual([
      expect.objectContaining({
        id: "odoo:emprestimos-cp",
        saldoDevedor: 12_400,
        taxaAA: 9.72,
        prazoMeses: 12,
        sistema: "price",
      }),
      expect.objectContaining({
        id: "odoo:emprestimos-lp",
        saldoDevedor: 36_400,
        taxaAA: 9.72,
        prazoMeses: 36,
      }),
    ]);
  });

  it("agregados de capital e prazos médios medidos no razão", () => {
    expect(ov.capital.ativoTotal).toBe(84_720);
    expect(ov.capital.ativoTotalAbertura).toBe(60_000);
    expect(ov.capital.patrimonioLiquido).toBe(29_920);
    expect(ov.capital.patrimonioLiquidoAbertura).toBe(10_000);
    expect(ov.capital.disponibilidades).toBe(72_720);
    expect(ov.capital.caixaOcioso).toBe(72_720);
    expect(ov.capital.ativoCirculante).toBe(84_720);
    expect(ov.capital.passivoCirculante).toBe(18_400); // 6.000 + 12.400
    // PMR = 12.000 / 240.000 × 360 = 18 dias; PMP = 6.000 / 96.000 × 360 = 22,5 → 23
    expect(ov.prazos).toEqual({ pmr: 18, pmp: 23 });
    expect(ov.header.fiscalYear).toBe(2025);
    expect(ov.header.cnpj).toBe("11222333000181");
  });

  it("DFC do razão (indireto): variação de caixa = operacional + investimento + financiamento", () => {
    const cf = ov.realizado.cf;
    // Operacional = 1.660 − ΔCR 1.000 + ΔFornecedores 500 = 1.160
    expect(cf.fluxoOperacional).toEqual(flat(1_160));
    // Financiamento: +200 CP −300 LP = −100 (amortização líquida)
    expect(cf.fluxoFinanciamento).toEqual(flat(-100));
    expect(cf.amortizacoes).toEqual(flat(100));
    expect(cf.emprestimosCaptados).toEqual(flat(0));
    expect(cf.fluxoInvestimento.every((v) => v === 0)).toBe(true);
    expect(cf.saldoInicial[0]).toBe(60_000);
    expect(cf.saldoFinal[11]).toBe(72_720);
    for (let j = 0; j < 12; j++)
      expect(cf.variacaoCaixa[j]).toBeCloseTo(
        cf.fluxoOperacional[j] + cf.fluxoInvestimento[j] + cf.fluxoFinanciamento[j],
        9,
      );
  });

  it("applyOdooOverlay troca o realizado e preserva premissas; CNPJ ausente mantém o do usuário", () => {
    const base = createState({ cnpj: "99.999.999/0001-99", tax: { regime: "presumido" } });
    const out = applyOdooOverlay(base, { ...ov, header: { ...ov.header, cnpj: null } });
    expect(out.cnpj).toBe("99.999.999/0001-99");
    expect(out.tax.regime).toBe("presumido");
    expect(out.revenue.pmr).toBe(18);
    expect(out.revenue.pmrMensal).toBeUndefined();
    expect(out.costs).toBe(ov.costs);
  });
});

describe("janela curta e casos-limite", () => {
  it("janela de 6 meses é completada à esquerda até 12 meses no realizado", () => {
    const d = buildEntityData(snapshot(), entity(), "2025-06");
    expect(d.months).toHaveLength(6);
    const ov = prepareOdooOverlay(d);
    expect(ov.realizado.meses).toEqual([
      "2024-07",
      "2024-08",
      "2024-09",
      "2024-10",
      "2024-11",
      "2024-12",
      ...MONTHS.slice(0, 6),
    ]);
    // Receita alinhada à direita: 6 meses zerados + 6 × 20.000
    expect(ov.revenue.bruta).toEqual([...new Array(6).fill(0), ...new Array(6).fill(20_000)]);
  });

  it("sem dívida no fechamento → nenhum contrato sintético", () => {
    const s = snapshot();
    s.perCompany["1"].accounts = s.perCompany["1"].accounts.filter(
      (a) => !/Empréstimo|Financiamento/.test(a.name),
    );
    const ov = prepareOdooOverlay(buildEntityData(s, listEntities(s)[0]));
    expect(ov.capital.debtContracts).toEqual([]);
  });

  it("empresa sem retrato é ignorada na agregação", () => {
    const s = snapshot();
    expect(aggregateAccounts(s, [1, 42])).toHaveLength(s.perCompany["1"].accounts.length);
  });

  it("árvore de filiais muito profunda é cortada (proteção contra laço)", () => {
    const s = snapshot();
    s.companies = Array.from({ length: 23 }, (_, i) =>
      company({ id: i + 1, name: `C${i + 1}`, parentId: i === 0 ? null : i }),
    );
    const e = listEntities(s)[0];
    // Raiz + 21 níveis (profundidade 0..20); o 23º nível fica de fora
    expect(e.companyIds).toHaveLength(22);
    expect(e.companyIds).not.toContain(23);
  });

  it("closedMonthOf: sem data → null; último dia do mês fecha o mês; meio do mês fecha o anterior", () => {
    expect(closedMonthOf(null)).toBeNull();
    expect(closedMonthOf(undefined)).toBeNull();
    expect(closedMonthOf("2025-06-30")).toBe("2025-06");
    expect(closedMonthOf("2025-06-15")).toBe("2025-05");
    expect(closedMonthOf("2025-01-10")).toBe("2024-12");
  });

  it("âncora e remoção da âncora são no-ops sem realizado", () => {
    const s = createState({});
    expect(anchorOdooState(s)).toBe(s);
    expect(withoutAnchor(s)).toBe(s);
    const comRealizado = { ...s, realizado: { fonte: "odoo" } } as typeof s;
    expect(withoutAnchor(comRealizado).realizado).toBeUndefined();
  });
});
