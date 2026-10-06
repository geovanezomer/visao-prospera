// ============================================================================
// Classificação de contas contábeis do Odoo nas linhas do modelo.
//
// Ordem de decisão:
//   1. Ajuste manual por código (tela de mapeamento do admin).
//   2. Prefixo do plano referencial da ECD (plano l10n_br do Odoo). O tipo de
//      conta sozinho erra em dois pontos críticos: as deduções da receita
//      (ICMS/PIS/COFINS/ISS/devoluções) e as despesas financeiras vêm como
//      "expense" comum.
//   3. Tipo de conta do Odoo (`account_type`), para planos personalizados.
// ============================================================================
import type { AccountClass, AccountOverride, BsBucket, PlLine } from "./types";

const PL_LINES = new Set<string>([
  "receita_bruta",
  "deducoes",
  "impostos_vendas",
  "cpv",
  "pessoal_salarios",
  "pessoal_encargos",
  "pessoal_beneficios",
  "despesa_administrativa",
  "despesa_comercial",
  "depreciacao",
  "receita_financeira",
  "despesa_financeira",
  "outras_receitas",
  "outras_despesas",
  "ir_csll",
]);

const TAX_ON_SALES_CI =
  /\b(icms|pis|pasep|cofins|iss|ipi|cbs|ibs|simples nacional)\b|impostos? (e contribui[çc][õo]es )?s(obre|\/) (as )?vendas|taxes? (and contributions )?on sales/i;
/** "DAS" só como sigla (maiúsculas): em minúsculas é a preposição ("aluguel das lojas"). */
const DAS_RE = /\bDAS\b/;
const TAX_ON_SALES_RE = { test: (name: string) => TAX_ON_SALES_CI.test(name) || DAS_RE.test(name) };
/** "Terceiros" só como contribuição social (Sistema S); "serviços de terceiros" é despesa. */
const ENCARGOS_RE =
  /inss|fgts|encargo|social charges|contribui[çc][ãa]o (previdenci|social)|rat\b|contribui[çc][õo]es? (a|de|para) terceiros|outras entidades|sistema s\b/i;
const COMERCIAL_RE =
  /venda|comerci|propaganda|publicidade|marketing|comiss|frete s(obre|\/) vendas|selling|advertis|commission/i;
const DEPRECIATION_RE = /deprecia|amortiza|depreciation|amortization/i;
const LOAN_RE =
  /empr[ée]stimo|financiamento|loan|financing|debenture|m[úu]tuo|mutual loan|discounted/i;

/**
 * Despesas operacionais da ECD (3.01.01.07.01.xx e o equivalente rural
 * 3.11.01.07.01.xx): o grupo mistura pessoal e demais despesas, então a
 * classificação é pelo sufixo exato do código.
 */
const OPEX_SUFFIX: Record<string, PlLine> = {
  "01": "pessoal_salarios", // pró-labore / administradores
  "02": "pessoal_salarios", // salários e gratificações
  "03": "pessoal_salarios", // outras despesas com pessoal
  "26": "pessoal_salarios", // provisão de férias
  "27": "pessoal_salarios", // provisão de 13º
  "30": "pessoal_salarios", // gratificações a administradores
  "05": "pessoal_encargos", // INSS
  "06": "pessoal_encargos", // FGTS
  "07": "pessoal_encargos", // outros encargos
  "13": "pessoal_beneficios", // alimentação do trabalhador
  "33": "pessoal_beneficios", // assistência médica/odontológica
  "41": "pessoal_beneficios", // benefícios previdenciários
  "20": "despesa_comercial", // propaganda e publicidade
  "21": "despesa_comercial",
};

/** Regras por prefixo da ECD: o prefixo mais longo vence. */
const PL_PREFIXES: Array<[string, PlLine | "by_name"]> = [
  ["3.01.01.01.01", "receita_bruta"],
  ["3.01.01.01.02", "by_name"], // deduções: tributos sobre vendas × devoluções/abatimentos
  ["3.01.01.03", "cpv"],
  ["3.01.01.05", "receita_financeira"],
  ["3.01.01.07.01", "by_name"], // pessoal: salários × encargos
  ["3.01.01.07", "by_name"], // despesas operacionais: comercial × administrativa
  ["3.01.01.09", "despesa_financeira"],
  ["3.01.01.11", "by_name"], // não operacionais: receita × despesa (pelo tipo)
  ["3.02", "ir_csll"],
  // Atividade rural (3.11 / 3.12) segue a mesma estrutura.
  ["3.11.01.01.01", "receita_bruta"],
  ["3.11.01.01.02", "by_name"],
  ["3.11.01.07.01", "by_name"],
  ["3.12", "ir_csll"],
];

function longestPrefix<T>(code: string, rules: Array<[string, T]>): T | undefined {
  let best: [string, T] | undefined;
  for (const r of rules)
    if (code.startsWith(r[0]) && (!best || r[0].length > best[0].length)) best = r;
  return best?.[1];
}

