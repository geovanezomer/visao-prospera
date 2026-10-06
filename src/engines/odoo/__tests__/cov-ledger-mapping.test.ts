/**
 * Classificação de contas do Odoo — ramos ainda não cobertos do plano ECD
 * (l10n_br), de planos personalizados (decisão pelo tipo de conta) e dos
 * sinais de apresentação (receita/passivo positivos).
 */
import { describe, expect, it } from "vitest";
import {
  BS_BUCKET_LABELS,
  BS_IS_ASSET,
  bsValue,
  classifyAccount,
  PL_LINE_LABELS,
  plValue,
} from "../mapping";

const cls = (code: string, name: string, type: string) => {
  const c = classifyAccount({ code, name, type });
  return c.kind === "pl" ? c.line : c.kind === "bs" ? c.bucket : c.kind;
};

describe("classifyAccount — resultado (ECD por nome/tipo)", () => {
  it.each([
    // Despesas operacionais 3.01.01.07.01.xx sem sufixo mapeado: decide pelo nome
    ["3.01.01.07.01.99", "(-) Comissões sobre vendas", "expense", "despesa_comercial"],
    ["3.01.01.07.01.98", "(-) Aluguéis de imóveis", "expense", "despesa_administrativa"],
    // Não operacionais 3.01.01.11: receita × despesa pelo tipo
    ["3.01.01.11.01.01", "Ganho na venda de imobilizado", "income_other", "outras_receitas"],
    ["3.01.01.11.02.01", "(-) Perda na baixa de ativo", "expense", "outras_despesas"],
    // 3.01.01.07 fora do grupo .01: comercial × administrativa pelo nome
    ["3.01.01.07.02.01", "(-) Propaganda institucional", "expense", "despesa_comercial"],
    ["3.01.01.07.02.02", "(-) Energia elétrica", "expense", "despesa_administrativa"],
    // Atividade rural (3.11 / 3.12) segue a mesma estrutura
    ["3.11.01.01.01.01", "Receita rural", "income", "receita_bruta"],
    ["3.11.01.01.02.03", "(-) ICMS", "expense", "impostos_vendas"],
    ["3.11.01.01.02.01", "(-) Devoluções de vendas", "expense", "deducoes"],
    ["3.11.01.07.01.05", "(-) INSS", "expense", "pessoal_encargos"],
    ["3.12.01.01", "(-) CSLL", "expense", "ir_csll"],
  ])("%s %s → %s", (code, name, type, expected) => {
    expect(cls(code, name, type)).toBe(expected);
  });
});

describe("classifyAccount — resultado em plano personalizado (pelo tipo/nome)", () => {
  it.each([
    ["4.2", "Juros recebidos", "income_other", "receita_financeira"],
    ["4.3", "Aluguel recebido", "income_other", "outras_receitas"],
    ["6.2", "ICMS sobre vendas", "expense", "impostos_vendas"],
    ["6.3", "INSS empresa", "expense", "pessoal_encargos"],
    ["6.4", "IOF", "expense_other", "despesa_financeira"],
    ["6.5", "Comissões", "expense", "despesa_comercial"],
    ["6.6", "Material de escritório", "expense", "despesa_administrativa"],
    ["6.7", "Depreciação de máquinas", "expense", "depreciacao"],
    ["6.8", "Pró-labore", "expense", "pessoal_salarios"],
  ])("%s %s (%s) → %s", (code, name, type, expected) => {
    expect(cls(code, name, type)).toBe(expected);
  });
});

