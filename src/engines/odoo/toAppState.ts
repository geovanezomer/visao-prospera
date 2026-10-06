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
  RealizadoLedger,
  BalancoDetalhado,
  CostLine,
  DebtContract,
  RevenueDeducao,
} from "@/engines/finance/types";
import { bsValue, plValue } from "./mapping";
import type { CashFlow } from "@/engines/finance/cashflow";
import { finalizeCashFlow, periodLabels } from "@/engines/finance/anchor";
import { buildDRE } from "@/engines/finance/dre";
import { buildCashFlowEngine } from "@/engines/finance/cashflow";
import { deriveBalancoFechamentoEngine } from "@/engines/finance/balancoFechamento";
import { normalizeStateFromBalanco } from "@/engines/finance/balanco";
import { resolveEffectiveRegime } from "@/engines/finance/regime";
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
    // Todas as filiais da árvore (filial de filial também é do mesmo CNPJ raiz).
    const branches: OdooCompanyInfo[] = [];
    const walk = (pid: number, depth: number) => {
      if (depth > 20) return;
      for (const c of companies.filter((x) => x.parentId === pid)) {
        branches.push(c);
        walk(c.id, depth + 1);
      }
    };
    walk(r.id, 0);
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
  /** Saldo de cada grupo do balanço ao FIM de cada um dos 12 meses (alinhado à direita). */
  bsMonthly: Record<BsBucket, number[]>;
  /** Resultado contábil de cada mês (receitas − despesas, inclusive tributos). */
  resultadoMensal: number[];
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
 * termina no último mês fechado (data de bloqueio) ou no último mês completo
 * do retrato.
 */
function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mês fechado pela data de bloqueio ("yyyy-mm"), ou null. */
export function closedMonthOf(lockDate: string | null | undefined): string | null {
  if (!lockDate) return null;
  const d = new Date(`${lockDate}T00:00:00Z`);
  const next = new Date(d.getTime() + 86_400_000);
  return next.getUTCDate() === 1 ? lockDate.slice(0, 7) : prevMonth(lockDate.slice(0, 7));
}