function classifyPl(code: string, name: string, type: string): PlLine {
  if (type === "expense_depreciation" || (type.startsWith("expense") && DEPRECIATION_RE.test(name)))
    return "depreciacao";
  const rule = longestPrefix(code, PL_PREFIXES);
  if (rule && rule !== "by_name") return rule;
  if (rule === "by_name") {
    if (code.startsWith("3.01.01.01.02") || code.startsWith("3.11.01.01.02"))
      return TAX_ON_SALES_RE.test(name) ? "impostos_vendas" : "deducoes";
    const opex = code.match(/^3\.(?:01|11)\.01\.07\.01\.(\d{2})/);
    if (opex) {
      const byCode = OPEX_SUFFIX[opex[1]];
      if (byCode) return byCode;
      return COMERCIAL_RE.test(name) ? "despesa_comercial" : "despesa_administrativa";
    }
    if (code.startsWith("3.01.01.11"))
      return type.startsWith("income") ? "outras_receitas" : "outras_despesas";
    return COMERCIAL_RE.test(name) ? "despesa_comercial" : "despesa_administrativa";
  }
  // Plano sem prefixos da ECD: decide pelo tipo de conta.
  switch (type) {
    case "income":
      return "receita_bruta";
    case "income_other":
      return /juro|rendimento|financ|interest/i.test(name)
        ? "receita_financeira"
        : "outras_receitas";
    case "expense_direct_cost":
      return "cpv";
    default:
      if (TAX_ON_SALES_RE.test(name)) return "impostos_vendas";
      if (/juro|financ|iof|tarifa banc|interest|bank fee/i.test(name)) return "despesa_financeira";
      if (/sal[áa]rio|folha|pr[óo]-?labore|payroll|wage/i.test(name)) return "pessoal_salarios";
      if (ENCARGOS_RE.test(name)) return "pessoal_encargos";
      return COMERCIAL_RE.test(name) ? "despesa_comercial" : "despesa_administrativa";
  }
}

function classifyBs(code: string, name: string, type: string): BsBucket {
  const isLoan = LOAN_RE.test(name);
  // Ativo — contas "a receber" do Odoo (conciliáveis com clientes) vencem o
  // prefixo: no plano BR há contas a receber dentro de 1.01.01.04.
  if (type === "asset_receivable")
    return code.startsWith("1.02") ? "realizavel_lp" : "contas_receber";
  if (type === "liability_payable") return code.startsWith("2.02") ? "outros_pnc" : "fornecedores";
  if (
    type === "asset_cash" ||
    code.startsWith("1.01.01.01") ||
    code.startsWith("1.01.01.02") ||
    code.startsWith("1.01.01.04") // numerário em trânsito
  )
    return "caixa";
  if (code.startsWith("1.01.01")) return "aplicacoes";
  if (code.startsWith("1.01.03")) return "estoques";
  if (code.startsWith("1.01.05") || type === "asset_prepayments") return "despesas_antecipadas";
  if (
    code.startsWith("1.01.02.03") ||
    code.startsWith("1.01.02.04") ||
    /a recuperar|to recover|withholding/i.test(name)
  )
    return code.startsWith("1.02") ? "realizavel_lp" : "impostos_recuperar";
  if (code.startsWith("1.02.01")) return "realizavel_lp";
  if (code.startsWith("1.02.02")) return "investimentos";
  if (code.startsWith("1.02.03") || type === "asset_fixed")
    return DEPRECIATION_RE.test(name) ? "depreciacao_acumulada" : "imobilizado";
  if (code.startsWith("1.02.04") || code.startsWith("1.02.05") || code.startsWith("1.02.06"))
    return DEPRECIATION_RE.test(name) ? "depreciacao_acumulada" : "intangivel";
  if (type === "asset_receivable")
    return code.startsWith("1.02") ? "realizavel_lp" : "contas_receber";
  if (code.startsWith("1.01.02.02")) return "contas_receber";
  if (type === "asset_non_current" || code.startsWith("1.02")) return "realizavel_lp";
  if (type.startsWith("asset") || code.startsWith("1")) return "outros_ac";
  // Patrimônio líquido
  if (type === "equity_unaffected") return "lucros_acumulados";
  if (code.startsWith("2.03.01")) return "capital_social";
  if (code.startsWith("2.03")) {
    return /lucro|preju|accumulated|retained|resultado/i.test(name)
      ? "lucros_acumulados"
      : "reservas";
  }
  if (type === "equity") return /capital/i.test(name) ? "capital_social" : "reservas";
  // Passivo não circulante
  if (code.startsWith("2.02") || type === "liability_non_current") {
    if (isLoan) return "emprestimos_lp";
    if (/parcel|installment/i.test(name)) return "impostos_parcelados";
    return "outros_pnc";
  }
  // Passivo circulante
  if (isLoan) return "emprestimos_cp";
  if (code.startsWith("2.01.01.01") || /sal[áa]rio|folha|f[ée]rias|payroll|salar/i.test(name))
    return "salarios_encargos";
  if (
    code.startsWith("2.01.01.05") ||
    /adiantamento de cliente|advances? from customer/i.test(name)
  )
    return "adiantamentos_clientes";
  if (code.startsWith("2.01.01.03") || type === "liability_payable") return "fornecedores";
  if (
    code.startsWith("2.01.01.09") ||
    code.startsWith("2.01.01.15") ||
    /a recolher|a pagar.*(imposto|tribut)|to collect|tax payable|provision for income/i.test(name)
  )
    return "impostos_pagar";
  return "outros_pc";
}

