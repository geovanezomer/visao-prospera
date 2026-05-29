import { AppState, CostLine } from "./types";
import { buildDRE, calcIndicators, compareRegimes, monthValues } from "./calculations";
import { buildCashFlow } from "./cashflow";
import { sum } from "./format";

export interface ActionImpact {
  label: string;
  before: string;
  after: string;
  positive: boolean;
}

export interface PrescriptiveAction {
  id: string;
  title: string;
  detail: string;
  apply: (s: AppState) => AppState;
}

export interface PrescriptiveCard {
  id: string;
  severity: "danger" | "warn" | "info" | "ok";
  problem: string;
  metricLabel: string;
  metricValue: string;
  benchmark?: string;
  cause: string;
  actions: PrescriptiveAction[];
}

// ============== Snapshot para comparação antes/depois ==============

export interface MetricSnapshot {
  receitaBruta: number;
  lucroLiquido: number;
  margemLiquida: number;
  ebitda: number;
  margemEbitda: number;
  roic: number;
  wacc: number;
  dividaLiqEbitda: number;
  coberturaJuros: number;
  pontoEquilibrio: number;
  saldoCaixaFinal: number;
  piorMesCaixa: number;
  impostosAno: number;
  fcf: number;
}

export function snapshot(state: AppState): MetricSnapshot {
  const { dre, tax } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const cf = buildCashFlow(state);
  return {
    receitaBruta: sum(dre.receitaBruta),
    lucroLiquido: sum(dre.lucroLiquido),
    margemLiquida: ind.margemLiquida,
    ebitda: sum(dre.ebitda),
    margemEbitda: ind.margemEbitda,
    roic: ind.roic,
    wacc: ind.wacc,
    dividaLiqEbitda: ind.dividaLiqEbitda,
    coberturaJuros: ind.coberturaJuros,
    pontoEquilibrio: ind.pontoEquilibrio,
    saldoCaixaFinal: cf.totais.saldoFinal,
    piorMesCaixa: cf.totais.pioresMes?.saldo ?? 0,
    impostosAno: tax.annual,
    fcf: ind.fcf,
  };
}

// ============== Helpers para construir ações ==============

const cloneCosts = (costs: CostLine[]) => costs.map((c) => ({ ...c, values: c.values.slice() }));

function scaleLine(state: AppState, id: string, factor: number): AppState {
  const costs = cloneCosts(state.costs).map((c) =>
    c.id === id ? { ...c, values: c.values.map((v) => v * factor) } : c,
  );
  return { ...state, costs };
}

function scaleCategory(state: AppState, category: CostLine["category"], factor: number): AppState {
  const costs = cloneCosts(state.costs).map((c) =>
    c.category === category ? { ...c, values: c.values.map((v) => v * factor) } : c,
  );
  return { ...state, costs };
}

function setPmr(state: AppState, newPmr: number): AppState {
  return { ...state, revenue: { ...state.revenue, pmr: Math.max(0, newPmr) } };
}

function setPmp(state: AppState, newPmp: number): AppState {
  return { ...state, revenue: { ...state.revenue, pmp: Math.max(0, newPmp) } };
}

function adjustRevenue(state: AppState, factor: number): AppState {
  return {
    ...state,
    revenue: { ...state.revenue, bruta: state.revenue.bruta.map((v) => v * factor) },
  };
}

/**
 * Adiciona empréstimo via tabela PRICE REAL:
 *  juros_t = saldo_{t-1} × i ; amort_t = PMT − juros_t ; saldo_t = saldo_{t-1} − amort_t.
 * Atualiza: capital.dividaOnerosa (+principal), cashflow (captação + amortização do principal mês a mês)
 *           e a linha "juros sobre empréstimos" do DRE com os juros do mês.
 */