export function resolveWindow(
  snapshot: OdooSnapshot,
  endMonth?: string | null,
  lockDate?: string | null,
): { start: number; end: number } {
  const months = snapshot.months;
  // Último mês COMPLETO: o mês da sincronização ainda está em andamento.
  let lastComplete = months.length - 1;
  if (months[lastComplete] >= snapshot.syncedAt.slice(0, 7) && lastComplete > 0) lastComplete -= 1;
  let end = lastComplete;
  if (endMonth) {
    // Escolha explícita do usuário (pode ser um mês aberto — a barra avisa).
    const idx = months.indexOf(endMonth);
    if (idx >= 0) end = idx;
  } else if (lockDate) {
    // Bloqueio no meio do mês não fecha o mês: vale o mês anterior.
    const d = new Date(`${lockDate}T00:00:00Z`);
    const next = new Date(d.getTime() + 86_400_000);
    const fechado =
      next.getUTCDate() === 1 ? lockDate.slice(0, 7) : prevMonth(lockDate.slice(0, 7));
    const idx = months.indexOf(fechado);
    // Só usa o bloqueio se ele estiver dentro do retrato e antes do mês corrente.
    if (idx >= 0 && idx <= lastComplete) end = idx;
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

  const bsMonthly = Object.fromEntries(BS_KEYS.map((k) => [k, zeros(12)])) as Record<
    BsBucket,
    number[]
  >;
  const resultadoMensal = zeros(12);

  for (const a of accounts) {
    let before = a.opening;
    for (let i = 0; i < window.start; i++) before += a.monthly[i] ?? 0;
    let atEnd = before;
    for (let i = window.start; i <= window.end; i++) atEnd += a.monthly[i] ?? 0;
    // Saldo ao fim de cada mês (meses antes de uma janela curta = abertura).
    let running = before;
    const endOf = zeros(12);
    for (let j = 0; j < 12; j++) {
      if (j >= offset) running += a.monthly[window.start + j - offset] ?? 0;
      endOf[j] = running;
    }
    if (a.cls.kind === "bs") {
      for (let j = 0; j < 12; j++) bsMonthly[a.cls.bucket][j] += bsValue(a.cls.bucket, endOf[j]);
    } else if (a.cls.kind === "pl") {
      for (let j = offset; j < 12; j++)
        resultadoMensal[j] -= a.monthly[window.start + j - offset] ?? 0;
      // Resultado acumulado ainda não transferido ao PL entra em lucros acumulados.
      for (let j = 0; j < 12; j++) bsMonthly.lucros_acumulados[j] -= endOf[j];
    }

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
    bsMonthly,
    resultadoMensal,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const clampDias = (d: number) => Math.round(Math.min(365, Math.max(0, d)));

/** Completa uma janela curta para 12 meses (meses anteriores, à esquerda). */
function padMonths(months: string[]): string[] {
  if (months.length >= 12 || !months.length) return months.slice(-12);
  const out = [...months];
  while (out.length < 12) {
    const [y, m] = out[0].split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    out.unshift(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
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
        // INSS patronal/RAT/terceiros (não FGTS): no Simples ficam dentro do DAS.
        cppPatronal:
          acc.line === "pessoal_encargos" &&
          !/fgts/i.test(acc.name) &&
          /inss|previd|social security|seguridade|\brat\b|\bsat\b|terceiros|sistema s|senai|sesc|sebrae|incra|sal[áa]rio[- ]educa/i.test(
            acc.name,
          ),
        label: `${COST_PREFIX[acc.line]}: ${clean}`,
        category: "despesa_administrativa",
        comportamento: "fixo",
      };
    case "despesa_administrativa":
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
  // Dívida ATUAL = saldo contábil no fim da janela (indicadores e valuation).
  const cp = Math.max(0, actuals.closing.emprestimos_cp);
  const lp = Math.max(0, actuals.closing.emprestimos_lp);
  const total = cp + lp;
  if (total <= 0) return [];
  const jurosAno = sum(actuals.pl.despesa_financeira);
  // Taxa aproximada: despesas financeiras ÷ dívida média do período.
  const media =
    (total +
      Math.max(0, actuals.opening.emprestimos_cp) +
      Math.max(0, actuals.opening.emprestimos_lp)) /
    2;
  const taxaAA = Math.min(60, Math.max(0, r2((jurosAno / (media || total)) * 100)));
  const out: DebtContract[] = [];
  if (cp > 0)
    out.push({
      id: "odoo:emprestimos-cp",
      credor: "Empréstimos de curto prazo (Odoo)",
      descricao: "Saldo contábil no fim do período; taxa estimada pelas despesas financeiras.",
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
      descricao: "Saldo contábil no fim do período; taxa estimada pelas despesas financeiras.",
      saldoDevedor: r2(lp),
      taxaAA,
      sistema: "price",
      prazoMeses: 36,
      tipoCredor: "banco",
    });
  return out;
}

/**
 * DFC do razão pelo método indireto, mês a mês, a partir do balanço mensal.
 * Como o balanço contábil fecha todo mês, a variação de caixa (caixa +
 * aplicações) é EXATAMENTE operacional + investimento + financiamento.
 */
export function buildLedgerCashFlow(
  a: OdooActuals,
  caixaMinimo: number,
  labels: string[],
): CashFlow {
  const B = a.bsMonthly;
  const p = a.pl;
  const prev = (k: BsBucket, j: number) => (j === 0 ? a.opening[k] : B[k][j - 1]);
  const d = (k: BsBucket, j: number) => B[k][j] - prev(k, j);
  const caixaFim = (j: number) => B.caixa[j] + B.aplicacoes[j];
  const caixaIni = (j: number) =>
    j === 0 ? a.opening.caixa + a.opening.aplicacoes : caixaFim(j - 1);
  const m = (f: (j: number) => number) => Array.from({ length: 12 }, (_, j) => f(j));

  const resultado = a.resultadoMensal;
  // Depreciação/amortização: a contrapartida (conta redutora) não é caixa.
  const naoCaixa = m((j) => -d("depreciacao_acumulada", j));
  const fluxoOperacional = m(
    (j) =>
      resultado[j] +
      naoCaixa[j] -
      d("contas_receber", j) -
      d("estoques", j) -
      d("impostos_recuperar", j) -
      d("despesas_antecipadas", j) -
      d("outros_ac", j) +
      d("fornecedores", j) +
      d("salarios_encargos", j) +
      d("impostos_pagar", j) +
      d("adiantamentos_clientes", j) +
      d("outros_pc", j),
  );
  const capex = m(
    (j) => d("imobilizado", j) + d("intangivel", j) + d("investimentos", j) + d("realizavel_lp", j),
  );
  const fluxoInvestimento = capex.map((v) => -v);
  const dividas = m(
    (j) =>
      d("emprestimos_cp", j) +
      d("emprestimos_lp", j) +
      d("impostos_parcelados", j) +
      d("outros_pnc", j),
  );
  // Patrimônio sem o resultado do mês: aportes (+) ou distribuições (−).
  const socios = m(
    (j) => d("capital_social", j) + d("reservas", j) + d("lucros_acumulados", j) - resultado[j],
  );
  const fluxoFinanciamento = m((j) => dividas[j] + socios[j]);

  // Detalhe operacional (soma = fluxo operacional; o resto vai em "fixos").
  const pessoal = m((j) => p.pessoal_salarios[j] + p.pessoal_encargos[j] + p.pessoal_beneficios[j]);
  const recebimentos = m(
    (j) =>
      p.receita_bruta[j] - p.deducoes[j] - d("contas_receber", j) + d("adiantamentos_clientes", j),
  );
  const pagamentosFornecedores = m((j) => p.cpv[j] + d("estoques", j) - d("fornecedores", j));
  const pagamentosFolha = m((j) => pessoal[j] - d("salarios_encargos", j));
  const pagamentosImpostos = m(
    (j) =>
      p.impostos_vendas[j] + p.ir_csll[j] - d("impostos_pagar", j) + d("impostos_recuperar", j),
  );
  const pagamentosFinanceiros = [...p.despesa_financeira];
  const receitasFinanceiras = [...p.receita_financeira];
  // Não operacionais (líquidas) — mesma coluna da DFC do motor.
  const outrasReceitasOperacionais = p.outras_receitas.map((v, j) => v - p.outras_despesas[j]);
  const pagamentosFixos = m(
    (j) =>
      recebimentos[j] +
      receitasFinanceiras[j] +
      outrasReceitasOperacionais[j] -
      pagamentosFornecedores[j] -
      pagamentosFolha[j] -
      pagamentosImpostos[j] -
      pagamentosFinanceiros[j] -
      fluxoOperacional[j],
  );
  const saldoInicial = m(caixaIni);
  const saldoFinal = m(caixaFim);
  const variacaoCaixa = m((j) => saldoFinal[j] - saldoInicial[j]);
  const z = zeros(12);
  const cf: CashFlow = {
    saldoInicial,
    recebimentos,
    receitasFinanceiras,
    outrasReceitasOperacionais,
    pagamentosFornecedores,
    pagamentosFixos,
    pagamentosVariaveis: [...z],
    pagamentosFolha,
    pagamentosFinanceiros,
    pagamentosImpostos,
    fluxoOperacional,
    aportes: socios.map((v) => Math.max(0, v)),
    emprestimosCaptados: dividas.map((v) => Math.max(0, v)),
    amortizacoes: dividas.map((v) => Math.max(0, -v)),
    dividendos: socios.map((v) => Math.max(0, -v)),
    fluxoFinanciamento,
    capex,
    fluxoInvestimento,
    permutasCredito: [...z],
    permutasDebito: [...z],
    permutasLiquido: [...z],
    variacaoCaixa,
    saldoFinal,
    alertas: [],
    contasReceberAnoSeguinte: a.closing.contas_receber,
    fornecedoresAnoSeguinte: a.closing.fornecedores,
    impostosAnoSeguinte: a.closing.impostos_pagar,
    totais: {} as CashFlow["totais"],
  };
  return finalizeCashFlow(cf, caixaMinimo, labels);
}

export type TaxReconciliation = {
  /** Impostos sobre vendas contabilizados no Odoo na janela. */
  impostosVendasOdoo: number;
  /** IRPJ + CSLL contabilizados no Odoo na janela. */
  irCsllOdoo: number;
};

export type ProductMixItem = { nome: string; receita: number; cmv: number };

export type OdooEntityData = {
  entity: OdooEntity;
  months: string[];
  actuals: OdooActuals;
  taxReconciliation: TaxReconciliation;
  /** Receita e custo por produto na janela (vazio se o Odoo não tem produto nas linhas). */
  products: ProductMixItem[];
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
    products: productMix(snapshot, entity.companyIds, window),
  };
}

/** Soma o mix de produtos das empresas na janela [start, end]. */
function productMix(
  snapshot: OdooSnapshot,
  companyIds: number[],
  window: { start: number; end: number },
): ProductMixItem[] {
  const map = new Map<string, ProductMixItem>();
  for (const cid of companyIds) {
    for (const p of snapshot.perCompany[String(cid)]?.products ?? []) {
      const key = p.productId === null ? `outros:${cid}` : `p:${p.productId}`;
      const it = map.get(key) ?? { nome: p.name, receita: 0, cmv: 0 };
      for (let i = window.start; i <= window.end; i++) {
        it.receita += p.revenue[i] ?? 0;
        it.cmv += p.cogs[i] ?? 0;
      }
      map.set(key, it);
    }
  }
  return [...map.values()]
    .filter((x) => Math.abs(x.receita) > 0.005 || Math.abs(x.cmv) > 0.005)
    .map((x) => ({ ...x, receita: r2(x.receita), cmv: r2(x.cmv) }))
    .sort((a, b) => b.receita - a.receita);
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
  revenue: Pick<
    AppState["revenue"],
    "bruta" | "brutaFixa" | "deducoes" | "receitasFinanceiras" | "inadimplencia"
  >;
  costs: CostLine[];
  capital: Partial<AppState["capital"]>;
  abertura: Partial<AppState["capital"]["abertura"]>;
  /** Prazos médios medidos no razão (dias). */
  prazos: { pmr: number; pmp: number };
  /** Realizado do razão (âncora dos motores; ajustes calculados em anchorOdooState). */
  realizado: RealizadoLedger;
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
      // Lei 6.404: outras receitas e despesas ficam abaixo do resultado
      // operacional (fora do EBITDA).
      id: "odoo:nao-operacional",
      label: "Outras receitas e despesas não operacionais (Odoo)",
      valores: pl.outras_receitas.map((v, i) => r2(v - pl.outras_despesas[i])),
      tipo: "nao_operacional",
    },
  ].filter((r) => r.valores.some((v) => v !== 0)) as RevenueDeducao[];

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
  const receitaAnual = sum(pl.receita_bruta);
  const cpvAnual = sum(pl.cpv);

  return {
    header: {
      companyName: entity.label,
      cnpj: entity.vat,
      fiscalYear: fy || null,
      periodoAnaliseMeses: 12,
    },
    revenue: {
      bruta: pl.receita_bruta.map(r2),
      brutaFixa: false,
      deducoes,
      receitasFinanceiras,
      // Perdas reais já estão na contabilidade — nada de inadimplência estimada.
      inadimplencia: zeros(12),
    },
    costs,
    capital: {
      depreciacaoMensal: r2(sum(pl.depreciacao) / 12),
      depreciacaoMensalSerie: pl.depreciacao.map(r2),
      capexAtivacao: [],
      // Balanço de abertura (o motor projeta o fechamento pelos fluxos).
      balanco: {
        ...toBalancoDetalhado(o, firstMonth ? `${firstMonth}-01` : undefined),
        anterior: undefined,
      },
      debtContracts: debtFromBalances(actuals),
      // Valuation: dívida líquida = dívida − caixa e aplicações do fechamento.
      caixaOcioso: r2(c.caixa + c.aplicacoes),
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
    prazos: {
      pmr: receitaAnual > 0 ? clampDias((c.contas_receber / receitaAnual) * 360) : 0,
      pmp: cpvAnual > 0 ? clampDias((c.fornecedores / cpvAnual) * 360) : 0,
    },
    realizado: {
      fonte: "odoo",
      meses: actuals.months.length === 12 ? actuals.months : padMonths(actuals.months),
      impostosVendas: pl.impostos_vendas.map(r2),
      impostosLucro: pl.ir_csll.map(r2),
      cf: buildLedgerCashFlow(actuals, 0, periodLabels({ meses: padMonths(actuals.months) })),
      balancoFechamento: toBalancoDetalhado(c, lastMonth ? `${lastMonth}-01` : undefined),
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
    realizado: ov.realizado,
    companyName: ov.header.companyName,
    cnpj: ov.header.cnpj ?? base.cnpj,
    fiscalYear: ov.header.fiscalYear ?? base.fiscalYear,
    periodoAnaliseMeses: ov.header.periodoAnaliseMeses,
    revenue: {
      ...base.revenue,
      ...ov.revenue,
      pmr: ov.prazos.pmr,
      pmp: ov.prazos.pmp,
      pmrMensal: undefined,
      pmpMensal: undefined,
    },
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

/**
 * Premissas iniciais de uma entidade do Odoo (só na primeira vez; depois
 * valem as que o usuário salvar). Setor e regime são inferidos do próprio
 * realizado: peso do CPV na receita e IRPJ/CSLL contabilizado fora do DAS.
 */
export function suggestPremissas(base: AppState, data: OdooEntityData): AppState {
  const { pl } = data.actuals;
  const receita = sum(pl.receita_bruta);
  const cpvPct = receita > 0 ? sum(pl.cpv) / receita : 0;
  const businessType = cpvPct > 0.25 ? "comercio" : "servicos";
  const irCsll = sum(pl.ir_csll);
  const regime: AppState["tax"]["regime"] =
    irCsll > 0
      ? receita > 78_000_000
        ? "real"
        : "presumido"
      : receita > 4_800_000
        ? "presumido"
        : "simples";
  // Alíquota efetiva de ICMS/ISS: impostos sobre vendas menos PIS/COFINS cumulativos.
  const pctVendas = receita > 0 ? (sum(pl.impostos_vendas) / receita) * 100 : 0;
  const issIcms =
    regime === "simples" ? base.tax.issIcms : Math.max(0, Math.round((pctVendas - 3.65) * 10) / 10);
  return {
    ...base,
    businessType,
    tax: {
      ...base.tax,
      regime,
      simplesAnexo: businessType === "comercio" ? "I" : "III",
      presumidoBaseIRPJ: businessType === "comercio" ? 8 : 32,
      presumidoBaseCSLL: businessType === "comercio" ? 12 : 32,
      issIcms: issIcms || base.tax.issIcms,
    },
  };
}

/**
 * Âncora no razão: calcula, para o estado-base (premissas + realizado do
 * Odoo), quanto o motor difere do contabilizado. Depois disso:
 *   - DRE, fluxo de caixa e fechamento do estado-base = Odoo (exato);
 *   - qualquer simulação derivada dele = Odoo + efeito das alavancas.
 * Devolve o estado já normalizado (idempotente).
 */
export function anchorOdooState(state: AppState): AppState {
  const r = state.realizado;
  if (!r) return state;
  const clean: RealizadoLedger = {
    fonte: r.fonte,
    meses: r.meses,
    impostosVendas: r.impostosVendas,
    impostosLucro: r.impostosLucro,
    cf: r.cf,
    balancoFechamento: r.balancoFechamento,
  };
  const s1 = normalizeStateFromBalanco({ ...state, realizado: clean });
  const regime = resolveEffectiveRegime(s1);
  const motor = buildDRE(s1, regime).dre;
  const s2: AppState = {
    ...s1,
    realizado: {
      ...clean,
      ajusteImpostosVendas: r.impostosVendas.map((v, i) => v - (motor.impostosVendas[i] ?? 0)),
      ajusteImpostosLucro: r.impostosLucro.map((v, i) => v - (motor.impostos[i] ?? 0)),
    },
  };
  const cfBase = buildCashFlowEngine(s2, regime);
  const dre2 = buildDRE(s2, regime).dre;
  const fechamentoBase = deriveBalancoFechamentoEngine({
    state: s2,
    dre: dre2,
    cf: cfBase,
  }).balanco;
  return { ...s2, realizado: { ...s2.realizado!, cfBase, fechamentoBase } };
}

/** Estado sem a âncora: tributos e fluxos 100% pelo motor (comparação/conciliação). */
export function withoutAnchor(state: AppState): AppState {
  return state.realizado ? { ...state, realizado: undefined } : state;
}
