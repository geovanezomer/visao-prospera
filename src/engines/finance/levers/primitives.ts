// =====================================================================
// Catálogo de PRIMITIVAS de alavanca financeira.
//
// Cada primitiva é uma função PURA (state, params) => newState.
// Schemas Zod validam params (futuro: tool calling da IA propositiva).
// O registry `LEVER_REGISTRY` expõe um catálogo tipado e descrito,
// reutilizável tanto pelo `prescriptive.ts` (regras hardcoded hoje)
// quanto, em fases futuras, pela camada de IA propositiva.
//
// REGRA DE OURO: a IA NUNCA calcula nada aqui — apenas escolhe qual
// primitiva chamar e com quais params. O cálculo é determinístico.
// =====================================================================
import { z } from "zod";
import { sumContractSaldos } from "../debtContracts";
import type { AppState, CostLine } from "../types";
import { sum, genId } from "../format";
import {
  PROLABORE_RE,
  TERCEIRIZACAO_RE,
  effectiveMonthValues,
  isFolhaCost,
  monthValues,
} from "../costs";
import { resolveEffectiveRegime } from "../regime";

// --------------------------------------------------------------------
// Helpers de baixo nível (não fazem parte do registry — uso interno).
// --------------------------------------------------------------------

/** Clona profundamente a lista de custos (e seus arrays `values`). */
export const cloneCosts = (costs: CostLine[]) =>
  costs.map((c) => ({ ...c, values: c.values.slice() }));

