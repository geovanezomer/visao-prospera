// Tool registry — function calling (OpenAI-compatible).
// Cada tool retorna markdown que o LLM injeta como resultado para o próximo turno.

import type { AppState } from "@/lib/finance/types";
import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/lib/finance/simulator";
import { buildSections, getSectionsCached } from "./snapshot";
import { findSector, listSectors, rank, type SectorBenchmark } from "@/services/benchmark/sectors";
import { fetchSerie, getMacroSnapshot, getSerieFormatted, MACRO_SERIES_KEYS, type SerieKey } from "@/services/macro/bcb";
import { buildForecast, DEFAULT_FORECAST_CFG, type ForecastConfig, type ForecastResult } from "@/lib/finance/forecast";
import { runSensitivity, type DriverKey, type OutputKey, type SensitivityResult } from "@/lib/finance/sensitivity";
import { listScenarios, saveScenario, deleteScenario, getScenario } from "@/services/scenarios/store";
import { listActions, createAction, updateAction, deleteAction, actionsToMarkdown, type ActionStatus } from "@/services/actions/store";
import { regimeComparisonToMarkdown, taxAuditToMarkdown } from "@/services/compliance/tax";
import { checklistToMarkdown } from "@/services/compliance/checklist";
import { buildDRE, calcIndicators, resolveEffectiveRegime, diagnose, compareYearsForRegime } from "@/lib/finance/calculations";
import { buildValuation, defaultValuationParams } from "@/lib/finance/valuation";
import { computeHealth } from "@/lib/finance/health";