const P_AND_L_TYPES = new Set([
  "income",
  "income_other",
  "expense",
  "expense_other",
  "expense_depreciation",
  "expense_direct_cost",
]);

export function classifyAccount(
  account: { code: string; name: string; type: string },
  overrides?: Map<string, AccountOverride["target"]>,
): AccountClass {
  const forced = overrides?.get(account.code);
  if (forced === "ignore") return { kind: "ignore" };
  if (forced) {
    return PL_LINES.has(forced)
      ? { kind: "pl", line: forced as PlLine }
      : { kind: "bs", bucket: forced as BsBucket };
  }
  if (account.type === "off_balance") return { kind: "ignore" };
  const isPl = P_AND_L_TYPES.has(account.type) || /^3(\.|$)/.test(account.code);
  return isPl
    ? { kind: "pl", line: classifyPl(account.code, account.name, account.type) }
    : { kind: "bs", bucket: classifyBs(account.code, account.name, account.type) };
}

/** Valor da linha de resultado no sentido do relatório (receita +, despesa +). */
export function plValue(line: PlLine, balance: number): number {
  const isRevenue =
    line === "receita_bruta" || line === "receita_financeira" || line === "outras_receitas";
  return isRevenue ? -balance : balance;
}

/** Valor de balanço no sentido do relatório (ativo +, passivo/PL +). */
export function bsValue(bucket: BsBucket, balance: number): number {
  return BS_IS_ASSET[bucket] ? balance : -balance;
}

export const BS_IS_ASSET: Record<BsBucket, boolean> = {
  caixa: true,
  aplicacoes: true,
  contas_receber: true,
  estoques: true,
  impostos_recuperar: true,
  despesas_antecipadas: true,
  outros_ac: true,
  realizavel_lp: true,
  investimentos: true,
  imobilizado: true,
  depreciacao_acumulada: true,
  intangivel: true,
  fornecedores: false,
  salarios_encargos: false,
  impostos_pagar: false,
  emprestimos_cp: false,
  adiantamentos_clientes: false,
  outros_pc: false,
  emprestimos_lp: false,
  impostos_parcelados: false,
  outros_pnc: false,
  capital_social: false,
  reservas: false,
  lucros_acumulados: false,
};

export const PL_LINE_LABELS: Record<PlLine, string> = {
  receita_bruta: "Receita bruta",
  deducoes: "Devoluções e abatimentos",
  impostos_vendas: "Impostos sobre vendas",
  cpv: "Custo das vendas (CPV/CMV/CSP)",
  pessoal_salarios: "Salários e remunerações",
  pessoal_encargos: "Encargos sobre folha",
  pessoal_beneficios: "Benefícios a empregados",
  despesa_administrativa: "Despesas administrativas",
  despesa_comercial: "Despesas comerciais",
  depreciacao: "Depreciação e amortização",
  receita_financeira: "Receitas financeiras",
  despesa_financeira: "Despesas financeiras",
  outras_receitas: "Outras receitas",
  outras_despesas: "Outras despesas",
  ir_csll: "IRPJ e CSLL",
};

export const BS_BUCKET_LABELS: Record<BsBucket, string> = {
  caixa: "Caixa e bancos",
  aplicacoes: "Aplicações financeiras",
  contas_receber: "Contas a receber",
  estoques: "Estoques",
  impostos_recuperar: "Impostos a recuperar",
  despesas_antecipadas: "Despesas antecipadas",
  outros_ac: "Outros ativos circulantes",
  realizavel_lp: "Realizável a longo prazo",
  investimentos: "Investimentos",
  imobilizado: "Imobilizado",
  depreciacao_acumulada: "(−) Depreciação/amortização acumulada",
  intangivel: "Intangível",
  fornecedores: "Fornecedores",
  salarios_encargos: "Salários e encargos a pagar",
  impostos_pagar: "Impostos a pagar",
  emprestimos_cp: "Empréstimos e financiamentos (CP)",
  adiantamentos_clientes: "Adiantamentos de clientes",
  outros_pc: "Outros passivos circulantes",
  emprestimos_lp: "Empréstimos e financiamentos (LP)",
  impostos_parcelados: "Impostos parcelados",
  outros_pnc: "Outros passivos não circulantes",
  capital_social: "Capital social",
  reservas: "Reservas",
  lucros_acumulados: "Lucros/prejuízos acumulados",
};