/** Top-N linhas FIXAS por total anual (desc). */
export function topNFixedLines(state: AppState, n: number): CostLine[] {
  return state.costs
    .filter((c) => c.category === "fixo" || c.category === "despesa_administrativa")
    .map((c) => ({ c, total: sum(monthValues(c)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
    .map((x) => x.c);
}

/**
 * Posições CLT: linhas de folha do motor (`isFolhaCost`), sem pró-labore (sócio
 * não é desligado) nem terceirização por PJ (contrato, não emprego).
 * `totalMensal` inclui os encargos automáticos, como a DRE; `baseMensal` é a
 * soma dos salários lançados; `posicoes` conta as linhas com valor.
 */
export function laborCltLinesTotal(state: AppState): {
  lines: CostLine[];
  totalMensal: number;
  baseMensal: number;
  posicoes: number;
} {
  const regime = resolveEffectiveRegime(state);
  const opts = { simplesAnexo: state.tax?.simplesAnexo };
  const lines = state.costs.filter(
    (c) =>
      isFolhaCost(c) &&
      !PROLABORE_RE.test(c.label) &&
      !(TERCEIRIZACAO_RE.test(c.label) && !c.encargosAuto),
  );
  let totalMensal = 0;
  let baseMensal = 0;
  let posicoes = 0;
  for (const c of lines) {
    const efetivo = sum(effectiveMonthValues(c, regime, opts)) / 12;
    const base = sum(effectiveMonthValues({ ...c, encargosAuto: false }, regime, opts)) / 12;
    totalMensal += efetivo;
    baseMensal += base;
    if (efetivo > 0) posicoes += 1;
  }
  return { lines, totalMensal, baseMensal, posicoes };
}

/**
 * Custo rescisório sem justa causa (CLT) — estimativa conservadora:
 *   Aviso indenizado (1 salário) + 13º proporcional + férias + 1/3 (~4/3 salário)
 *   + multa FGTS 40% sobre 8% × meses trabalhados.
 */
export function severanceCostPerPosition(salarioBase: number, mesesTrabalhados = 24): number {
  const aviso = salarioBase;
  const decimoTerceiro = salarioBase;
  const feriasMais1_3 = salarioBase * (4 / 3);
  const multaFgts = salarioBase * 0.08 * mesesTrabalhados * 0.4;
  return aviso + decimoTerceiro + feriasMais1_3 + multaFgts;
}

// --------------------------------------------------------------------
// Primitivas (pure mutators sobre AppState).
// --------------------------------------------------------------------

/** Escala uma linha de custo específica por um fator multiplicador. */
export function scaleLine(state: AppState, id: string, factor: number): AppState {
  const costs = cloneCosts(state.costs).map((c) =>
    c.id === id ? { ...c, values: c.values.map((v) => v * factor) } : c,
  );
  return { ...state, costs };
}

/**
 * Escala todas as linhas de uma categoria.
 * NOTA: para `custo_vendas` também escala `direto_venda` (ambas viram CPV no DRE).
 */
export function scaleCategory(
  state: AppState,
  category: CostLine["category"],
  factor: number,
): AppState {
  const isCpvTarget = category === "custo_vendas";
  // Aliases legados ↔ canônicos (fixo↔despesa_administrativa, variavel↔despesa_comercial).
  const ALIAS: Partial<Record<CostLine["category"], CostLine["category"]>> = {
    fixo: "despesa_administrativa",
    despesa_administrativa: "fixo",
    variavel: "despesa_comercial",
    despesa_comercial: "variavel",
  };
  const costs = cloneCosts(state.costs).map((c) => {
    const hit = isCpvTarget
      ? c.category === "custo_vendas" || c.category === "direto_venda"
      : c.category === category || c.category === ALIAS[category];
    return hit ? { ...c, values: c.values.map((v) => v * factor) } : c;
  });
  return { ...state, costs };
}

/** Ajusta PMR (prazo médio de recebimento, em dias). */
export function setPmr(state: AppState, newPmr: number): AppState {
  return { ...state, revenue: { ...state.revenue, pmr: Math.max(0, newPmr) } };
}

/** Ajusta PMP (prazo médio de pagamento, em dias). */
export function setPmp(state: AppState, newPmp: number): AppState {
  return { ...state, revenue: { ...state.revenue, pmp: Math.max(0, newPmp) } };
}

/** Escala a receita bruta por um fator multiplicador. */
export function adjustRevenue(state: AppState, factor: number): AppState {
  return {
    ...state,
    revenue: { ...state.revenue, bruta: state.revenue.bruta.map((v) => v * factor) },
  };
}

/**
 * Adiciona empréstimo via tabela PRICE REAL:
 *  juros_t = saldo_{t-1} × i ; amort_t = PMT − juros_t ; saldo_t = saldo_{t-1} − amort_t.
 * Atualiza: cashflow (captação + amortização)
 *           e a linha "juros sobre empréstimos" do DRE com os juros do mês.
 */
export function addLoan(
  state: AppState,
  principal: number,
  taxaMensal: number,
  prazoMeses: number,
  monthIdx = 0,
): AppState {
  const i = taxaMensal / 100;
  const pmt =
    i === 0 ? principal / prazoMeses : principal * (i / (1 - Math.pow(1 + i, -prazoMeses)));

  const cashflow = { ...state.cashflow };
  cashflow.emprestimosCaptados = state.cashflow.emprestimosCaptados.map((v, idx) =>
    idx === monthIdx ? v + principal : v,
  );
  cashflow.amortizacoes = state.cashflow.amortizacoes.slice();

  const costs = cloneCosts(state.costs);
  let jurosLine = costs.find((c) => /juros/i.test(c.label));
  if (!jurosLine) {
    jurosLine = {
      id: genId("juros_"),
      label: "Juros sobre empréstimos",
      category: "financeiro",
      values: Array(12).fill(0),
      fixed: false,
      custom: true,
    };
    costs.push(jurosLine);
  } else {
    jurosLine.fixed = false;
    jurosLine.values = jurosLine.values.slice();
  }

  let saldo = principal;
  for (let k = 0; k < prazoMeses; k++) {
    const idx = monthIdx + k;
    if (idx >= 12) break;
    const juros = saldo * i;
    const amort = pmt - juros;
    jurosLine.values[idx] = (jurosLine.values[idx] || 0) + juros;
    cashflow.amortizacoes[idx] = (cashflow.amortizacoes[idx] || 0) + amort;
    saldo -= amort;
  }

  const capital = { ...state.capital };
  return { ...state, costs, cashflow, capital };
}

/** Quita parte do principal usando caixa: reduz dívida + juros futuros proporcionalmente. */
export function payDownDebt(state: AppState, pct: number): AppState {
  const safePct = Math.min(Math.max(pct, 0), 1);
  const originalDivida = sumContractSaldos(state.capital.debtContracts);
  const capital = {
    ...state.capital,
    debtContracts: (state.capital.debtContracts ?? []).map((c) => ({
      ...c,
      saldoDevedor: Math.max(0, (c.saldoDevedor || 0) * (1 - safePct)),
    })),
  };
  const costs = cloneCosts(state.costs).map((c) =>
    c.category === "financeiro" && /juros/i.test(c.label)
      ? { ...c, values: c.values.map((v) => v * (1 - safePct)) }
      : c,
  );
  const cashUsed = originalDivida * safePct;
  const cashflow = { ...state.cashflow };
  cashflow.amortizacoes = state.cashflow.amortizacoes.slice();
  cashflow.amortizacoes[0] = (cashflow.amortizacoes[0] || 0) + cashUsed;
  return { ...state, costs, cashflow, capital };
}

/** Troca o regime tributário. */
export function switchRegime(state: AppState, regime: AppState["tax"]["regime"]): AppState {
  return { ...state, tax: { ...state.tax, regime } };
}

/** Reduz folha CLT pelo equivalente a N posições ao custo médio informado. */
export function reduceLaborByPositions(
  state: AppState,
  positions: number,
  custoMedioPosicao: number,
): AppState {
  const { lines, totalMensal } = laborCltLinesTotal(state);
  if (lines.length === 0 || totalMensal <= 0) return state;
  const corteMensal = Math.min(positions * custoMedioPosicao, totalMensal);
  const factor = 1 - corteMensal / totalMensal;
  const costs = cloneCosts(state.costs).map((c) =>
    lines.some((l) => l.id === c.id) ? { ...c, values: c.values.map((v) => v * factor) } : c,
  );
  return { ...state, costs };
}

/** Demissão com custo rescisório one-shot + redução estrutural da folha.
 *  A rescisão é lançada como CUSTO FIXO one-shot no mês `monthIdx` (passa pelo
 *  DRE, reduz EBITDA e a base de IR/CSLL no período, e impacta o FCO via
 *  conciliação caixa-DRE). NÃO usar `cashflow.amortizacoes` — esse bucket é
 *  pagamento de principal de dívida (FCFF) e distorceria endividamento. */
export function dismissWithSeverance(
  state: AppState,
  positions: number,
  salarioBase: number,
  monthIdx = 0,
): AppState {
  const severance = severanceCostPerPosition(salarioBase) * positions;
  if (severance <= 0 || positions <= 0) return state;
  // A folha deixa de pagar o salário E os encargos de cada posição desligada.
  const { totalMensal, baseMensal } = laborCltLinesTotal(state);
  const fatorEncargos = baseMensal > 0 ? totalMensal / baseMensal : 1;
  const novo = reduceLaborByPositions(state, positions, salarioBase * fatorEncargos);
  const values = Array<number>(12).fill(0);
  const idx = Math.max(0, Math.min(11, monthIdx));
  values[idx] = severance;
  const rescisaoLine: CostLine = {
    id: genId("rescisao_oneshot"),
    label: "Rescisões e indenizações (one-shot)",
    category: "despesa_administrativa",
    subcategory: "pessoal",
    values,
    fixed: false, // one-shot: NÃO é mensalizado; apenas no mês indicado
    comportamento: "fixo",
    custom: true,
  };
  const costs = [...cloneCosts(novo.costs), rescisaoLine];
  return { ...novo, costs };
}

/** Escala um conjunto arbitrário de linhas de custo (por IDs) por um fator. */
export function scaleCostLines(state: AppState, ids: Set<string>, factor: number): AppState {
  const costs = cloneCosts(state.costs).map((c) =>
    ids.has(c.id) ? { ...c, values: c.values.map((v) => v * factor) } : c,
  );
  return { ...state, costs };
}

/** Escala todas as linhas de folha CLT por um fator (ex.: 0.95 para -5%). */
export function scaleLaborLines(state: AppState, factor: number): AppState {
  const { lines } = laborCltLinesTotal(state);
  const ids = new Set(lines.map((l) => l.id));
  return scaleCostLines(state, ids, factor);
}

/** Escala o ativo total (ex.: 0.8 para liberar 20% de não-operacionais). */
export function scaleAssetTotal(state: AppState, factor: number): AppState {
  return {
    ...state,
    capital: { ...state.capital, ativoTotal: state.capital.ativoTotal * factor },
  };
}

// --------------------------------------------------------------------
// Registry de primitivas — catálogo tipado para futuro tool calling.
// --------------------------------------------------------------------

export const LEVER_REGISTRY = {
  scale_cost_line: {
    description: "Escala uma linha de custo específica (por id) por um fator.",
    schema: z.object({ id: z.string(), factor: z.number().nonnegative() }),
    apply: (s: AppState, p: { id: string; factor: number }) => scaleLine(s, p.id, p.factor),
  },
  scale_cost_category: {
    description:
      "Escala todas as linhas de uma categoria (custo_vendas, direto_venda, despesa_administrativa, despesa_comercial, financeiro). Aceita aliases legados fixo/variavel.",
    schema: z.object({
      category: z.enum([
        "custo_vendas",
        "direto_venda",
        "despesa_administrativa",
        "despesa_comercial",
        "financeiro",
        "fixo",
        "variavel",
      ]),
      factor: z.number().nonnegative(),
    }),
    apply: (s: AppState, p: { category: CostLine["category"]; factor: number }) =>
      scaleCategory(s, p.category, p.factor),
  },
  set_pmr: {
    description: "Define o Prazo Médio de Recebimento (dias).",
    schema: z.object({ days: z.number().min(0) }),
    apply: (s: AppState, p: { days: number }) => setPmr(s, p.days),
  },
  set_pmp: {
    description: "Define o Prazo Médio de Pagamento (dias).",
    schema: z.object({ days: z.number().min(0) }),
    apply: (s: AppState, p: { days: number }) => setPmp(s, p.days),
  },
  adjust_revenue: {
    description: "Escala a receita bruta por um fator (ex.: 1.05 = +5%).",
    schema: z.object({ factor: z.number().nonnegative() }),
    apply: (s: AppState, p: { factor: number }) => adjustRevenue(s, p.factor),
  },
  add_loan: {
    description:
      "Adiciona empréstimo PRICE: principal, taxa mensal (%), prazo (meses), mês de captação (0-11).",
    schema: z.object({
      principal: z.number().positive(),
      taxaMensal: z.number().min(0),
      prazoMeses: z.number().int().min(1).max(12),
      monthIdx: z.number().int().min(0).max(11).default(0),
    }),
    apply: (
      s: AppState,
      p: { principal: number; taxaMensal: number; prazoMeses: number; monthIdx?: number },
    ) => addLoan(s, p.principal, p.taxaMensal, p.prazoMeses, p.monthIdx ?? 0),
  },
  pay_down_debt: {
    description: "Quita pct (0-1) do principal da dívida usando caixa.",
    schema: z.object({ pct: z.number().min(0).max(1) }),
    apply: (s: AppState, p: { pct: number }) => payDownDebt(s, p.pct),
  },
  switch_regime: {
    description: "Troca regime tributário (simples, presumido, real).",
    schema: z.object({ regime: z.enum(["simples", "presumido", "real"]) }),
    apply: (s: AppState, p: { regime: AppState["tax"]["regime"] }) => switchRegime(s, p.regime),
  },
  reduce_labor_by_positions: {
    description: "Reduz folha CLT pelo equivalente a N posições ao custo médio informado.",
    schema: z.object({
      positions: z.number().int().positive(),
      custoMedioPosicao: z.number().positive(),
    }),
    apply: (s: AppState, p: { positions: number; custoMedioPosicao: number }) =>
      reduceLaborByPositions(s, p.positions, p.custoMedioPosicao),
  },
  dismiss_with_severance: {
    description:
      "Demissão CLT: aplica custo rescisório one-shot no mês indicado + redução estrutural.",
    schema: z.object({
      positions: z.number().int().positive(),
      salarioBase: z.number().positive(),
      monthIdx: z.number().int().min(0).max(11).default(0),
    }),
    apply: (s: AppState, p: { positions: number; salarioBase: number; monthIdx?: number }) =>
      dismissWithSeverance(s, p.positions, p.salarioBase, p.monthIdx ?? 0),
  },
  scale_labor_lines: {
    description: "Escala todas as linhas de folha CLT por um fator (ex.: 0.95 = -5%).",
    schema: z.object({ factor: z.number().nonnegative() }),
    apply: (s: AppState, p: { factor: number }) => scaleLaborLines(s, p.factor),
  },
  scale_asset_total: {
    description:
      "Escala o ativo total (ex.: 0.9 para liberar 10% de ativos ociosos). Aumenta giro e ROIC.",
    schema: z.object({ factor: z.number().nonnegative() }),
    apply: (s: AppState, p: { factor: number }) => scaleAssetTotal(s, p.factor),
  },
} as const;

export type LeverId = keyof typeof LEVER_REGISTRY;

/** Lista descritiva do catálogo (para UI/IA discovery). */
export function listLevers(): Array<{ id: LeverId; description: string }> {
  return (Object.keys(LEVER_REGISTRY) as LeverId[]).map((id) => ({
    id,
    description: LEVER_REGISTRY[id].description,
  }));
}
