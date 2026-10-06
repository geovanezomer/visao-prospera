// ============================================================================
// Retrato (snapshot) dos dados contábeis lidos do Odoo.
//
// Montado no servidor a cada sincronização (lib/odoo/sync.server.ts) e
// guardado no banco. É a única coisa que o cockpit lê no modo Odoo — o app
// nunca consulta o Odoo durante a navegação.
//
// Convenção de sinal: `balance` = débito − crédito (padrão do Odoo).
// ============================================================================

/** Linha do resultado (DRE) a que uma conta contábil pertence. */
export type PlLine =
  | "receita_bruta"
  | "deducoes"
  | "impostos_vendas"
  | "cpv"
  | "pessoal_salarios"
  | "pessoal_encargos"
  | "pessoal_beneficios"
  | "despesa_administrativa"
  | "despesa_comercial"
  | "depreciacao"
  | "receita_financeira"
  | "despesa_financeira"
  | "outras_receitas"
  | "outras_despesas"
  | "ir_csll";

/** Grupo do balanço a que uma conta pertence. */
export type BsBucket =
  | "caixa"
  | "aplicacoes"
  | "contas_receber"
  | "estoques"
  | "impostos_recuperar"
  | "despesas_antecipadas"
  | "outros_ac"
  | "realizavel_lp"
  | "investimentos"
  | "imobilizado"
  | "depreciacao_acumulada"
  | "intangivel"
  | "fornecedores"
  | "salarios_encargos"
  | "impostos_pagar"
  | "emprestimos_cp"
  | "adiantamentos_clientes"
  | "outros_pc"
  | "emprestimos_lp"
  | "impostos_parcelados"
  | "outros_pnc"
  | "capital_social"
  | "reservas"
  | "lucros_acumulados";

export type AccountClass =
  | { kind: "pl"; line: PlLine }
  | { kind: "bs"; bucket: BsBucket }
  | { kind: "ignore" };

export type OdooCompanyInfo = {
  id: number;
  name: string;
  /** CNPJ só com dígitos (ou null). */
  vat: string | null;
  /** Matriz, quando esta empresa é filial (branch) no Odoo. */
  parentId: number | null;
  /** res.partner da empresa — identifica operações entre empresas do grupo. */
  partnerId: number | null;
  currency: string;
  /** Último dia bloqueado (meses até aqui estão fechados), ISO yyyy-mm-dd. */
  lockDate: string | null;
};

export type OdooAccountSnapshot = {
  id: number;
  code: string;
  name: string;
  type: string;
  cls: AccountClass;
  /** Movimento por mês (balance), alinhado com `OdooSnapshot.months`. */
  monthly: number[];
  /** Saldo antes do primeiro mês da janela. */
  opening: number;
};

/**
 * Lançamentos desta empresa cujo parceiro é OUTRA empresa do grupo, por
 * conta. Usados para eliminar operações internas ao agregar empresas.
 */
export type OdooIntercompanyLine = {
  counterpartCompanyId: number;
  code: string;
  /** Movimento por mês (balance), alinhado com `OdooSnapshot.months`. */
  monthly: number[];
  /** Saldo antes do primeiro mês da janela. */
  opening: number;
};

export type OdooIntercompany = { lines: OdooIntercompanyLine[] };

export type OdooCompanySnapshot = {
  accounts: OdooAccountSnapshot[];
  intercompany: OdooIntercompany;
  /** Lançamentos em rascunho na janela (não entram nos números). */
  draftCount?: number;
  /** Lançamentos de encerramento/apuração do resultado excluídos do retrato. */
  closingMovesExcluded?: number;
  /** Receita e custo por produto (40 maiores + "Outros"), por mês do retrato. */
  products?: OdooProductLine[];
};

export type OdooProductLine = {
  productId: number | null;
  name: string;
  /** Receita bruta por mês (positiva), alinhada com `OdooSnapshot.months`. */
  revenue: number[];
  /** Custo dos produtos vendidos por mês (positivo). */
  cogs: number[];
};

export type OdooSnapshot = {
  version: 1;
  syncedAt: string;
  serverVersion: string | null;
  /** Meses da janela, "yyyy-mm", em ordem. */
  months: string[];
  companies: OdooCompanyInfo[];
  perCompany: Record<string, OdooCompanySnapshot>;
  /** Última reclassificação manual aplicada a este retrato (ISO). */
  revisedAt?: string;
};

/** Ajuste manual de classificação, por código de conta. */
export type AccountOverride = { code: string; target: PlLine | BsBucket | "ignore" };
