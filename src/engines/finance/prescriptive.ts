// =====================================================================
// prescriptive.ts — DETECTORES + COMPOSIÇÃO de cards prescritivos.
//
// A partir da PR4 (Fase 1 — Modo Propositivo), toda mutação de estado
// vive em `./levers/primitives.ts`. Este arquivo passa a conter apenas:
//   - Tipos públicos (PrescriptiveCard, PrescriptiveAction, etc.)
//   - `snapshot()` (comparação antes/depois)
//   - `buildPrescriptiveCards()` que DETECTA condições e COMPÕE
//     primitivas do registry (Regra de Ouro: comportamento idêntico).
// =====================================================================
import { AppState } from "./types";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { compareRegimes } from "./tax/compare";
import { folhaAnual, resolveEffectiveRegime } from "./regime";
import { fmtBRL } from "./format";
import { buildCashFlow } from "./cashflow";
import { getFinancialModelCached } from "./financialModel";
import { sum } from "./format";
import { resolveBenchmark } from "@/engines/benchmark/sectors";
import type { SimulatorParams } from "./simulator";

import {
  adjustRevenue,
  addLoan,
  cloneCosts,
  dismissWithSeverance,
  laborCltLinesTotal,
  payDownDebt,
  reduceLaborByPositions,
  scaleAssetTotal,
  scaleCategory,
  scaleCostLines,
  scaleLaborLines,
  setPmp,
  setPmr,
  severanceCostPerPosition,
  switchRegime,
  topNFixedLines,
} from "./levers/primitives";

// Re-export para preservar API pública existente (`@/engines/finance/prescriptive`).
export { severanceCostPerPosition } from "./levers/primitives";

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
  /** Mutação determinística (compat retro — usado pelos botões "Aplicar"). */
  apply: (s: AppState) => AppState;
  /**
   * PR4b (Fase 1.5) — Equivalente declarativo em termos de SimulatorParams.
   * Permite que a UI abra o Simulador pré-configurado em vez de mutar direto.
   * Opcional: ausente quando a ação não tem alavanca paramétrica equivalente
   * (ex.: rescisão com one-shot de caixa, venda de ativos).
   */
  asSimulatorParams?: Partial<SimulatorParams>;
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
  coberturaJuros: number | null;
  pontoEquilibrio: number;
  saldoCaixaFinal: number;
  piorMesCaixa: number;
  impostosAno: number;
  fcf: number;
}

// Permite reaproveitar o modelo já computado por `useFinanceModel`/`buildFinancialModel`
// em vez de rodar buildDRE+calcIndicators+buildCashFlow do zero (3 passagens).
export interface PrescriptivePrecomputed {
  dre: ReturnType<typeof buildDRE>["dre"];
  tax: ReturnType<typeof buildDRE>["tax"];
  ind: ReturnType<typeof calcIndicators>;
  cf: ReturnType<typeof buildCashFlow>;
}

