// Tool registry — function calling (OpenAI-compatible).
// Cada tool retorna markdown que o LLM injeta como resultado para o próximo turno.

import type { AppState } from "@/lib/finance/types";
import { applySimulator, DEFAULT_SIM, type SimulatorParams } from "@/lib/finance/simulator";
import { buildSections, getSectionsCached } from "./snapshot";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_premissas",
    description: "Retorna as premissas da empresa (regime tributário, capital, prazos médios, caixa mínimo).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_dre",
    description: "Retorna a DRE completa anual e mensal (receita, custos, EBITDA, lucro líquido, impostos).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_indicadores",
    description: "Retorna todos os indicadores financeiros (margens, ROE/ROA/ROIC, WACC, liquidez, endividamento, cobertura de juros, ciclo financeiro).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_fluxo_caixa",
    description: "Retorna o fluxo de caixa mensal completo, com pior mês e alertas.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_valuation",
    description: "Retorna o valuation (EV, equity value, múltiplos implícitos, DCF, haircut estratégico, confiança).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_diagnostico",
    description: "Retorna o diagnóstico automático e os alertas de risco.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_saude_financeira",
    description: "Retorna o score de saúde financeira (financeiro + total) e as dimensões avaliadas.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_prescritivo",
    description: "Retorna as recomendações prescritivas de ações que o consultor pode propor ao cliente.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_comparativo_simulado",
    description: "Compara o cenário base com o cenário simulado atualmente ativo (alavancas do simulador).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "simular_alavanca",
    description: "Aplica uma alavanca temporária e retorna o impacto. Use para responder 'e se cortar 20% dos fixos?'.",
    parameters: {
      type: "object",
      properties: {
        receitaPct: { type: "number", description: "Variação % na receita (ex: -10 = corte de 10%, +5 = aumento de 5%)." },
        cpvPct: { type: "number", description: "Variação % no CPV/CMV/CSP." },
        fixosPct: { type: "number", description: "Variação % nos custos fixos." },
        pmrDelta: { type: "number", description: "Variação em dias no PMR." },
        pmpDelta: { type: "number", description: "Variação em dias no PMP." },
      },
      required: [],
    },
  },
];

export function asOpenAITools() {
  return TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function runTool(name: string, args: any, state: AppState, simulatedState?: AppState): string {
  const sec = getSectionsCached(state, simulatedState);
  switch (name) {
    case "get_premissas": return sec.premissas;
    case "get_dre": return sec.dre;
    case "get_indicadores": return sec.indicadores;
    case "get_fluxo_caixa": return sec.caixa;
    case "get_valuation": return sec.valuation;
    case "get_diagnostico": return sec.diagnostico;
    case "get_saude_financeira": return sec.saude;
    case "get_prescritivo": return sec.prescritivo;
    case "get_comparativo_simulado":
      return sec.comparativo ?? "Nenhum cenário simulado ativo — todas as alavancas estão em 0.";
    case "simular_alavanca": {
      const params: SimulatorParams = {
        ...DEFAULT_SIM,
        receitaPct: Number(args?.receitaPct) || 0,
        cpvPct: Number(args?.cpvPct) || 0,
        fixosPct: Number(args?.fixosPct) || 0,
        pmrDelta: Number(args?.pmrDelta) || 0,
        pmpDelta: Number(args?.pmpDelta) || 0,
      };
      const simulated = applySimulator(state, params);
      const simSec = buildSections(state, simulated);
      return simSec.comparativo ?? "Simulação aplicada, mas não foi possível calcular o comparativo.";
    }
    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}