describe("classifyAccount — balanço", () => {
  it.each([
    // Ativo
    ["1.02.01.01", "Clientes de longo prazo", "asset_receivable", "realizavel_lp"],
    ["1.01.01.05.01", "Aplicação CDB", "asset_current", "aplicacoes"],
    ["1.01.05.01", "Seguros a apropriar", "asset_current", "despesas_antecipadas"],
    ["9.9", "Prêmio pago antecipadamente", "asset_prepayments", "despesas_antecipadas"],
    ["1.01.02.04.01", "IRRF retido", "asset_current", "impostos_recuperar"],
    ["1.02.01.09", "PIS a recuperar LP", "asset_non_current", "realizavel_lp"],
    ["1.02.01.01", "Depósitos judiciais", "asset_non_current", "realizavel_lp"],
    ["1.02.02.01", "Participação em controlada", "asset_non_current", "investimentos"],
    ["1.02.04.01", "Software", "asset_non_current", "intangivel"],
    ["1.02.04.09", "(-) Amortização acumulada", "asset_non_current", "depreciacao_acumulada"],
    ["1.01.02.02.05", "Cheques a receber", "asset_current", "contas_receber"],
    ["1.01.09.01", "Adiantamento a fornecedor", "asset_current", "outros_ac"],
    ["8.1", "Ativo diverso", "asset_non_current", "realizavel_lp"],
    // Patrimônio líquido
    ["2.03.04.01", "Lucros acumulados", "equity", "lucros_acumulados"],
    ["2.03.02.01", "Reserva legal", "equity", "reservas"],
    ["9.1", "Resultado não distribuído", "equity_unaffected", "lucros_acumulados"],
    ["9.2", "Capital integralizado", "equity", "capital_social"],
    ["9.3", "Reserva de lucros", "equity", "reservas"],
    // Passivo não circulante
    ["2.02.01.01", "Fornecedores LP", "liability_payable", "outros_pnc"],
    ["2.02.01.02", "Financiamento BNDES", "liability_non_current", "emprestimos_lp"],
    ["2.02.03.01", "Parcelamento REFIS", "liability_non_current", "impostos_parcelados"],
    ["2.02.09.01", "Provisão para contingências", "liability_non_current", "outros_pnc"],
    // Passivo circulante
    ["2.01.01.04.01", "Empréstimo capital de giro", "liability_current", "emprestimos_cp"],
    ["2.01.01.01.01", "Pró-labore a pagar", "liability_current", "salarios_encargos"],
    ["2.01.01.07.01", "Férias a pagar", "liability_current", "salarios_encargos"],
    ["2.01.01.05.01", "Adiantamento de clientes", "liability_current", "adiantamentos_clientes"],
    ["2.01.01.03.01", "Fornecedores nacionais", "liability_current", "fornecedores"],
    ["2.01.01.09.01", "ICMS a recolher", "liability_current", "impostos_pagar"],
    ["2.01.02.01", "Income tax payable", "liability_current", "impostos_pagar"],
    ["2.01.01.99", "Outras obrigações", "liability_current", "outros_pc"],
  ])("%s %s (%s) → %s", (code, name, type, expected) => {
    expect(cls(code, name, type)).toBe(expected);
  });

  it("contas de compensação são ignoradas", () => {
    expect(cls("9.8", "Garantias prestadas", "off_balance")).toBe("ignore");
  });
});

describe("classifyAccount — ajuste manual por código", () => {
  const ov = new Map<string, never>([
    ["6.6", "ignore" as never],
    ["6.5", "despesa_financeira" as never],
    ["1.01.09.01", "estoques" as never],
  ]);
  it("ignorar, linha de resultado ou grupo do balanço forçados prevalecem", () => {
    expect(classifyAccount({ code: "6.6", name: "x", type: "expense" }, ov)).toEqual({
      kind: "ignore",
    });
    expect(classifyAccount({ code: "6.5", name: "Comissões", type: "expense" }, ov)).toEqual({
      kind: "pl",
      line: "despesa_financeira",
    });
    expect(classifyAccount({ code: "1.01.09.01", name: "x", type: "asset_current" }, ov)).toEqual({
      kind: "bs",
      bucket: "estoques",
    });
  });
});

describe("sinais de apresentação", () => {
  it("receitas (saldo credor) e despesas (saldo devedor) ficam positivas", () => {
    // Odoo: balance = débito − crédito → receita de 1.000 vem como −1.000
    expect(plValue("receita_bruta", -1_000)).toBe(1_000);
    expect(plValue("receita_financeira", -50)).toBe(50);
    expect(plValue("outras_receitas", -10)).toBe(10);
    expect(plValue("cpv", 400)).toBe(400);
    // Estorno de despesa (crédito) reduz a despesa
    expect(plValue("despesa_administrativa", -30)).toBe(-30);
  });

  it("ativo devedor positivo; passivo e PL credores positivos; redutora de ativo negativa", () => {
    expect(bsValue("caixa", 500)).toBe(500);
    expect(bsValue("fornecedores", -300)).toBe(300);
    expect(bsValue("capital_social", -1_000)).toBe(1_000);
    expect(bsValue("depreciacao_acumulada", -200)).toBe(-200);
  });

  it("todo grupo e toda linha têm rótulo; 12 grupos de ativo e 12 de passivo/PL", () => {
    const buckets = Object.keys(BS_IS_ASSET);
    expect(Object.keys(BS_BUCKET_LABELS).sort()).toEqual([...buckets].sort());
    expect(buckets.filter((b) => BS_IS_ASSET[b as keyof typeof BS_IS_ASSET])).toHaveLength(12);
    expect(Object.keys(PL_LINE_LABELS)).toHaveLength(15);
  });
});