export function snapshot(state: AppState, pre?: PrescriptivePrecomputed): MetricSnapshot {
  // Usa regime efetivo (Simples pode ter excedido limite).
  // Perf: quando o chamador não passa `pre`, usa modelo memoizado — evita
  // recomputação em cascata de buildDRE + buildCashFlow + calcIndicators
  // (que por sua vez chamaria buildCashFlow + deriveBalancoFechamento).
  const built: PrescriptivePrecomputed = pre ?? (() => {
    const m = getFinancialModelCached(state);
    return { dre: m.dre, tax: m.tax, ind: m.ind, cf: m.cf };
  })();
  const { dre, tax, ind, cf } = built;
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

// ============== Engine principal ==============

// Fallback de Margem Bruta caso `resolveBenchmark` retorne undefined
// (ex.: businessType vazio). Em uso normal, prevalece o benchmark do setor
// escolhido OU o `benchmarkCustom` salvo pelo consultor.
const FALLBACK_MARGEM_BRUTA: Record<AppState["businessType"], number> = {
  servicos: 50,
  comercio: 25,
  industria: 30,
};

// Folha/Receita não está no catálogo SECTORS — mantido hardcoded.
// TODO: migrar para SECTORS quando a métrica for adicionada lá.
const BENCHMARK_FOLHA_RECEITA: Record<AppState["businessType"], [number, number]> = {
  servicos: [18, 28],
  comercio: [10, 18],
  industria: [15, 25],
};

export function buildPrescriptiveCards(
  state: AppState,
  pre?: PrescriptivePrecomputed,
): PrescriptiveCard[] {
  const cards: PrescriptiveCard[] = [];
  // Regime efetivo (verdade absoluta — alinhado com IndicatorsTab/CashflowTab).
  // Otimização: reusa o modelo já computado (DiagnosisTab/PDF) — evita 3
  // passagens completas pela engine por render.
  const built = pre ?? (() => {
    const m = getFinancialModelCached(state);
    return { dre: m.dre, tax: null as never, ind: m.ind, cf: m.cf };
  })();
  const { dre, ind, cf } = built;
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const { totalMensal: folhaMensal } = laborCltLinesTotal(state);
  // Reusa fonte canônica do engine — evita divergência com IndicatorsCard ("Folha/Receita").
  const folhaAnoCanon = folhaAnual(state);
  const folhaPct = receitaLiqAnual > 0 ? (folhaAnoCanon / receitaLiqAnual) * 100 : 0;
  const [folhaMin, folhaMax] = BENCHMARK_FOLHA_RECEITA[state.businessType];
  // Benchmark setorial resolvido (respeita ramoAtuacao + benchmarkCustom).
  const sectorBench = resolveBenchmark(state);
  const sectorLabel = sectorBench?.label ?? state.businessType;

  // ===== 1. Folha alta =====
  if (folhaPct > folhaMax) {
    const custoMedio = folhaMensal / Math.max(1, laborCltLinesTotal(state).lines.length);
    cards.push({
      id: "folha_alta",
      severity: folhaPct > folhaMax * 1.5 ? "danger" : "warn",
      problem: "Folha CLT acima do benchmark do setor",
      metricLabel: "Folha / Receita Líquida",
      metricValue: `${folhaPct.toFixed(1)}%`,
      benchmark: `${sectorLabel}: ${folhaMin}–${folhaMax}% (faixa saudável)`,
      cause: `Folha mensal de ${fmtBRL(folhaMensal)}. Quadro pode estar dimensionado para um faturamento maior que o atual.`,
      actions: [
        {
          id: "dismiss_2_severance",
          title: "Demitir 2 posições (com custo rescisório real)",
          detail: `Aviso + 13º + férias + 1/3 + multa FGTS 40% ≈ ${fmtBRL((severanceCostPerPosition(custoMedio / 1.7) * 2))} de saída de caixa one-shot (Mês 1), redução estrutural da folha a partir do mês 2.`,
          apply: (s) => dismissWithSeverance(s, 2, custoMedio / 1.7, 0),
        },
        {
          id: "reduce_clt_2",
          title: "Reduzir 2 posições CLT (sem rescisão — encerramento de contrato/aposentadoria)",
          detail: `Corte equivalente a ~${fmtBRL((2 * custoMedio))}/mês incluindo encargos. Não impacta caixa one-shot.`,
          apply: (s) => reduceLaborByPositions(s, 2, custoMedio),
        },
        {
          id: "reduce_clt_5pct",
          title: "Cortar 5% da folha (revisão de cargos/salários)",
          detail: "Negociação coletiva ou ajustes pontuais sem desligamentos.",
          apply: (s) => scaleLaborLines(s, 0.95),
          asSimulatorParams: { payrollDeltaPct: -5 },
        },
        {
          id: "increase_revenue_30",
          title: "Aumentar receita em 30%",
          detail: "Diluir folha mantendo quadro — exige plano comercial. Simula impacto isolado.",
          apply: (s) => adjustRevenue(s, 1.3),
          asSimulatorParams: { priceDeltaPct: 30 },
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
      cause:
        "O retorno do capital empregado não cobre o custo do capital. Ou margem está baixa, ou ativo está superdimensionado.",
      actions: [
        {
          id: "cut_fixed_15",
          title: "Cortar 15% dos custos fixos",
          detail: "Reduz estrutura — foco nas 3 maiores rubricas fixas.",
          apply: (s) => {
            const ids = new Set(topNFixedLines(s, 3).map((l) => l.id));
            return scaleCostLines(s, ids, 0.85);
          },
          asSimulatorParams: { fixedCutPct: 15, fixedCutTopN: 3 },
        },
        {
          id: "price_5",
          title: "Repasse de preço de +5%",
          detail: "Aumenta receita sem mexer em custos. Avalie elasticidade.",
          apply: (s) => adjustRevenue(s, 1.05),
          asSimulatorParams: { priceDeltaPct: 5 },
        },

        {
          id: "reduce_assets",
          title: "Reduzir ativo total em 20% (venda de não-operacionais)",
          detail: "Libera capital ocioso. Aumenta giro do ativo e ROIC.",
          apply: (s) => scaleAssetTotal(s, 0.8),
        },
      ],
    });
  }

  // ===== 3. Caixa negativo / abaixo do mínimo =====
  if (cf.alertas.length > 0) {
    const pior = cf.totais.pioresMes;
    const principal =
      Math.ceil(Math.abs(Math.min(pior?.saldo ?? 0, 0) + state.cashflow.caixaMinimo) / 1000) *
        1000 || 30000;
    cards.push({
      id: "caixa_negativo",
      severity: cf.alertas.some((a) => a.tipo === "negativo") ? "danger" : "warn",
      problem: "Caixa projetado fura o mínimo de segurança",
      metricLabel: "Pior mês de caixa",
      metricValue: pior
        ? `${pior.mes}: ${fmtBRL(pior.saldo)}`
        : "—",
      cause:
        "Mesmo lucrando, a empresa pode ficar sem dinheiro em caixa em determinado mês por descasamento entre recebimentos (PMR) e pagamentos (PMP) e/ou sazonalidade.",
      actions: [
        {
          id: "loan_giro",
          title: `Captar empréstimo de capital de giro (${fmtBRL(principal)} @ 2%a.m. × 12m)`,
          detail: "Entra no mês 1. Cria parcela de juros + amortização mensal.",
          apply: (s) => addLoan(s, principal, 2, 12, 0),
          asSimulatorParams: { loanPrincipal: principal, loanRatePctAm: 2, loanTermMonths: 12 },
        },
        {
          id: "reduce_pmr",
          title: `Reduzir PMR de ${state.revenue.pmr} para ${Math.max(0, state.revenue.pmr - 15)} dias`,
          detail: "Negociação com clientes ou antecipação seletiva. Acelera entrada de caixa.",
          apply: (s) => setPmr(s, s.revenue.pmr - 15),
          asSimulatorParams: { pmrDeltaDays: -15 },
        },
        {
          id: "increase_pmp",
          title: `Negociar PMP de ${state.revenue.pmp} para ${state.revenue.pmp + 15} dias com fornecedores`,
          detail: "Posterga saídas sem alterar custo total.",
          apply: (s) => setPmp(s, s.revenue.pmp + 15),
          asSimulatorParams: { pmpDeltaDays: 15 },
        },
      ],
    });

  }

  // ===== 4. Cobertura de juros baixa =====
  if (ind.coberturaJuros != null && Number.isFinite(ind.coberturaJuros) && ind.coberturaJuros < 2) {
    cards.push({
      id: "cobertura_juros",
      severity: "danger",
      problem: "Cobertura de juros perigosamente baixa",
      metricLabel: "EBIT / Despesas Financeiras",
      metricValue: `${ind.coberturaJuros.toFixed(1)}×`,
      benchmark: "Saudável: > 3×",
      cause:
        "O lucro operacional mal cobre os juros — risco de inadimplência financeira em qualquer choque.",
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
          detail:
            "Reduz dívida onerosa e juros futuros proporcionalmente; consome caixa equivalente.",
          apply: (s) => payDownDebt(s, 0.3),
          asSimulatorParams: { debtPaydownPct: 30 },
        },

      ],
    });
  }

  // ===== 5. Necessidade de Capital de Giro não coberta =====
  if (ind.gapCapitalGiro > 0) {
    cards.push({
      id: "ncg_gap",
      severity: "warn",
      problem: "Necessidade de Capital de Giro não coberta",
      metricLabel: "Gap de Capital de Giro",
      metricValue: fmtBRL(ind.gapCapitalGiro),
      cause: `Ciclo financeiro de ${ind.cicloFinanceiro.toFixed(1)} dias. Empresa financia o cliente por mais tempo do que o fornecedor financia a ela.`,
      actions: [
        {
          id: "pmr_minus_15",
          title: `Reduzir PMR em 15 dias (${state.revenue.pmr}→${Math.max(0, state.revenue.pmr - 15)})`,
          detail: "Política comercial mais rígida + uso seletivo de antecipação.",
          apply: (s) => setPmr(s, s.revenue.pmr - 15),
          asSimulatorParams: { pmrDeltaDays: -15 },
        },
        {
          id: "pmp_plus_15",
          title: `Aumentar PMP em 15 dias (${state.revenue.pmp}→${state.revenue.pmp + 15})`,
          detail: "Renegociação com fornecedores estratégicos.",
          apply: (s) => setPmp(s, s.revenue.pmp + 15),
          asSimulatorParams: { pmpDeltaDays: 15 },
        },

      ],
    });
  }

  // ===== 6. Margem bruta abaixo do benchmark =====
  // Limite saudável = P25 do setor resolvido (respeita ramoAtuacao + benchmarkCustom).
  const mbMin = sectorBench?.margemBruta.p25 ?? FALLBACK_MARGEM_BRUTA[state.businessType];
  const mbP50 = sectorBench?.margemBruta.p50 ?? mbMin;
  if (ind.margemBruta < mbMin) {
    cards.push({
      id: "margem_bruta",
      severity: "warn",
      problem: "Margem bruta abaixo do benchmark do setor",
      metricLabel: "Margem Bruta",
      metricValue: `${ind.margemBruta.toFixed(1)}%`,
      benchmark: `${sectorLabel}: P25 ${mbMin.toFixed(1)}% · mediana ${mbP50.toFixed(1)}%`,
      cause:
        "Custo de Vendas (CMV/CPV/CSP) está alto em relação à receita — preço baixo ou custo direto elevado.",
      actions: [
        {
          id: "price_8",
          title: "Repasse de preço de +8%",
          detail: "Avalie elasticidade-preço do seu mercado antes de aplicar.",
          apply: (s) => adjustRevenue(s, 1.08),
          asSimulatorParams: { priceDeltaPct: 8 },
        },
        {
          id: "cv_minus_10",
          title: "Reduzir Custo de Vendas em 10% (negociação com fornecedores)",
          detail: "Renegociação, troca de fornecedor, compras em escala.",
          apply: (s) => scaleCategory(s, "custo_vendas", 0.9),
          asSimulatorParams: { cpvDeltaPct: -10 },
        },

      ],
    });
  }

  // ===== 7. Diagnóstico do Regime Tributário (sempre exibido) =====
  {
    const reg = compareRegimes(state);
    const regimes: AppState["tax"]["regime"][] = ["simples", "presumido", "real"];
    const atual = reg[state.tax.regime];
    const ranked = regimes
      .map((k) => [k, reg[k]] as const)
      .slice()
      .sort((a, b) => a[1].annual - b[1].annual);
    const melhor = ranked[0];
    const isAtualMelhor = melhor[0] === state.tax.regime;
    const economia = atual.annual - melhor[1].annual;
    const economiaPct = atual.annual > 0 ? (economia / atual.annual) * 100 : 0;

    const comparativo = ranked
      .map(
        ([k, v]) =>
          `${labelRegime(k)}: ${fmtBRL(v.annual)}/ano (${v.effective.toFixed(1)}%)`,
      )
      .join(" · ");

    if (isAtualMelhor) {
      cards.push({
        id: "regime",
        severity: "ok",
        problem: `Regime atual (${labelRegime(state.tax.regime)}) é o mais vantajoso`,
        metricLabel: "Carga tributária efetiva",
        metricValue: `${atual.effective.toFixed(1)}%`,
        cause: `Comparativo anual nos 3 regimes — ${comparativo}. A escolha atual minimiza a carga, mas revalide com seu contador conforme o CNAE, fator R e créditos de PIS/COFINS.`,
        actions: [],
      });
    } else {
      const severity: PrescriptiveCard["severity"] =
        economiaPct >= 15 ? "danger" : economiaPct >= 5 ? "warn" : "info";
      cards.push({
        id: "regime",
        severity,
        problem: `Regime tributário sub-ótimo (atual: ${labelRegime(state.tax.regime)})`,
        metricLabel: "Carga atual × melhor opção",
        metricValue: `${atual.effective.toFixed(1)}% × ${melhor[1].effective.toFixed(1)}%`,
        cause: `Migrar para ${labelRegime(melhor[0])} economizaria ${fmtBRL(economia)}/ano (${economiaPct.toFixed(1)}% da carga atual). Comparativo: ${comparativo}. Valide com contador (CNAE, fator R, créditos, sublimites do Simples).`,
        actions: [
          {
            id: "switch_regime",
            title: `Simular migração para ${labelRegime(melhor[0])}`,
            detail:
              "Aplica o novo regime ao plano usando os parâmetros já configurados (anexo do Simples, presunção, etc.).",
            apply: (s) => switchRegime(s, melhor[0] as AppState["tax"]["regime"]),
            asSimulatorParams: { regimeOverride: melhor[0] as AppState["tax"]["regime"] },
          },

        ],
      });
    }
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
          apply: (s) => scaleCostLines(s, new Set(top3.map((l) => l.id)), 0.9),
          asSimulatorParams: { fixedCutPct: 10, fixedCutTopN: 3 },
        },
        {
          id: "cut_top_20",
          title: "Cenário agressivo: -20% nas 3 maiores",
          detail: "Requer mudança estrutural (mudança de sede, reestruturação).",
          apply: (s) => scaleCostLines(s, new Set(top3.map((l) => l.id)), 0.8),
          asSimulatorParams: { fixedCutPct: 20, fixedCutTopN: 3 },
        },

      ],
    });
  }

  // ===== 9. Eficiência operacional — conversão de EBITDA em caixa (sempre exibido) =====
  {
    const ebitdaAno = sum(dre.ebitda);
    const conversaoFcf = ebitdaAno > 0 ? (ind.fcf / ebitdaAno) * 100 : 0;
    const giroAtivo = ind.giroAtivo;
    const benchConv = "Saudável: > 60% (EBITDA vira caixa)";
    let severity: PrescriptiveCard["severity"];
    let problem: string;
    if (ebitdaAno <= 0) {
      severity = "danger";
      problem = "EBITDA negativo — operação não gera caixa";
    } else if (conversaoFcf < 30) {
      severity = "danger";
      problem = "Baixíssima conversão de EBITDA em caixa";
    } else if (conversaoFcf < 60) {
      severity = "warn";
      problem = "Conversão de EBITDA em caixa abaixo do ideal";
    } else if (giroAtivo < 0.5) {
      severity = "warn";
      problem = "Giro do ativo baixo — capital ocioso";
    } else {
      severity = "ok";
      problem = "Eficiência operacional saudável";
    }
    cards.push({
      id: "eficiencia_op",
      severity,
      problem,
      metricLabel: "FCF / EBITDA · Giro do Ativo",
      metricValue: `${ebitdaAno > 0 ? conversaoFcf.toFixed(0) + "%" : "—"} · ${giroAtivo.toFixed(2)}×`,
      benchmark: benchConv,
      cause:
        ebitdaAno <= 0
          ? "Sem EBITDA não há fonte interna de caixa: cada mês depende de captação ou queima de reservas."
          : conversaoFcf < 60
            ? "EBITDA não está virando caixa: capital de giro pesado (PMR alto, estoques), capex recorrente ou alta carga de impostos comem a geração."
            : giroAtivo < 0.5
              ? "Ativos pouco produtivos: receita gerada por R$ investido está abaixo do esperado — há gordura no balanço."
              : "Operação converte EBITDA em caixa com folga e gira o ativo de forma adequada.",
      actions:
        severity === "ok"
          ? []
          : [
              {
                id: "ef_reduce_pmr",
                title: `Reduzir PMR (atual ${state.revenue.pmr}d → ${Math.max(0, state.revenue.pmr - 10)}d)`,
                detail: "Acelera entrada de caixa — melhora direto a conversão FCF/EBITDA.",
                apply: (s) => setPmr(s, s.revenue.pmr - 10),
                asSimulatorParams: { pmrDeltaDays: -10 },
              },

              {
                id: "ef_reduce_assets",
                title: "Liberar ativos ociosos (-10% do ativo total)",
                detail:
                  "Venda de imóveis, equipamentos subutilizados, baixa de estoque parado. Aumenta giro e ROIC.",
                apply: (s) => scaleAssetTotal(s, 0.9),
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
      cause:
        "Continue monitorando os indicadores mensalmente. Considere salvar este como cenário base.",
      actions: [],
    });
  }

  return cards;
}

function labelRegime(r: AppState["tax"]["regime"]) {
  return r === "simples"
    ? "Simples Nacional"
    : r === "presumido"
      ? "Lucro Presumido"
      : "Lucro Real";
}

// `cloneCosts` é re-exportado para compatibilidade caso testes externos importem.
export { cloneCosts };