// Helpers locais de formatação (espelho dos usados em snapshot.ts).
const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number) => `${((Number.isFinite(n) ? n : 0) * 100).toFixed(1).replace(".", ",")}%`;
const sum = (a: number[]) => a.reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export const TOOLS: ToolDef[] = [
  // --- Dados internos ---
  { name: "get_premissas", description: "Premissas da empresa (regime, capital, prazos, caixa mínimo).", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_receitas", description: "Configuração de receitas: bruta mensal, deduções customizadas, inadimplência, PMR/PMP mensais e receitas financeiras.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_despesas", description: "Lista completa de linhas de despesa (CPV/CMV, fixos, variáveis, folha CLT com encargos) com totais e categoria.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_capital", description: "Estrutura de capital detalhada: PL, dívida onerosa, ativo/passivo circulante, contas a receber, fornecedores, estoques, Ke/Kd, capex ativado.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_regime_tributario", description: "Configuração tributária completa: regime nominal vs efetivo, anexo Simples, Fator R, alíquotas ISS/ICMS/PIS/COFINS/CBS/IBS, era da Reforma e carga apurada.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_dre", description: "DRE completa anual e mensal.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_indicadores", description: "Indicadores financeiros (margens, ROE/ROIC, liquidez, endividamento, ciclo).", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_fluxo_caixa", description: "Fluxo de caixa mensal, pior mês e alertas.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_valuation", description: "Valuation: EV, equity, múltiplos, DCF, confiança.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_diagnostico", description: "Diagnóstico automático e alertas de risco.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_saude_financeira", description: "Score de saúde (financeiro + total).", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_governanca", description: "Respostas qualitativas de governança e sucessão (sócio afastado, processos documentados, plano de sucessão, quem fecha contrato).", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_estrategico", description: "Análise estratégica qualitativa completa (concentração de clientes/fornecedores, competitivo, regulatório, governança) em JSON.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_prescritivo", description: "Recomendações prescritivas.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "get_comparativo_simulado", description: "Compara base × cenário simulado ativo.", parameters: { type: "object", properties: {}, required: [] } },
  {
    name: "get_resumo_executivo",
    description: "Retorna os 8 KPIs mais importantes da empresa em menos de 500 tokens. Use SEMPRE como primeiro passo antes de qualquer análise. Só chame tools específicas se precisar aprofundar um tema. Nunca chame get_tudo como primeiro passo.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  { name: "get_tudo", description: "Snapshot COMPLETO da empresa: premissas, receitas, despesas, capital, regime, DRE, indicadores, caixa, valuation, diagnóstico, saúde, governança, estratégico e prescritivo. Use quando precisar de visão 360° para uma decisão.", parameters: { type: "object", properties: {}, required: [] } },
  {
    name: "get_alertas_criticos",
    description: "Retorna apenas os alertas críticos e de atenção do diagnóstico automático com número exato e fonte. Use como segundo passo após get_resumo_executivo para identificar onde aprofundar a análise. Mais eficiente que get_diagnostico quando só precisa saber 'o que está errado'.",
    parameters: { type: "object", properties: {}, required: [] },
  },

  {
    name: "simular_alavanca",
    description: "Aplica alavancas e retorna impacto imediato em EBITDA, margem e valuation.\nConvenção de sinais — siga exatamente:\n- receitaPct: positivo = aumento (ex: 10 = +10% receita), negativo = queda\n- cpvPct: negativo = redução de custo (ex: -15 = cortar 15% do CPV), positivo = aumento\n- fixosPct: negativo = corte (ex: -20 = cortar 20% dos fixos), positivo = aumento\n- pmrDelta: negativo = reduzir prazo de recebimento (melhora caixa), positivo = piorar\n- pmpDelta: positivo = ampliar prazo com fornecedor (melhora caixa), negativo = reduzir\nExemplos: 'cortar 20% dos fixos' → fixosPct: -20 | 'reduzir PMR em 5 dias' → pmrDelta: -5",
    parameters: {
      type: "object",
      properties: {
        receitaPct: { type: "number" }, cpvPct: { type: "number" },
        fixosPct: { type: "number" }, pmrDelta: { type: "number" }, pmpDelta: { type: "number" },
      },
      required: [],
    },
  },

  // --- Benchmark setorial ---
  {
    name: "listar_setores",
    description: "Lista os setores disponíveis para comparação. Filtra opcionalmente por tipo (servicos/comercio/industria).",
    parameters: { type: "object", properties: { tipo: { type: "string", enum: ["servicos", "comercio", "industria"] } }, required: [] },
  },
  {
    name: "comparar_com_setor",
    description: "Compara os indicadores da empresa com benchmarks de mercado. O parâmetro setor é opcional — se omitido, usa automaticamente o tipo de negócio da empresa cadastrada.",
    parameters: {
      type: "object",
      properties: {
        setor: { type: "string", description: "Opcional. ID ou trecho do nome do setor (ex: 'varejo', 'saas'). Omita para usar automaticamente o businessType da empresa." },
      },
      required: [],
    },
  },

  // --- Macro ---
  {
    name: "get_macro",
    description: "Retorna os principais indicadores macro atuais (Selic, CDI, IPCA, IGP-M, câmbio) via API do Banco Central.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_serie_macro",
    description: "Retorna histórico de uma série macro do BCB.",
    parameters: {
      type: "object",
      properties: {
        serie: { type: "string", enum: MACRO_SERIES_KEYS as readonly string[] as string[] },
        ultimos: { type: "number", description: "Quantos pontos (padrão 12)." },
      },
      required: ["serie"],
    },
  },

  // --- Cenários ---
  {
    name: "listar_cenarios", description: "Lista cenários salvos para esta empresa.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "salvar_cenario", description: "Salva o cenário simulado atual com um nome.",
    parameters: { type: "object", properties: { nome: { type: "string" }, notas: { type: "string" } }, required: ["nome"] },
  },
  {
    name: "excluir_cenario", description: "Remove um cenário salvo pelo id ou nome.",
    parameters: { type: "object", properties: { idOuNome: { type: "string" } }, required: ["idOuNome"] },
  },
  {
    name: "carregar_cenario",
    description: "Carrega um cenário salvo e aplica suas alavancas no simulador (atualiza a UI). Use quando o consultor disser 'aplique o cenário X' ou 'volte para o cenário Otimista'. Para listar os cenários disponíveis, use listar_cenarios.",
    parameters: { type: "object", properties: { idOuNome: { type: "string", description: "ID ou nome exato do cenário." } }, required: ["idOuNome"] },
  },
  {
    name: "projetar",
    description: "Projeção plurianual estruturada (mesmo engine da aba Análise — buildForecast). Gera receita/EBITDA/Lucro/FCL/NCG mês-a-mês com escalonamento de folha por step, ganho de escala no CPV e cálculo de VPL/TIR/Payback. Use quando o consultor pedir 'projete os próximos N meses' ou 'qual o VPL desse projeto?'.",
    parameters: {
      type: "object",
      properties: {
        meses: { type: "number", description: "Horizonte em meses (12, 24, 36, 60)." },
        crescimentoMensalPct: { type: "number", description: "Crescimento composto mensal da receita (%). Default 1,0." },
        inflacaoFixosAA: { type: "number", description: "Inflação anual dos custos fixos (%). Default 5." },
        ganhoEscalaCpvAA: { type: "number", description: "Ganho de escala anual no CPV (%). Default 0." },
        stepReceitaPct: { type: "number", description: "A cada X% de receita extra vs base, folha sobe 1 step. Default 50." },
        stepFolhaPct: { type: "number", description: "Incremento de folha por step (%). Default 25." },
        capexInicial: { type: "number", description: "Investimento inicial em t=0 (R$). Default 0." },
      },
      required: ["meses"],
    },
  },
  {
    name: "sensibilidade",
    description: "Análise de sensibilidade (mesmo engine da aba Análise — runSensitivity). Varia preço/volume/CPV/folha/fixos/juros em ±5/10/15% e mede impacto no output escolhido. Retorna elasticidade média por driver.",
    parameters: {
      type: "object",
      properties: {
        output: { type: "string", enum: ["ebitda", "lucroLiquido", "saldoCaixa", "roic"], description: "Métrica de saída. Default: ebitda." },
        drivers: {
          type: "array",
          items: { type: "string", enum: ["preco", "volume", "cpv", "folha", "fixos", "juros"] },
          description: "Drivers a testar. Default: todos.",
        },
      },
      required: [],
    },
  },

  // --- Plano de ação ---
  {
    name: "listar_acoes", description: "Lista o plano de ação. Filtra por status opcional.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["aberta", "em_andamento", "concluida", "cancelada"] } }, required: [] },
  },
  {
    name: "criar_acao", description: "Adiciona uma ação ao plano (origem = chat).",
    parameters: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        descricao: { type: "string" },
        responsavel: { type: "string" },
        prazo: { type: "string", description: "Data ISO (YYYY-MM-DD) ou texto." },
        impactoEsperado: { type: "string" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "atualizar_acao", description: "Atualiza status/dados de uma ação.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["aberta", "em_andamento", "concluida", "cancelada"] },
        responsavel: { type: "string" }, prazo: { type: "string" }, impactoEsperado: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "excluir_acao", description: "Remove ação do plano.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },

  // --- Compliance/Tributário ---
  {
    name: "simular_regime_tributario",
    description: "Compara Simples × Presumido × Real e indica o de menor carga (heurístico).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "diagnostico_tributario",
    description: "Gera um diagnóstico detalhado da situação fiscal atual, detectando economias potenciais (ex: migração para Real).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "checklist_compliance",
    description: "Lista obrigações fiscais/trabalhistas aplicáveis ao regime atual.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "simular_transicao_reforma",
    description: "Simula a carga tributária ano-a-ano no cronograma oficial da LC 214/2025 (2026–2033), considerando a cobrança híbrida (CBS+IBS parcial × PIS/COFINS+ICMS/ISS em redução gradual). Use quando o usuário perguntar sobre impacto da Reforma em anos específicos ('quanto vou pagar em 2030?', 'em que ano fica mais caro?'). Por padrão simula o regime atual da empresa nos anos 2026–2033.",
    parameters: {
      type: "object",
      properties: {
        regime: { type: "string", enum: ["simples", "presumido", "real"], description: "Regime a simular. Default: regime efetivo atual." },
        anos: { type: "array", items: { type: "number" }, description: "Anos a comparar. Default: [2026,2027,2028,2029,2030,2031,2032,2033]." },
      },
      required: [],
    },
  },
  {
    name: "simular_split_payment",
    description: "Calcula o impacto do Split Payment no fluxo de caixa e necessidade de capital de giro. O Split Payment retém o tributo no momento do pagamento eliminando o float atual. Use quando o consultor perguntar sobre impacto da reforma no caixa.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];



export function asOpenAITools() {
  return TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// Anthropic usa um formato ligeiramente diferente: input_schema no topo.
export function asAnthropicTools() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ============================================================
// Execução
// ============================================================

function compareSectorMd(state: AppState, sector: SectorBenchmark): string {
  // SSOT: regime efetivo (downgrade automático se exceder limite Simples).
  const { dre } = buildDRE(state, resolveEffectiveRegime(state));
  const ind = calcIndicators(state, dre);
  const rows: string[] = [];
  rows.push(`## Comparativo com Setor: ${sector.label}`);
  rows.push("");
  rows.push("| Indicador | Seu valor | P25 | Mediana | P75 | Posição |");
  rows.push("| --- | --- | --- | --- | --- | --- |");
  const items = [
    { label: "Margem Bruta", v: ind.margemBruta, b: sector.margemBruta, hi: true, unit: "%" },
    { label: "Margem EBITDA", v: ind.margemEbitda, b: sector.margemEbitda, hi: true, unit: "%" },
    { label: "Margem Líquida", v: ind.margemLiquida, b: sector.margemLiquida, hi: true, unit: "%" },
    { label: "Giro do Ativo", v: ind.giroAtivo, b: sector.giroAtivo, hi: true, unit: "x" },
    { label: "Endividamento", v: ind.endividamentoGeral, b: sector.endividamento, hi: false, unit: "%" },
    { label: "PMR (dias)", v: state.revenue.pmr, b: sector.pmr, hi: false, unit: "d" },
    { label: "PMP (dias)", v: state.revenue.pmp, b: sector.pmp, hi: false, unit: "d" },
  ];
  items.forEach(it => {
    const r = rank(it.v, it.b, it.hi);
    const fmt = (n: number) => it.unit === "x" ? n.toFixed(2) + "x" : `${n.toFixed(1)}${it.unit}`;
    rows.push(`| ${it.label} | ${fmt(it.v)} | ${fmt(it.b.p25)} | ${fmt(it.b.p50)} | ${fmt(it.b.p75)} | ${r.label} |`);
  });
  return rows.join("\n");
}

// === Writers para Forecast e Sensitivity (engines do lib/finance — SSOT com a UI) ===
function forecastToMarkdown(cfg: ForecastConfig, r: ForecastResult): string {
  const lines: string[] = [];
  lines.push(`## Projeção ${cfg.horizonteMeses} meses (engine buildForecast)`);
  lines.push(`- Crescimento receita: ${cfg.crescimentoMensalPct.toFixed(2)}% a.m. · Inflação fixos: ${cfg.inflacaoFixosAA}% a.a. · Ganho escala CPV: ${cfg.ganhoEscalaCpvAA}% a.a.`);
  lines.push(`- Step folha: a cada ${cfg.stepReceitaPct}% de receita extra → +${cfg.stepFolhaPct}% folha · Capex inicial: ${brl(cfg.capexInicial)}`);
  lines.push("");
  lines.push(`**Acumulado:** Receita ${brl(r.totalReceita)} · EBITDA ${brl(r.totalEbitda)} · Lucro ${brl(r.totalLucro)} · FCL ${brl(r.totalFcl)} · ΔNCG ${brl(r.totalDeltaNcg)}`);
  lines.push(`**Métricas de retorno:** VPL ${brl(r.vpl)} · TIR ${r.tir != null ? `${r.tir.toFixed(2)}% a.m.` : (r.tirError ?? "n/d")} · Payback ${r.paybackMeses != null ? `${r.paybackMeses} meses` : "não recuperado"} · Taxa desconto ${(r.taxaDescontoMensal * 100).toFixed(2)}% a.m.`);
  // Resumo anual
  const yearly: { ano: number; receita: number; ebitda: number; fcl: number }[] = [];
  for (let y = 0; y * 12 < r.meses.length; y++) {
    const chunk = r.meses.slice(y * 12, (y + 1) * 12);
    yearly.push({
      ano: y + 1,
      receita: chunk.reduce((s, m) => s + m.receita, 0),
      ebitda: chunk.reduce((s, m) => s + m.ebitda, 0),
      fcl: chunk.reduce((s, m) => s + m.fcl, 0),
    });
  }
  lines.push("\n| Ano | Receita | EBITDA | Margem | FCL |\n| --- | --- | --- | --- | --- |");
  yearly.forEach(y => {
    const mg = y.receita > 0 ? (y.ebitda / y.receita) * 100 : 0;
    lines.push(`| ${y.ano} | ${brl(y.receita)} | ${brl(y.ebitda)} | ${mg.toFixed(1)}% | ${brl(y.fcl)} |`);
  });
  return lines.join("\n");
}

function sensitivityToMarkdown(r: SensitivityResult): string {
  const out: string[] = [];
  out.push(`## Sensibilidade — ${r.outputLabel} (baseline ${brl(r.baseline)})`);
  out.push(`_Deltas testados: ${r.deltas.map(d => `${d >= 0 ? "+" : ""}${d}%`).join(", ")}_`);
  out.push("");
  out.push(`| Driver | ${r.deltas.map(d => `${d >= 0 ? "+" : ""}${d}%`).join(" | ")} | Elasticidade |`);
  out.push(`| --- | ${r.deltas.map(() => "---").join(" | ")} | --- |`);
  r.rows.forEach(row => {
    const cells = r.deltas.map(d => {
      const c = row.cells.find(x => x.deltaPct === d);
      return c ? `${c.pctChange >= 0 ? "+" : ""}${c.pctChange.toFixed(1)}%` : "—";
    });
    out.push(`| ${row.label} | ${cells.join(" | ")} | ${row.elasticity.toFixed(2)} |`);
  });
  const top = r.rows[0];
  if (top) out.push(`\n**Maior alavanca:** ${top.label} (elasticidade ${top.elasticity.toFixed(2)}).`);
  return out.join("\n");
}


export function runTool(name: string, args: any, state: AppState, simulatedState?: AppState, simParams?: SimulatorParams): string | Promise<string> {
  const sec = getSectionsCached(state, simulatedState);
  const company = state.companyName || "default";
  switch (name) {
    case "get_premissas": return sec.premissas;
    case "get_receitas": return sec.receitas;
    case "get_despesas": return sec.despesas;
    case "get_capital": return sec.capital;
    case "get_regime_tributario": return sec.regime;
    case "get_dre": return sec.dre;
    case "get_indicadores": return sec.indicadores;
    case "get_fluxo_caixa": return sec.caixa;
    case "get_valuation": return sec.valuation;
    case "get_diagnostico": return sec.diagnostico;
    case "get_saude_financeira": return sec.saude;
    case "get_governanca": return sec.governanca || "_Módulo de Governança não preenchido pelo consultor._";
    case "get_estrategico": return sec.estrategico || "_Análise estratégica não preenchida pelo consultor._";
    case "get_prescritivo": return sec.prescritivo;
    case "get_comparativo_simulado":
      return sec.comparativo ?? "Nenhum cenário simulado ativo — todas as alavancas estão em 0.";
    case "get_resumo_executivo": {
      const { dre } = buildDRE(state, resolveEffectiveRegime(state));
      const ind = calcIndicators(state, dre);
      const val = buildValuation(state, defaultValuationParams(state.businessType));
      const health = computeHealth(state);
      return [
        "## Resumo Executivo",
        `- Receita Bruta Anual: ${brl(sum(dre.receitaBruta))}`,
        `- EBITDA: ${brl(sum(dre.ebitda))} (${pct(ind.margemEbitda)})`,
        `- Lucro Líquido: ${brl(sum(dre.lucroLiquido))} (${pct(ind.margemLiquida)})`,
        `- DSCR: ${ind.dscr.toFixed(2)}x ${ind.dscr < 1.5 ? "⚠️ abaixo de 1,5x" : "✅"}`,
        `- NCG: ${brl(ind.ncg)} | Gap Capital de Giro: ${brl(ind.gapCapitalGiro)}`,
        `- EV (base): ${brl(val.enterpriseValue.base)}`,
        `- Score de Saúde: ${health.total.toFixed(0)}/100 — ${health.grade} (${health.status})`,
        `- Pior mês de caixa: chame get_fluxo_caixa para detalhar`,
      ].join("\n");
    }
    case "get_tudo":
      return [
        sec.premissas, sec.receitas, sec.despesas, sec.capital, sec.regime,
        sec.dre, sec.indicadores, sec.caixa, sec.valuation, sec.diagnostico,
        sec.saude, sec.governanca, sec.estrategico, sec.prescritivo, sec.comparativo,
      ].filter(Boolean).join("\n\n---\n\n");

    case "get_alertas_criticos": {
      const { dre } = buildDRE(state, resolveEffectiveRegime(state));
      const ind = calcIndicators(state, dre);
      const alerts = diagnose(state, dre, ind);
      const critical = alerts.filter(a => a.level === "danger");
      const warning = alerts.filter(a => a.level === "warn");
      if (!alerts.length) return "✅ Nenhum alerta crítico ou de atenção identificado.";
      const lines = ["## Alertas do Diagnóstico"];
      if (critical.length) {
        lines.push("\n### 🔴 Críticos");
        critical.forEach(a => lines.push(`- **${a.title}** — ${a.message}`));
      }
      if (warning.length) {
        lines.push("\n### 🟡 Atenção");
        warning.forEach(a => lines.push(`- **${a.title}** — ${a.message}`));
      }
      lines.push(`\nTotal: ${critical.length} crítico(s), ${warning.length} atenção. ` +
        `Chame as tools específicas para aprofundar cada tema.`);
      return lines.join("\n");
    }



    case "simular_alavanca": {
      const params: SimulatorParams = {
        ...DEFAULT_SIM,
        priceDeltaPct: Number(args?.receitaPct) || 0,
        cpvDeltaPct: Number(args?.cpvPct) || 0,
        // fixosPct: negativo=corte / positivo=aumento. Simulator usa fixedCutPct invertido
        // (positivo=corte), por isso aplicamos a negação aqui.
        fixedCutPct: -(Number(args?.fixosPct) || 0),
        // PMR/PMP passam direto com qualquer sinal — simulator já lida com ambos.
        pmrDeltaDays: Number(args?.pmrDelta) || 0,
        pmpDeltaDays: Number(args?.pmpDelta) || 0,
      };
      const simulated = applySimulator(state, params);
      const simSec = buildSections(state, simulated);
      return simSec.comparativo ?? "Simulação aplicada, mas sem comparativo disponível.";
    }

    // --- Setor ---
    case "listar_setores": {
      const list = listSectors(args?.tipo);
      return `## Setores disponíveis\n\n${list.map(s => `- **${s.id}** — ${s.label} (${s.businessType})`).join("\n")}`;
    }
    case "comparar_com_setor": {
      // Resolução automática:
      // 1) parâmetro explícito → findSector(args.setor)
      // 2) businessType do state → findSector(state.businessType)
      // 3) último recurso → listSectors(state.businessType)[0] ?? listSectors()[0]
      let sector: SectorBenchmark | undefined;
      let auto = false;
      if (args?.setor) {
        sector = findSector(String(args.setor));
      }
      if (!sector && state.businessType) {
        sector = findSector(String(state.businessType));
        if (sector) auto = true;
      }
      if (!sector) {
        sector = listSectors(state.businessType)[0] ?? listSectors()[0];
        auto = true;
      }
      if (!sector) return "Nenhum setor disponível para comparação.";
      const header = auto
        ? `_(setor inferido automaticamente do cadastro: **${sector.label}** — businessType "${state.businessType ?? "n/d"}". Para outro setor, peça explicitamente.)_\n\n`
        : "";
      return header + compareSectorMd(state, sector);
    }

    // --- Macro ---
    case "get_macro": return getMacroSnapshot();
    case "get_serie_macro": {
      const k = args?.serie as SerieKey;
      const n = Number(args?.ultimos) || 12;
      if (!k) return "Parâmetro 'serie' obrigatório.";
      return getSerieFormatted(k, n);
    }

    // --- Cenários ---
    case "listar_cenarios": {
      const all = listScenarios(company);
      if (!all.length) return "_Nenhum cenário salvo._";
      return "## Cenários salvos\n\n" + all.map(s => {
        const sum = s.summary ? ` — EBITDA ${Math.round(s.summary.ebitda).toLocaleString("pt-BR")} (${s.summary.margemEbitda.toFixed(1)}%)` : "";
        return `- **${s.name}** (${s.id})${sum}`;
      }).join("\n");
    }
    case "salvar_cenario": {
      if (!args?.nome) return "Parâmetro 'nome' obrigatório.";
      // Detecta se há alguma alavanca não-zero ativa no simulador.
      const hasLevers = simParams != null &&
        Object.values(simParams).some(v => typeof v === "number" && v !== 0);

      // Quando há alavanca → captura simulatedState + simParams.
      // Quando não há   → captura state base + params=undefined (cenário base).
      const target = hasLevers ? (simulatedState ?? state) : state;
      const paramsToSave = hasLevers ? simParams : undefined;

      const { dre } = buildDRE(target, resolveEffectiveRegime(target));
      const ind = calcIndicators(target, dre);
      const rec = saveScenario(company, {
        name: String(args.nome),
        notes: args?.notas ? String(args.notas) : undefined,
        params: paramsToSave,
        summary: {
          ebitda: dre.ebitda.reduce((a, b) => a + b, 0),
          margemEbitda: ind.margemEbitda,
          lucroLiquido: dre.lucroLiquido.reduce((a, b) => a + b, 0),
        },
      });
      const note = hasLevers
        ? "_(parâmetros do simulador ativo capturados)_"
        : "_(cenário base salvo — nenhuma alavanca ativa)_";
      return `✅ Cenário **${rec.name}** salvo (id: ${rec.id}). ${note}`;
    }
    case "excluir_cenario": {
      const rec = getScenario(company, String(args?.idOuNome || ""));
      if (!rec) return "Cenário não encontrado.";
      deleteScenario(company, rec.id);
      return `🗑️ Cenário **${rec.name}** removido.`;
    }
    case "projetar": {
      const cfg: ForecastConfig = {
        ...DEFAULT_FORECAST_CFG,
        horizonteMeses: Number(args?.meses) || DEFAULT_FORECAST_CFG.horizonteMeses,
        crescimentoMensalPct: Number(args?.crescimentoMensalPct ?? DEFAULT_FORECAST_CFG.crescimentoMensalPct),
        inflacaoFixosAA: Number(args?.inflacaoFixosAA ?? DEFAULT_FORECAST_CFG.inflacaoFixosAA),
        ganhoEscalaCpvAA: Number(args?.ganhoEscalaCpvAA ?? DEFAULT_FORECAST_CFG.ganhoEscalaCpvAA),
        stepReceitaPct: Number(args?.stepReceitaPct ?? DEFAULT_FORECAST_CFG.stepReceitaPct),
        stepFolhaPct: Number(args?.stepFolhaPct ?? DEFAULT_FORECAST_CFG.stepFolhaPct),
        capexInicial: Number(args?.capexInicial ?? DEFAULT_FORECAST_CFG.capexInicial),
      };
      const res = buildForecast(state, cfg);
      return forecastToMarkdown(cfg, res);
    }
    case "sensibilidade": {
      const out = (args?.output as OutputKey) || "ebitda";
      const drivers = Array.isArray(args?.drivers) && args.drivers.length
        ? (args.drivers as DriverKey[])
        : undefined;
      const res = runSensitivity(state, out, drivers);
      return sensitivityToMarkdown(res);
    }
    case "carregar_cenario": {
      const idOrName = String(args?.idOuNome || "").trim();
      if (!idOrName) return "Parâmetro 'idOuNome' obrigatório.";
      const rec = getScenario(company, idOrName);
      if (!rec) return `Cenário "${idOrName}" não encontrado. Use listar_cenarios.`;
      // Dispara evento que routes/index.tsx escuta para aplicar os params no simulador.
      try {
        window.dispatchEvent(new CustomEvent("gz-apply-simulator-params", {
          detail: rec.params ?? null, // null = limpar (cenário base)
        }));
      } catch {
        return `⚠️ Não foi possível aplicar o cenário **${rec.name}** (ambiente sem window).`;
      }
      const tag = rec.params ? "alavancas restauradas" : "estado base restaurado (sem alavancas)";
      return `✅ Cenário **${rec.name}** carregado — ${tag}. A UI do simulador foi atualizada.`;
    }

    // --- Ações ---
    case "listar_acoes": {
      const items = listActions(company, args?.status ? { status: args.status as ActionStatus } : undefined);
      return `## Plano de Ação${args?.status ? ` (${args.status})` : ""}\n\n` + actionsToMarkdown(items);
    }
    case "criar_acao": {
      if (!args?.titulo) return "Parâmetro 'titulo' obrigatório.";
      const a = createAction(company, {
        titulo: String(args.titulo),
        descricao: args?.descricao ? String(args.descricao) : undefined,
        responsavel: args?.responsavel ? String(args.responsavel) : undefined,
        prazo: args?.prazo ? String(args.prazo) : undefined,
        impactoEsperado: args?.impactoEsperado ? String(args.impactoEsperado) : undefined,
        origem: "chat",
      });
      return `✅ Ação criada: **${a.titulo}** (id: ${a.id}).`;
    }
    case "atualizar_acao": {
      if (!args?.id) return "Parâmetro 'id' obrigatório.";
      const a = updateAction(company, String(args.id), {
        status: args?.status as ActionStatus | undefined,
        responsavel: args?.responsavel,
        prazo: args?.prazo,
        impactoEsperado: args?.impactoEsperado,
      });
      return a ? `✅ Ação atualizada: **${a.titulo}** → ${a.status}.` : "Ação não encontrada.";
    }
    case "excluir_acao": {
      if (!args?.id) return "Parâmetro 'id' obrigatório.";
      deleteAction(company, String(args.id));
      return "🗑️ Ação removida.";
    }

    // --- Compliance ---
    case "simular_regime_tributario": return regimeComparisonToMarkdown(state);
    case "diagnostico_tributario": return taxAuditToMarkdown(state);
    case "checklist_compliance": return checklistToMarkdown(state);
    case "simular_transicao_reforma": {
      const regime = (args?.regime as "simples" | "presumido" | "real") || resolveEffectiveRegime(state);
      const years: number[] = Array.isArray(args?.anos) && args.anos.length
        ? args.anos.map((y: any) => Number(y)).filter((y: number) => Number.isFinite(y))
        : [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
      const rows = compareYearsForRegime(state, regime, years);
      const lines = [
        `## Transição Tributária ano-a-ano — regime **${regime}**`,
        ``,
        `Cronograma oficial LC 214/2025 (cobrança híbrida CBS+IBS × PIS/COFINS+ICMS/ISS):`,
        ``,
        `| Ano | CBS | IBS | PIS/COFINS | ICMS/ISS | Carga efetiva | Anual |`,
        `|---|---:|---:|---:|---:|---:|---:|`,
      ];
      rows.forEach(r => {
        lines.push(
          `| ${r.year} | ${r.rates.cbsPct.toFixed(2)}% | ${r.rates.ibsPct.toFixed(2)}% | ${(r.rates.pisCofinsMult * 100).toFixed(0)}% | ${(r.rates.icmsIssMult * 100).toFixed(0)}% | ${r.effective.toFixed(2)}% | ${brl(r.annual)} |`,
        );
      });
      // Ano mais caro vs mais barato
      const sorted = [...rows].sort((a, b) => a.annual - b.annual);
      const min = sorted[0], max = sorted[sorted.length - 1];
      const delta = max.annual - min.annual;
      lines.push(``, `**Pico:** ${max.year} (${brl(max.annual)} · ${max.effective.toFixed(2)}%) · **Vale:** ${min.year} (${brl(min.annual)}) · **Δ:** ${brl(delta)} entre extremos.`);
      lines.push(`\n_Mantém preços e custos constantes; isola o efeito da Reforma._`);
      return lines.join("\n");
    }

    case "simular_split_payment": {
      // Prazos médios de recolhimento (dias após o mês de competência).
      const PRAZOS: { match: RegExp; dias: number; label: string }[] = [
        { match: /^DAS Simples/i, dias: 20, label: "DAS (Simples)" },
        { match: /^PIS/i,          dias: 25, label: "PIS" },
        { match: /^COFINS/i,       dias: 25, label: "COFINS" },
        { match: /^CBS/i,          dias: 25, label: "CBS" },
        { match: /^IBS/i,          dias: 10, label: "IBS" },
        { match: /^ISS/i,          dias: 10, label: "ISS" },
        { match: /^ICMS/i,         dias: 10, label: "ICMS" },
        { match: /^IRPJ|^Adicional IRPJ|^CSLL/i, dias: 45, label: "IRPJ/CSLL (trimestral)" },
      ];
      const regime = resolveEffectiveRegime(state);
      const { tax } = buildDRE(state, regime);
      const detail = tax.detail || {};

      // Float = Σ (carga_anual / 12) × (prazo_dias / 30)
      let floatTotal = 0;
      const linhas: { label: string; mensal: number; dias: number; float: number }[] = [];
      for (const [chave, valorAnual] of Object.entries(detail)) {
        if (!Number.isFinite(valorAnual) || valorAnual <= 0) continue;
        const cfg = PRAZOS.find(p => p.match.test(chave));
        if (!cfg) continue;
        const mensal = valorAnual / 12;
        const flt = mensal * (cfg.dias / 30);
        floatTotal += flt;
        linhas.push({ label: chave, mensal, dias: cfg.dias, float: flt });
      }

      const cargaMensalTotal = tax.annual / 12;
      // Kd pode vir em fração (0,18) ou em % (18). Normaliza para fração.
      const kdRaw = state.capital.kd ?? 0;
      const kd = kdRaw > 1 ? kdRaw / 100 : kdRaw;
      const custoAnual = floatTotal * kd;

      const md = [
        `## Impacto do Split Payment — regime **${regime}**`,
        ``,
        `| Tributo | Carga mensal | Prazo atual | Float (R$) |`,
        `|---|---:|---:|---:|`,
        ...linhas.map(l => `| ${l.label} | ${brl(l.mensal)} | ${l.dias}d | ${brl(l.float)} |`),
        `| **Total** | **${brl(cargaMensalTotal)}** | — | **${brl(floatTotal)}** |`,
        ``,
        `### Síntese`,
        `- **Carga tributária mensal:** ${brl(cargaMensalTotal)}`,
        `- **Float tributário atual:** ${brl(floatTotal)} — capital de terceiros (governo) que a empresa "usa" hoje entre apurar e recolher.`,
        `- **Capital de giro adicional com Split Payment:** ${brl(floatTotal)} (esse valor some permanentemente do caixa operacional).`,
        `- **Custo financeiro anual** (× Kd ${(kd * 100).toFixed(1)}%): **${brl(custoAnual)}**/ano.`,
        ``,
        `> _Impacto estimado para regime ${regime} — Split Payment entra na transição 2027-2032 conforme LC 214/2025._`,
      ].join("\n");
      return md;
    }

    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}

