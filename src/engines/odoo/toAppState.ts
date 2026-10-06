// ============================================================================
// Retrato do Odoo → AppState (a estrutura que todos os motores consomem).
//
// - Entidade fiscal = matriz + filiais (mesmo CNPJ raiz). É a unidade que
//   apura tributos; as filiais também podem ser vistas isoladas (gerencial).
// - Operações entre empresas do grupo são eliminadas ao agregar: dentro da
//   entidade (transferências matriz↔filial) e no consolidado do grupo.
// - O realizado (receitas, custos, despesas, balanço de abertura, dívidas)
//   vem do Odoo; premissas (regime, custo de capital, cenários...) continuam
//   do estado do usuário — ver `mergeOdooActuals`.
// - Impostos sobre vendas e IRPJ/CSLL NÃO viram linhas de custo: o motor os
//   calcula pelo regime configurado. O contabilizado no Odoo vai em
//   `taxReconciliation` para a conferência (contabilizado × calculado).
// ============================================================================
import type {
  AppState,
  BalancoDetalhado,
  CostLine,
  DebtContract,
  RevenueDeducao,
} from "@/engines/finance/types";
import { bsValue, plValue } from "./mapping";
import type { BsBucket, OdooCompanyInfo, OdooSnapshot, PlLine } from "./types";

export type OdooEntityKind = "entity" | "branch" | "consolidated";

export type OdooEntity = {
  /** "e:<id>" (matriz + filiais), "b:<id>" (filial isolada) ou "group". */
  key: string;
  kind: OdooEntityKind;
  label: string;
  companyIds: number[];
  /** Matriz da entidade fiscal (para filial: a matriz dela). */
  rootId: number | null;
  vat: string | null;
};

/** Conta agregada (soma das empresas da seleção, já sem operações internas). */
export type AggregatedAccount = {
  code: string;
  name: string;
  type: string;
  cls: OdooSnapshot["perCompany"][string]["accounts"][number]["cls"];
  monthly: number[];
  opening: number;
};

const zeros = (n: number) => Array.from({ length: n }, () => 0);

