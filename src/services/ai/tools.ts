// Tool registry — function calling (OpenAI-compatible).
// Cada tool retorna markdown que o LLM injeta como resultado para o próximo turno.

import type { AppState } from "@/lib/finance/types";
import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/lib/finance/simulator";
import { buildSections, getSectionsCached } from "./snapshot";
import { findSector, listSectors, rank, type SectorBenchmark } from "@/services/benchmark/sectors";
import { fetchSerie, getMacroSnapshot, getSerieFormatted, MACRO_SERIES_KEYS, type SerieKey } from "@/services/macro/bcb";
import { project, projectionToMarkdown, DEFAULT_PROJ } from "@/services/scenarios/projector";
import { sensitivity, sensitivityToMarkdown, type SensMetric } from "@/services/scenarios/sensitivity";
import { listScenarios, saveScenario, deleteScenario, getScenario } from "@/services/scenarios/store";
import { listActions, createAction, updateAction, deleteAction, actionsToMarkdown, type ActionStatus } from "@/services/actions/store";
import { regimeComparisonToMarkdown, taxAuditToMarkdown } from "@/services/compliance/tax";
import { checklistToMarkdown } from "@/services/compliance/checklist";
import { buildDRE, calcIndicators, resolveEffectiveRegime } from "@/lib/finance/calculations";
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
    name: "projetar",
    description: "Projeta receita/EBITDA para N meses com premissas de crescimento.",
    parameters: {
      type: "object",
      properties: {
        meses: { type: "number", description: "12, 24, 36 ou 60." },
        crescReceitaMensalPct: { type: "number" },
        inflVariavelMensalPct: { type: "number" },
        inflFixoMensalPct: { type: "number" },
        margemEbitdaAlvoPct: { type: "number" },
      },
      required: ["meses"],
    },
  },
  {
    name: "sensibilidade",
    description: "Análise de sensibilidade: varia ±20% receita/CPV/fixos e mede impacto na métrica escolhida.",
    parameters: {
      type: "object",
      properties: { metrica: { type: "string", enum: ["ebitda", "lucroLiquido", "valuation", "margemEbitda"] } },
      required: ["metrica"],
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


    case "simular_alavanca": {
      const params: SimulatorParams = {
        ...DEFAULT_SIM,
        priceDeltaPct: Number(args?.receitaPct) || 0,
        cpvDeltaPct: Number(args?.cpvPct) || 0,
        fixedCutPct: Math.max(0, -(Number(args?.fixosPct) || 0)),
        pmrDeltaDays: Math.min(0, Number(args?.pmrDelta) || 0),
        pmpDeltaDays: Math.max(0, Number(args?.pmpDelta) || 0),
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
      // Usa params reais do simulador ativo se houver alavanca acionada; senão, base.
      const params: SimulatorParams = simParams ?? { ...DEFAULT_SIM };
      const target = simulatedState ?? state;
      const { dre } = buildDRE(target, resolveEffectiveRegime(target));
      const ind = calcIndicators(target, dre);
      const rec = saveScenario(company, {
        name: String(args.nome),
        notes: args?.notas ? String(args.notas) : undefined,
        params,
        summary: {
          ebitda: dre.ebitda.reduce((a, b) => a + b, 0),
          margemEbitda: ind.margemEbitda,
          lucroLiquido: dre.lucroLiquido.reduce((a, b) => a + b, 0),
        },
      });
      const hasLevers = simParams && Object.values(simParams).some(v => typeof v === "number" && v !== 0);
      const note = hasLevers ? "_(parâmetros do simulador ativo capturados)_" : "_(cenário base — nenhuma alavanca ativa)_";
      return `✅ Cenário **${rec.name}** salvo (id: ${rec.id}). ${note}`;
    }
    case "excluir_cenario": {
      const rec = getScenario(company, String(args?.idOuNome || ""));
      if (!rec) return "Cenário não encontrado.";
      deleteScenario(company, rec.id);
      return `🗑️ Cenário **${rec.name}** removido.`;
    }
    case "projetar": {
      const months = Number(args?.meses) || 12;
      const res = project(state, months, {
        ...DEFAULT_PROJ,
        revenueGrowthMonthlyPct: Number(args?.crescReceitaMensalPct ?? DEFAULT_PROJ.revenueGrowthMonthlyPct),
        variableInflMonthlyPct: Number(args?.inflVariavelMensalPct ?? DEFAULT_PROJ.variableInflMonthlyPct),
        fixedInflMonthlyPct: Number(args?.inflFixoMensalPct ?? DEFAULT_PROJ.fixedInflMonthlyPct),
        targetEbitdaMarginPct: args?.margemEbitdaAlvoPct !== undefined ? Number(args.margemEbitdaAlvoPct) : undefined,
      });
      return projectionToMarkdown(res);
    }
    case "sensibilidade": {
      const m = (args?.metrica as SensMetric) || "ebitda";
      const rows = sensitivity(state, m);
      return sensitivityToMarkdown(m, rows);
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

    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}