function addLoan(state: AppState, principal: number, taxaMensal: number, prazoMeses: number, monthIdx = 0): AppState {
  const i = taxaMensal / 100;
  const pmt = i === 0 ? principal / prazoMeses : principal * (i / (1 - Math.pow(1 + i, -prazoMeses)));

  const cashflow = { ...state.cashflow };
  cashflow.emprestimosCaptados = state.cashflow.emprestimosCaptados.map((v, idx) => (idx === monthIdx ? v + principal : v));
  cashflow.amortizacoes = state.cashflow.amortizacoes.slice();

  const costs = cloneCosts(state.costs);
  let jurosLine = costs.find((c) => /juros/i.test(c.label));
  if (!jurosLine) {
    jurosLine = {
      id: `juros_${Date.now().toString(36)}`,
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

  const capital = { ...state.capital, dividaOnerosa: state.capital.dividaOnerosa + principal };
  return { ...state, costs, cashflow, capital };
}

/** Quita parte do principal usando caixa: reduz dívida + juros futuros proporcionalmente. */
function payDownDebt(state: AppState, pct: number): AppState {
  const capital = { ...state.capital, dividaOnerosa: state.capital.dividaOnerosa * (1 - pct) };
  // reduz proporcionalmente os juros pagos (não a outras linhas financeiras)
  const costs = cloneCosts(state.costs).map((c) =>
    c.category === "financeiro" && /juros/i.test(c.label)
      ? { ...c, values: c.values.map((v) => v * (1 - pct)) }
      : c,
  );
  // consome caixa equivalente
  const cashUsed = capital.dividaOnerosa * (pct / (1 - pct)); // valor pago
  const cashflow = { ...state.cashflow };
  cashflow.amortizacoes = state.cashflow.amortizacoes.slice();
  cashflow.amortizacoes[0] = (cashflow.amortizacoes[0] || 0) + cashUsed;
  return { ...state, costs, cashflow, capital };
}

function switchRegime(state: AppState, regime: AppState["tax"]["regime"]): AppState {
  return { ...state, tax: { ...state.tax, regime } };
}

function topNFixedLines(state: AppState, n: number): CostLine[] {
  return state.costs
    .filter((c) => c.category === "fixo")
    .map((c) => ({ c, total: sum(monthValues(c)) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
    .map((x) => x.c);
}

function laborCltLinesTotal(state: AppState): { lines: CostLine[]; totalMensal: number } {
  const re = /sal[áa]rio|folha|clt|mod|mão de obra/i;
  const lines = state.costs.filter((c) => c.category !== "financeiro" && re.test(c.label));
  const totalMensal = lines.reduce((acc, c) => acc + (c.fixed ? c.values[0] : sum(c.values) / 12), 0);
  return { lines, totalMensal };
}

function reduceLaborByPositions(state: AppState, positions: number, custoMedioPosicao: number): AppState {
  // Reduz proporcionalmente as linhas de folha CLT identificadas
  const { lines, totalMensal } = laborCltLinesTotal(state);
  if (lines.length === 0 || totalMensal <= 0) return state;
  const corteMensal = Math.min(positions * custoMedioPosicao, totalMensal);
  const factor = 1 - corteMensal / totalMensal;
  const costs = cloneCosts(state.costs).map((c) =>
    lines.some((l) => l.id === c.id) ? { ...c, values: c.values.map((v) => v * factor) } : c,
  );
  return { ...state, costs };
}

// ============== Engine principal ==============

const BENCHMARK_MARGEM_BRUTA: Record<AppState["businessType"], [number, number]> = {
  servicos: [50, 70],
  comercio: [25, 40],
  industria: [30, 45],
};

const BENCHMARK_FOLHA_RECEITA: Record<AppState["businessType"], [number, number]> = {
  servicos: [18, 28],
  comercio: [10, 18],
  industria: [15, 25],
};

export function buildPrescriptiveCards(state: AppState): PrescriptiveCard[] {
  const cards: PrescriptiveCard[] = [];
  const { dre } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const cf = buildCashFlow(state);
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const { totalMensal: folhaMensal } = laborCltLinesTotal(state);
  const folhaAnual = folhaMensal * 12;
  const folhaPct = receitaLiqAnual > 0 ? (folhaAnual / receitaLiqAnual) * 100 : 0;
  const [folhaMin, folhaMax] = BENCHMARK_FOLHA_RECEITA[state.businessType];

  // ===== 1. Folha alta =====
  if (folhaPct > folhaMax) {
    const custoMedio = folhaMensal / Math.max(1, laborCltLinesTotal(state).lines.length);
    cards.push({
      id: "folha_alta",
      severity: folhaPct > folhaMax * 1.5 ? "danger" : "warn",
      problem: "Folha CLT acima do benchmark do setor",
      metricLabel: "Folha / Receita Líquida",
      metricValue: `${folhaPct.toFixed(1)}%`,
      benchmark: `Setor ${state.businessType}: ${folhaMin}–${folhaMax}%`,
      cause: `Folha mensal de ${(folhaMensal).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Quadro pode estar dimensionado para um faturamento maior que o atual.`,
      actions: [
        {
          id: "reduce_clt_2",
          title: "Reduzir 2 posições CLT",
          detail: `Corte equivalente a ~${(2 * custoMedio).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês incluindo encargos.`,
          apply: (s) => reduceLaborByPositions(s, 2, custoMedio),
        },
        {
          id: "reduce_clt_5pct",
          title: "Cortar 5% da folha (revisão de cargos/salários)",
          detail: "Negociação coletiva ou ajustes pontuais sem desligamentos.",
          apply: (s) => {
            const { lines } = laborCltLinesTotal(s);
            const ids = new Set(lines.map((l) => l.id));
            const costs = cloneCosts(s.costs).map((c) =>
              ids.has(c.id) ? { ...c, values: c.values.map((v) => v * 0.95) } : c,
            );
            return { ...s, costs };
          },
        },
        {
          id: "increase_revenue_30",
          title: "Aumentar receita em 30%",
          detail: "Diluir folha mantendo quadro — exige plano comercial. Simula impacto isolado.",
          apply: (s) => adjustRevenue(s, 1.3),
        },
      ],
    });
  }

  // ===== 2. ROIC < WACC =====
  if (Number.isFinite(ind.roic) && ind.roic < ind.wacc) {
    cards.push({
      id: "roic_wacc",
      severity: "danger",
      problem: "Empresa destrói valor econômico",
      metricLabel: "ROIC × WACC",
      metricValue: `${ind.roic.toFixed(1)}% < ${ind.wacc.toFixed(1)}%`,
      cause: "O retorno do capital empregado não cobre o custo do capital. Ou margem está baixa, ou ativo está superdimensionado.",
      actions: [
        {
          id: "cut_fixed_15",
          title: "Cortar 15% dos custos fixos",
          detail: "Reduz estrutura — foco nas 3 maiores rubricas fixas.",
          apply: (s) => {
            const top = topNFixedLines(s, 3).map((l) => l.id);
            const ids = new Set(top);
            const costs = cloneCosts(s.costs).map((c) =>
              ids.has(c.id) ? { ...c, values: c.values.map((v) => v * 0.85) } : c,
            );
            return { ...s, costs };
          },
        },
        {
          id: "price_5",
          title: "Repasse de preço de +5%",
          detail: "Aumenta receita sem mexer em custos. Avalie elasticidade.",
          apply: (s) => adjustRevenue(s, 1.05),
        },
        {
          id: "reduce_assets",
          title: "Reduzir ativo total em 20% (venda de não-operacionais)",
          detail: "Libera capital ocioso. Aumenta giro do ativo e ROIC.",
          apply: (s) => ({ ...s, capital: { ...s.capital, ativoTotal: s.capital.ativoTotal * 0.8 } }),
        },
      ],
    });
  }

  // ===== 3. Caixa negativo / abaixo do mínimo =====
  if (cf.alertas.length > 0) {
    const pior = cf.totais.pioresMes;
    const principal = Math.ceil(Math.abs(Math.min(pior?.saldo ?? 0, 0) + state.cashflow.caixaMinimo) / 1000) * 1000 || 30000;
    cards.push({
      id: "caixa_negativo",
      severity: cf.alertas.some((a) => a.tipo === "negativo") ? "danger" : "warn",
      problem: "Caixa projetado fura o mínimo de segurança",
      metricLabel: "Pior mês de caixa",
      metricValue: pior ? `${pior.mes}: ${pior.saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "—",
      cause: "Mesmo lucrando, a empresa pode ficar sem dinheiro em caixa em determinado mês por descasamento entre recebimentos (PMR) e pagamentos (PMP) e/ou sazonalidade.",
      actions: [
        {
          id: "loan_giro",
          title: `Captar empréstimo de capital de giro (${principal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} @ 2%a.m. × 12m)`,
          detail: "Entra no mês 1. Cria parcela de juros + amortização mensal.",
          apply: (s) => addLoan(s, principal, 2, 12, 0),
        },
        {
          id: "reduce_pmr",
          title: `Reduzir PMR de ${state.revenue.pmr} para ${Math.max(0, state.revenue.pmr - 15)} dias`,
          detail: "Negociação com clientes ou antecipação seletiva. Acelera entrada de caixa.",
          apply: (s) => setPmr(s, s.revenue.pmr - 15),
        },
        {
          id: "increase_pmp",
          title: `Negociar PMP de ${state.revenue.pmp} para ${state.revenue.pmp + 15} dias com fornecedores`,
          detail: "Posterga saídas sem alterar custo total.",
          apply: (s) => setPmp(s, s.revenue.pmp + 15),
        },
      ],
    });
  }

  // ===== 4. Cobertura de juros baixa =====
  if (Number.isFinite(ind.coberturaJuros) && ind.coberturaJuros < 2) {
    cards.push({
      id: "cobertura_juros",
      severity: "danger",
      problem: "Cobertura de juros perigosamente baixa",
      metricLabel: "EBIT / Despesas Financeiras",
      metricValue: `${ind.coberturaJuros.toFixed(1)}×`,
      benchmark: "Saudável: > 3×",
      cause: "O lucro operacional mal cobre os juros — risco de inadimplência financeira em qualquer choque.",
      actions: [
        {
          id: "renegotiate_rate",
          title: "Renegociar juros (-30%)",
          detail: "Trocar dívida cara por linha mais barata (portabilidade, garantia real).",
          apply: (s) => scaleCategory(s, "financeiro", 0.7),
        },
        {
          id: "amort_extra",
          title: "Quitar 30% do principal da dívida (uso de caixa)",
          detail: "Reduz dívida onerosa e juros futuros proporcionalmente; consome caixa equivalente.",
          apply: (s) => payDownDebt(s, 0.3),
        },
      ],
    });
  }

  // ===== 5. NCG não coberto =====
  if (ind.gapCapitalGiro > 0) {
    cards.push({
      id: "ncg_gap",
      severity: "warn",
      problem: "Necessidade de Capital de Giro não coberta",
      metricLabel: "Gap de Capital de Giro",
      metricValue: ind.gapCapitalGiro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      cause: `Ciclo financeiro de ${ind.cicloFinanceiro} dias. Empresa financia o cliente por mais tempo do que o fornecedor financia a ela.`,
      actions: [
        {
          id: "pmr_minus_15",
          title: `Reduzir PMR em 15 dias (${state.revenue.pmr}→${Math.max(0, state.revenue.pmr - 15)})`,
          detail: "Política comercial mais rígida + uso seletivo de antecipação.",
          apply: (s) => setPmr(s, s.revenue.pmr - 15),
        },
        {
          id: "pmp_plus_15",
          title: `Aumentar PMP em 15 dias (${state.revenue.pmp}→${state.revenue.pmp + 15})`,
          detail: "Renegociação com fornecedores estratégicos.",
          apply: (s) => setPmp(s, s.revenue.pmp + 15),
        },
      ],
    });
  }

  // ===== 6. Margem bruta abaixo do benchmark =====
  const [mbMin] = BENCHMARK_MARGEM_BRUTA[state.businessType];
  if (ind.margemBruta < mbMin) {
    cards.push({
      id: "margem_bruta",
      severity: "warn",
      problem: "Margem bruta abaixo do benchmark do setor",
      metricLabel: "Margem Bruta",
      metricValue: `${ind.margemBruta.toFixed(1)}%`,
      benchmark: `Setor ${state.businessType}: ${mbMin}%+`,
      cause: "Custo de Vendas (CMV/CPV/CSP) está alto em relação à receita — preço baixo ou custo direto elevado.",
      actions: [
        {
          id: "price_8",
          title: "Repasse de preço de +8%",
          detail: "Avalie elasticidade-preço do seu mercado antes de aplicar.",
          apply: (s) => adjustRevenue(s, 1.08),
        },
        {
          id: "cv_minus_10",
          title: "Reduzir Custo de Vendas em 10% (negociação com fornecedores)",
          detail: "Renegociação, troca de fornecedor, compras em escala.",
          apply: (s) => scaleCategory(s, "custo_vendas", 0.9),
        },
      ],
    });
  }

  // ===== 7. Regime tributário sub-ótimo =====
  const reg = compareRegimes(state);
  const atual = reg[state.tax.regime];
  const opcoes = (Object.entries(reg) as [keyof typeof reg, typeof atual][])
    .filter(([k]) => k !== state.tax.regime)
    .sort((a, b) => a[1].annual - b[1].annual);
  const melhor = opcoes[0];
  if (melhor && atual.annual - melhor[1].annual > atual.annual * 0.1) {
    const economia = atual.annual - melhor[1].annual;
    cards.push({
      id: "regime",
      severity: "info",
      problem: "Regime tributário pode estar sub-ótimo",
      metricLabel: "Carga atual × alternativa",
      metricValue: `${atual.effective.toFixed(1)}% × ${melhor[1].effective.toFixed(1)}%`,
      cause: `Migrar para ${labelRegime(melhor[0])} economizaria ${economia.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/ano segundo o cálculo atual. Valide com seu contador (CNAE, fator R, créditos).`,
      actions: [
        {
          id: "switch_regime",
          title: `Migrar para ${labelRegime(melhor[0])}`,
          detail: "Simula a tributação no novo regime usando os parâmetros já configurados.",
          apply: (s) => switchRegime(s, melhor[0] as AppState["tax"]["regime"]),
        },
      ],
    });
  }

  // ===== 8. Custos fixos altos =====
  const fixoPct = receitaLiqAnual > 0 ? (sum(dre.custosFixos) / receitaLiqAnual) * 100 : 0;
  if (fixoPct > 50) {
    const top3 = topNFixedLines(state, 3);
    cards.push({
      id: "custos_fixos",
      severity: "danger",
      problem: "Custos fixos altos demais",
      metricLabel: "Custos Fixos / Receita Líq.",
      metricValue: `${fixoPct.toFixed(1)}%`,
      benchmark: "Saudável: < 35%",
      cause: `Alta alavancagem operacional. Maiores rubricas: ${top3.map((l) => l.label).join(", ")}.`,
      actions: [
        {
          id: "cut_top_10",
          title: "Cortar 10% das 3 maiores rubricas fixas",
          detail: "Sub-locação, downgrade de software, terceirização.",
          apply: (s) => {
            const ids = new Set(top3.map((l) => l.id));
            const costs = cloneCosts(s.costs).map((c) =>
              ids.has(c.id) ? { ...c, values: c.values.map((v) => v * 0.9) } : c,
            );
            return { ...s, costs };
          },
        },
        {
          id: "cut_top_20",
          title: "Cenário agressivo: -20% nas 3 maiores",
          detail: "Requer mudança estrutural (mudança de sede, reestruturação).",
          apply: (s) => {
            const ids = new Set(top3.map((l) => l.id));
            const costs = cloneCosts(s.costs).map((c) =>
              ids.has(c.id) ? { ...c, values: c.values.map((v) => v * 0.8) } : c,
            );
            return { ...s, costs };
          },
        },
      ],
    });
  }

  // Se nada disparou, parabeniza
  if (cards.length === 0) {
    cards.push({
      id: "ok",
      severity: "ok",
      problem: "Empresa em zona saudável",
      metricLabel: "Nenhum alerta crítico detectado",
      metricValue: "✓",
      cause: "Continue monitorando os indicadores mensalmente. Considere salvar este como cenário base.",
      actions: [],
    });
  }

  return cards;
}

function labelRegime(r: AppState["tax"]["regime"]) {
  return r === "simples" ? "Simples Nacional" : r === "presumido" ? "Lucro Presumido" : "Lucro Real";
}