function cnpjRoot(vat: string | null): string | null {
  const d = (vat ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(0, 8) : null;
}

/** Entidades selecionáveis no cockpit: cada matriz (com filiais), cada filial e o grupo. */
export function listEntities(snapshot: OdooSnapshot): OdooEntity[] {
  const companies = snapshot.companies;
  const roots = companies.filter((c) => !c.parentId || !companies.some((p) => p.id === c.parentId));
  const out: OdooEntity[] = [];
  for (const r of roots) {
    const branches = companies.filter((c) => c.parentId === r.id);
    out.push({
      key: `e:${r.id}`,
      kind: "entity",
      label: branches.length ? `${r.name} (matriz + filiais)` : r.name,
      companyIds: [r.id, ...branches.map((b) => b.id)],
      rootId: r.id,
      vat: r.vat,
    });
    for (const b of branches) {
      out.push({
        key: `b:${b.id}`,
        kind: "branch",
        label: `${b.name} (filial — visão gerencial)`,
        companyIds: [b.id],
        rootId: r.id,
        vat: b.vat,
      });
    }
  }
  if (roots.length > 1) {
    out.push({
      key: "group",
      kind: "consolidated",
      label: "Consolidado do grupo",
      companyIds: companies.map((c) => c.id),
      rootId: null,
      vat: null,
    });
  }
  return out;
}

/**
 * Soma as contas das empresas da seleção e elimina as operações entre elas
 * (lançamentos cujo parceiro é outra empresa da própria seleção).
 */
export function aggregateAccounts(
  snapshot: OdooSnapshot,
  companyIds: number[],
): AggregatedAccount[] {
  const n = snapshot.months.length;
  const ids = new Set(companyIds.map(String));
  const byCode = new Map<string, AggregatedAccount>();
  for (const cid of companyIds) {
    const comp = snapshot.perCompany[String(cid)];
    if (!comp) continue;
    for (const a of comp.accounts) {
      let acc = byCode.get(a.code);
      if (!acc) {
        acc = {
          code: a.code,
          name: a.name,
          type: a.type,
          cls: a.cls,
          monthly: zeros(n),
          opening: 0,
        };
        byCode.set(a.code, acc);
      }
      acc.opening += a.opening;
      for (let i = 0; i < n; i++) acc.monthly[i] += a.monthly[i] ?? 0;
    }
    // Eliminação: o que esta empresa lançou contra outra empresa da seleção.
    for (const ic of comp.intercompany.lines) {
      if (!ids.has(String(ic.counterpartCompanyId))) continue;
      const acc = byCode.get(ic.code);
      if (!acc) continue;
      acc.opening -= ic.opening;
      for (let i = 0; i < n; i++) acc.monthly[i] -= ic.monthly[i] ?? 0;
    }
  }
  return [...byCode.values()];
}

export type OdooActuals = {
  months: string[];
  pl: Record<PlLine, number[]>;
  plAccounts: Array<{ code: string; name: string; line: PlLine; values: number[] }>;
  /** Saldos por grupo do balanço antes do 1º mês da janela (abertura). */
  opening: Record<BsBucket, number>;
  /** Saldos por grupo ao fim do último mês da janela (fechamento real). */
  closing: Record<BsBucket, number>;
  /** Resultado acumulado de todos os períodos até a abertura / fechamento. */
  resultadoAteAbertura: number;
  resultadoAteFechamento: number;
};

const PL_KEYS: PlLine[] = [
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
];

const BS_KEYS: BsBucket[] = [
  "caixa",
  "aplicacoes",
  "contas_receber",
  "estoques",
  "impostos_recuperar",
  "despesas_antecipadas",
  "outros_ac",
  "realizavel_lp",
  "investimentos",
  "imobilizado",
  "depreciacao_acumulada",
  "intangivel",
  "fornecedores",
  "salarios_encargos",
  "impostos_pagar",
  "emprestimos_cp",
  "adiantamentos_clientes",
  "outros_pc",
  "emprestimos_lp",
  "impostos_parcelados",
  "outros_pnc",
  "capital_social",
  "reservas",
  "lucros_acumulados",
];

/**
 * Janela de 12 meses terminando em `endMonth` ("yyyy-mm"); sem `endMonth`,
 * termina no último mês fechado (data de bloqueio) ou no último do retrato.
 */
export function resolveWindow(
  snapshot: OdooSnapshot,
  endMonth?: string | null,
  lockDate?: string | null,
): { start: number; end: number } {
  const months = snapshot.months;
  let end = months.length - 1;
  const target = endMonth ?? (lockDate ? lockDate.slice(0, 7) : null);
  if (target) {
    const idx = months.indexOf(target);
    if (idx >= 0) end = idx;
  }
  return { start: Math.max(0, end - 11), end };
}

/** Realizado de uma seleção de contas numa janela [start, end] de meses. */
export function computeActuals(
  snapshot: OdooSnapshot,
  accounts: AggregatedAccount[],
  window: { start: number; end: number },
): OdooActuals {
  const len = window.end - window.start + 1;
  const pl = Object.fromEntries(PL_KEYS.map((k) => [k, zeros(12)])) as Record<PlLine, number[]>;
  const opening = Object.fromEntries(BS_KEYS.map((k) => [k, 0])) as Record<BsBucket, number>;
  const closing = Object.fromEntries(BS_KEYS.map((k) => [k, 0])) as Record<BsBucket, number>;
  const plAccounts: OdooActuals["plAccounts"] = [];
  let resultadoAteAbertura = 0;
  let resultadoAteFechamento = 0;
  // Alinha à direita: janelas menores que 12 meses ficam nos últimos meses.
  const offset = 12 - len;

  for (const a of accounts) {
    let before = a.opening;
    for (let i = 0; i < window.start; i++) before += a.monthly[i] ?? 0;
    let atEnd = before;
    for (let i = window.start; i <= window.end; i++) atEnd += a.monthly[i] ?? 0;

    if (a.cls.kind === "pl") {
      const line = a.cls.line;
      const values = zeros(12);
      for (let i = 0; i < len; i++)
        values[offset + i] = plValue(line, a.monthly[window.start + i] ?? 0);
      for (let i = 0; i < 12; i++) pl[line][i] += values[i];
      if (values.some((v) => Math.abs(v) > 0.005))
        plAccounts.push({ code: a.code, name: a.name, line, values });
      resultadoAteAbertura -= before;
      resultadoAteFechamento -= atEnd;
    } else if (a.cls.kind === "bs") {
      opening[a.cls.bucket] += bsValue(a.cls.bucket, before);
      closing[a.cls.bucket] += bsValue(a.cls.bucket, atEnd);
    }
  }
  // Resultado ainda não transferido para o PL entra em lucros acumulados.
  opening.lucros_acumulados += resultadoAteAbertura;
  closing.lucros_acumulados += resultadoAteFechamento;
  return {
    months: snapshot.months.slice(window.start, window.end + 1),
    pl,
    plAccounts,
    opening,
    closing,
    resultadoAteAbertura,
    resultadoAteFechamento,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function toBalancoDetalhado(b: Record<BsBucket, number>, dataBase?: string): BalancoDetalhado {
  return {
    dataBase,
    ativoCirculante: {
      caixaEquivalentes: r2(b.caixa),
      aplicacoesFinanceirasCP: r2(b.aplicacoes),
      contasReceberClientes: r2(b.contas_receber),
      estoques: r2(b.estoques),
      impostosRecuperar: r2(b.impostos_recuperar),
      despesasAntecipadas: r2(b.despesas_antecipadas),
      outrosAtivosCirculantes: r2(b.outros_ac),
    },
    ativoNaoCirculante: {
      realizavelLP: { outros: r2(b.realizavel_lp) },
      investimentos: r2(b.investimentos),
      imobilizado: {
        outrosImobilizados: r2(b.imobilizado),
        // O motor espera a depreciação acumulada como valor positivo a deduzir.
        depreciacaoAcumulada: r2(Math.abs(b.depreciacao_acumulada)),
      },
      intangivel: { outrosIntangiveis: r2(b.intangivel) },
    },
    passivoCirculante: {
      fornecedores: r2(b.fornecedores),
      emprestimosFinanciamentosCP: r2(b.emprestimos_cp),
      impostosPagar: r2(b.impostos_pagar),
      salariosEncargos: r2(b.salarios_encargos),
      adiantamentosClientes: r2(b.adiantamentos_clientes),
      outrosPassivosCirculantes: r2(b.outros_pc),
    },
    passivoNaoCirculante: {
      emprestimosFinanciamentosLP: r2(b.emprestimos_lp),
      impostosParcelados: r2(b.impostos_parcelados),
      outrasObrigacoesLP: r2(b.outros_pnc),
    },
    patrimonioLiquido: {
      capitalSocial: r2(b.capital_social),
      reservasLucros: r2(b.reservas),
      lucrosPrejuizosAcumulados: r2(b.lucros_acumulados),
    },
  };
}

const COST_PREFIX: Partial<Record<PlLine, string>> = {
  pessoal_salarios: "Folha",
  pessoal_encargos: "Folha (encargos)",
  pessoal_beneficios: "Benefícios",
};

function costLineFor(acc: OdooActuals["plAccounts"][number]): CostLine | null {
  const base = {
    id: `odoo:${acc.code}`,
    values: acc.values.map(r2),
    fixed: false,
    encargosAuto: false,
    custom: false,
  };
  const clean = acc.name.replace(/^\(-\)\s*/, "");
  switch (acc.line) {
    case "cpv":
      return { ...base, label: clean, category: "custo_vendas", comportamento: "variavel" };
    case "pessoal_salarios": {
      const isProLabore = /pr[óo]-?\s*labore|administrador|managers|diretoria/i.test(acc.name);
      return {
        ...base,
        label: isProLabore ? `Pró-labore: ${clean}` : `${COST_PREFIX.pessoal_salarios}: ${clean}`,
        category: "despesa_administrativa",
        comportamento: "fixo",
      };
    }
    case "pessoal_encargos":
    case "pessoal_beneficios":
      return {
        ...base,
        label: `${COST_PREFIX[acc.line]}: ${clean}`,
        category: "despesa_administrativa",
        comportamento: "fixo",
      };
    case "despesa_administrativa":
    case "outras_despesas":
      return { ...base, label: clean, category: "despesa_administrativa", comportamento: "fixo" };
    case "despesa_comercial":
      return { ...base, label: clean, category: "despesa_comercial", comportamento: "variavel" };
    case "despesa_financeira":
      return { ...base, label: clean, category: "financeiro", comportamento: "fixo" };
    default:
      return null; // receitas, deduções, impostos, depreciação e IR/CSLL têm destino próprio
  }
}

/** Contratos sintéticos a partir dos saldos de empréstimos (taxa estimada pelos juros). */
function debtFromBalances(actuals: OdooActuals): DebtContract[] {
  const cp = Math.max(0, actuals.opening.emprestimos_cp);
  const lp = Math.max(0, actuals.opening.emprestimos_lp);
  const total = cp + lp;
  if (total <= 0) return [];
  const jurosAno = sum(actuals.pl.despesa_financeira);
  const taxaAA = Math.min(60, Math.max(0, r2((jurosAno / total) * 100)));
  const out: DebtContract[] = [];
  if (cp > 0)
    out.push({
      id: "odoo:emprestimos-cp",
      credor: "Empréstimos de curto prazo (Odoo)",
      descricao: "Saldo contábil na abertura; taxa estimada pelas despesas financeiras.",
      saldoDevedor: r2(cp),
      taxaAA,
      sistema: "price",
      prazoMeses: 12,
      tipoCredor: "banco",
    });
  if (lp > 0)
    out.push({
      id: "odoo:emprestimos-lp",
      credor: "Empréstimos de longo prazo (Odoo)",
      descricao: "Saldo contábil na abertura; taxa estimada pelas despesas financeiras.",
      saldoDevedor: r2(lp),
      taxaAA,
      sistema: "price",
      prazoMeses: 36,
      tipoCredor: "banco",
    });
  return out;
}

export type TaxReconciliation = {
  /** Impostos sobre vendas contabilizados no Odoo na janela. */
  impostosVendasOdoo: number;
  /** IRPJ + CSLL contabilizados no Odoo na janela. */
  irCsllOdoo: number;
};

export type OdooEntityData = {
  entity: OdooEntity;
  months: string[];
  actuals: OdooActuals;
  taxReconciliation: TaxReconciliation;
};

export function buildEntityData(
  snapshot: OdooSnapshot,
  entity: OdooEntity,
  endMonth?: string | null,
): OdooEntityData {
  const lockDate = entity.rootId
    ? (snapshot.companies.find((c) => c.id === entity.rootId)?.lockDate ?? null)
    : minLockDate(snapshot.companies);
  const window = resolveWindow(snapshot, endMonth, lockDate);
  const actuals = computeActuals(snapshot, aggregateAccounts(snapshot, entity.companyIds), window);
  return {
    entity,
    months: actuals.months,
    actuals,
    taxReconciliation: {
      impostosVendasOdoo: r2(sum(actuals.pl.impostos_vendas)),
      irCsllOdoo: r2(sum(actuals.pl.ir_csll)),
    },
  };
}

function minLockDate(companies: OdooCompanyInfo[]): string | null {
  const ds = companies.map((c) => c.lockDate).filter((d): d is string => Boolean(d));
  return ds.length ? ds.sort()[0] : null;
}

/**
 * Partes do AppState que vêm do Odoo, montadas UMA vez por retrato/entidade.
 * As referências ficam estáveis entre renders: efeitos das abas que dependem
 * delas (ex.: contratos de dívida) não disparam de novo a cada edição de
 * premissa — o que geraria laço de atualização.
 */
export type OdooOverlay = {
  header: Pick<AppState, "companyName" | "periodoAnaliseMeses"> & {
    cnpj: string | null;
    fiscalYear: number | null;
  };
  revenue: Pick<AppState["revenue"], "bruta" | "brutaFixa" | "deducoes" | "receitasFinanceiras">;
  costs: CostLine[];
  capital: Partial<AppState["capital"]>;
  abertura: Partial<AppState["capital"]["abertura"]>;
};

export function prepareOdooOverlay(data: OdooEntityData): OdooOverlay {
  const { actuals, entity } = data;
  const { pl } = actuals;
  const deducoes: RevenueDeducao[] = sum(pl.deducoes)
    ? [
        {
          id: "odoo:deducoes",
          label: "Devoluções e abatimentos (Odoo)",
          valores: pl.deducoes.map(r2),
        },
      ]
    : [];
  const receitasFinanceiras: RevenueDeducao[] = [
    {
      id: "odoo:receitas-financeiras",
      label: "Receitas financeiras (Odoo)",
      valores: pl.receita_financeira.map(r2),
      tipo: "financeira",
    },
    {
      id: "odoo:outras-receitas",
      label: "Outras receitas (Odoo)",
      valores: pl.outras_receitas.map(r2),
      tipo: "operacional",
    },
  ].filter((r) => sum(r.valores) !== 0) as RevenueDeducao[];

  const costs = actuals.plAccounts
    .map(costLineFor)
    .filter((c): c is CostLine => c !== null)
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));

  const o = actuals.opening;
  const c = actuals.closing;
  const ativoTotal = (b: Record<BsBucket, number>) =>
    b.caixa +
    b.aplicacoes +
    b.contas_receber +
    b.estoques +
    b.impostos_recuperar +
    b.despesas_antecipadas +
    b.outros_ac +
    b.realizavel_lp +
    b.investimentos +
    b.imobilizado +
    b.depreciacao_acumulada +
    b.intangivel;
  const pl_ = (b: Record<BsBucket, number>) => b.capital_social + b.reservas + b.lucros_acumulados;
  const ac = (b: Record<BsBucket, number>) =>
    b.caixa +
    b.aplicacoes +
    b.contas_receber +
    b.estoques +
    b.impostos_recuperar +
    b.despesas_antecipadas +
    b.outros_ac;
  const pc = (b: Record<BsBucket, number>) =>
    b.fornecedores +
    b.salarios_encargos +
    b.impostos_pagar +
    b.emprestimos_cp +
    b.adiantamentos_clientes +
    b.outros_pc;

  const firstMonth = actuals.months[0];
  const lastMonth = actuals.months[actuals.months.length - 1];
  const [fy] = (lastMonth ?? "").split("-").map(Number);

  return {
    header: {
      companyName: entity.label,
      cnpj: entity.vat,
      fiscalYear: fy || null,
      periodoAnaliseMeses: 12,
    },
    revenue: { bruta: pl.receita_bruta.map(r2), brutaFixa: false, deducoes, receitasFinanceiras },
    costs,
    capital: {
      depreciacaoMensal: r2(sum(pl.depreciacao) / 12),
      capexAtivacao: [],
      // Balanço de abertura (o motor projeta o fechamento pelos fluxos).
      balanco: {
        ...toBalancoDetalhado(o, firstMonth ? `${firstMonth}-01` : undefined),
        anterior: undefined,
      },
      debtContracts: debtFromBalances(actuals),
      patrimonioLiquidoAbertura: r2(pl_(o)),
      ativoTotalAbertura: r2(ativoTotal(o)),
      patrimonioLiquido: r2(pl_(c)),
      ativoTotal: r2(ativoTotal(c)),
      disponibilidades: r2(c.caixa + c.aplicacoes),
      contasReceber: r2(c.contas_receber),
      estoques: r2(c.estoques),
      estoqueInicial: r2(o.estoques),
      estoqueFinal: r2(c.estoques),
      fornecedores: r2(c.fornecedores),
      ativoCirculante: r2(ac(c)),
      passivoCirculante: r2(pc(c)),
    },
    abertura: {
      impostosRecuperar: r2(o.impostos_recuperar),
      lucrosAcumulados: r2(o.lucros_acumulados),
      depreciacaoAcumulada: r2(Math.abs(o.depreciacao_acumulada)),
    },
  };
}

/**
 * Sobrepõe o realizado do Odoo a um estado do usuário (que guarda as
 * premissas). Campos de realizado são substituídos; premissas preservadas.
 */
export function applyOdooOverlay(base: AppState, ov: OdooOverlay): AppState {
  return {
    ...base,
    companyName: ov.header.companyName,
    cnpj: ov.header.cnpj ?? base.cnpj,
    fiscalYear: ov.header.fiscalYear ?? base.fiscalYear,
    periodoAnaliseMeses: ov.header.periodoAnaliseMeses,
    revenue: { ...base.revenue, ...ov.revenue },
    costs: ov.costs,
    capital: {
      ...base.capital,
      ...ov.capital,
      abertura: { ...base.capital.abertura, ...ov.abertura },
    },
  };
}

export function mergeOdooActuals(base: AppState, data: OdooEntityData): AppState {
  return applyOdooOverlay(base, prepareOdooOverlay(data));
}
