import { describe, expect, it } from "vitest";
import { bsValue, classifyAccount, plValue } from "../mapping";

const pl = (code: string, name: string, type = "expense") => {
  const c = classifyAccount({ code, name, type });
  return c.kind === "pl" ? c.line : c.kind;
};
const bs = (code: string, name: string, type: string) => {
  const c = classifyAccount({ code, name, type });
  return c.kind === "bs" ? c.bucket : c.kind;
};

describe("classifyAccount — resultado (plano ECD do l10n_br)", () => {
  it.each([
    ["3.01.01.01.01.04", "Receita de vendas de mercadorias", "income", "receita_bruta"],
    ["3.01.01.01.02.03", "(-) ICMS", "expense", "impostos_vendas"],
    ["3.01.01.01.02.05", "(-) PIS/PASEP On Gross Revenue", "expense", "impostos_vendas"],
    ["3.01.01.01.02.06", "(-) ISS", "expense", "impostos_vendas"],
    ["3.01.01.01.02.01", "(-) Canceled Sales and Sales Returns", "expense", "deducoes"],
    ["3.01.01.03.01.02", "(-) Cost of Goods", "expense_direct_cost", "cpv"],
    ["3.01.01.05.01.05", "Other Financial Income", "income_other", "receita_financeira"],
    ["3.01.01.07.01.02", "(-) Salários e ordenados", "expense", "pessoal_salarios"],
    ["3.01.01.07.01.05", "(-) Social Charges - Social Security", "expense", "pessoal_encargos"],
    ["3.01.01.07.01.13", "(-) Worker's Food", "expense", "pessoal_beneficios"],
    ["3.01.01.07.01.04", "(-) Other Services Provided", "expense", "despesa_administrativa"],
    ["3.01.01.07.01.18", "(-) Rentals", "expense", "despesa_administrativa"],
    ["3.01.01.07.01.20", "(-) Advertising, Publicity", "expense", "despesa_comercial"],
    ["3.01.01.07.01.23", "(-) Depreciation Charges", "expense_depreciation", "depreciacao"],
    ["3.01.01.09.01.06", "(-) Interest on Loans", "expense", "despesa_financeira"],
    ["3.02.01.01.01.02", "(-) Provision for Income Tax", "expense", "ir_csll"],
  ])("%s %s → %s", (code, name, type, expected) => {
    expect(pl(code, name, type)).toBe(expected);
  });

  it("plano personalizado (sem ECD) cai no tipo de conta", () => {
    expect(pl("4.1", "Vendas", "income")).toBe("receita_bruta");
    expect(pl("5.1", "CMV", "expense_direct_cost")).toBe("cpv");
    expect(pl("6.9", "Juros bancários", "expense")).toBe("despesa_financeira");
    expect(pl("6.1", "Salários", "expense")).toBe("pessoal_salarios");
  });
});

describe("classifyAccount — balanço", () => {
  it.each([
    ["1.01.01.02.01", "Banco", "asset_cash", "caixa"],
    ["1.01.02.02.01", "Duplicatas a receber", "asset_receivable", "contas_receber"],
    ["1.01.03.01.01", "Mercadorias para revenda", "asset_current", "estoques"],
    ["1.01.02.03.02", "ICMS a recuperar", "asset_current", "impostos_recuperar"],
    ["1.02.03.01.02", "Edificações", "asset_fixed", "imobilizado"],
    ["1.02.03.01.30", "(-) Accrued Depreciation", "asset_fixed", "depreciacao_acumulada"],
    ["2.01.01.03.01", "Fornecedores", "liability_payable", "fornecedores"],
    ["2.01.01.07.02", "Loans or Financing - Current", "liability_current", "emprestimos_cp"],
    ["2.01.01.09.03", "ICMS a recolher", "liability_current", "impostos_pagar"],
    ["2.01.01.01.01", "Salários a pagar", "liability_current", "salarios_encargos"],
    ["2.02.01.01.06", "Loans or Financing - Long term", "liability_non_current", "emprestimos_lp"],
    ["2.03.01.01.01", "Capital subscrito", "equity", "capital_social"],
    ["999999", "Lucros do exercício", "equity_unaffected", "lucros_acumulados"],
  ])("%s %s → %s", (code, name, type, expected) => {
    expect(bs(code, name, type)).toBe(expected);
  });
});

describe("ajustes manuais e sinais", () => {
  it("ajuste por código vence a regra automática", () => {
    const overrides = new Map([["3.01.01.07.01.18", "despesa_comercial" as const]]);
    const c = classifyAccount(
      { code: "3.01.01.07.01.18", name: "(-) Rentals", type: "expense" },
      overrides,
    );
    expect(c).toEqual({ kind: "pl", line: "despesa_comercial" });
  });

  it("ignorar e contas de compensação ficam fora", () => {
    expect(classifyAccount({ code: "9", name: "x", type: "off_balance" }).kind).toBe("ignore");
    expect(
      classifyAccount(
        { code: "1.01", name: "x", type: "asset_current" },
        new Map([["1.01", "ignore"]]),
      ).kind,
    ).toBe("ignore");
  });

  it("receita vem com crédito (balance negativo) e vira positiva", () => {
    expect(plValue("receita_bruta", -1000)).toBe(1000);
    expect(plValue("cpv", 400)).toBe(400);
    expect(bsValue("caixa", 500)).toBe(500);
    expect(bsValue("fornecedores", -300)).toBe(300);
  });
});
