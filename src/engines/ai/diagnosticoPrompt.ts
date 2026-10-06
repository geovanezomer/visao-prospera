// =====================================================================
// PROMPT do Diagnóstico Executivo — versionado para auditoria CVM.
//
// REGRA DE OURO: a IA APENAS interpreta o briefing JSON.
// - Não recalcula números.
// - Não inventa indicadores fora do briefing.
// - Não recomenda alavancas fora de `briefing.alavancas`.
// - Não inventa comparações setoriais fora dos thresholds.
// O componente renderiza os números vindos do briefing, não do texto da IA.
// =====================================================================

import type { Briefing } from "@/engines/finance/briefing";
import type { IndicadorKey } from "@/data/thresholds";
import { describeMoveCatalogForPrompt } from "@/engines/finance/levers/aiMoves";

/** Versão do prompt — incrementar quebra o cache e força nova geração. */
export const PROMPT_VERSION = "v2" as const;

/**
 * Proposta propositiva: IA escolhe um move do catálogo + magnitude.
 * O engine compila para Partial<SimulatorParams> e a UI mostra "Abrir no Simulador".
 * Mantida OPCIONAL: respostas antigas (sem propostas) continuam válidas.
 */
export interface PropostaSimulador {
  moveId: string;
  magnitude: number;
  justificativa: string;
  impactoQualitativo: string;
}

/** Shape EXATO do JSON que esperamos do modelo. */
export interface DiagnosticoExecutivo {
  /** Frase única, ≤140 chars, brutalmente direta. */
  veredito: string;
  /** 2-3 frases situando setor/porte/momento. */
  contexto: string;
  /** Top 3 pontos críticos, ordenados por severidade. */
  pontosCriticos: Array<{
    titulo: string;
    explicacao: string;
    /** Chaves de indicador citadas (subset de IndicadorKey). */
    indicadoresReferenciados: IndicadorKey[];
  }>;
  /** Top 2 pontos fortes. */
  pontosFortes: Array<{
    titulo: string;
    explicacao: string;
  }>;
  /** 3-5 ações priorizadas. */
  proximosPassos: Array<{
    acao: string;
    impactoEsperado: string;
    prazo: "imediato" | "30d" | "90d";
  }>;
  /** 0-4 propostas propositivas — sliders pré-configurados do Simulador. */
  propostasSimulador?: PropostaSimulador[];
}

/** System prompt — identidade + regras + schema do output. */
export function buildSystemPrompt(): string {
  return `Você é um CFO sênior brasileiro escrevendo um DIAGNÓSTICO EXECUTIVO para um consultor CVM apresentar ao cliente dele (uma PME).

REGRAS INVIOLÁVEIS:
1. Você recebe um BRIEFING JSON com indicadores já calculados e classificados. NÃO recalcule nada.
2. NÃO cite números literais (ex: "14%", "R$ 2,4M"). Use linguagem qualitativa ("acima da mediana do setor", "ciclo financeiro longo"). O sistema interpolará os números reais ao renderizar.
3. NÃO invente recomendações fora de \`briefing.alavancas\`. Use SOMENTE essas.
4. NÃO mencione indicadores que não estejam em \`briefing.classificacoes\`.
5. Tom executivo, direto, em português brasileiro. Sem clichês ("é importante notar", "vale destacar").
6. Se um ponto crítico for grave, diga grave. Não suavize.

FORMATO DE SAÍDA: retorne APENAS um JSON válido (sem markdown, sem texto antes/depois) com este shape:

{
  "veredito": "string ≤140 chars — 1 frase resumo",
  "contexto": "string — 2-3 frases situando setor/porte",
  "pontosCriticos": [
    { "titulo": "string", "explicacao": "string ≤220 chars", "indicadoresReferenciados": ["chaveIndicador"] }
  ],
  "pontosFortes": [
    { "titulo": "string", "explicacao": "string ≤180 chars" }
  ],
  "proximosPassos": [
    { "acao": "string", "impactoEsperado": "string qualitativo", "prazo": "imediato" | "30d" | "90d" }
  ],
  "propostasSimulador": [
    { "moveId": "string (do catálogo abaixo)", "magnitude": number, "justificativa": "string ≤180 chars", "impactoQualitativo": "string ≤120 chars" }
  ]
}

Limites: pontosCriticos ≤3, pontosFortes ≤2, proximosPassos entre 3 e 5, propostasSimulador entre 2 e 4.
\`indicadoresReferenciados\` DEVE usar exatamente as chaves presentes em briefing.classificacoes[].indicador.

CATÁLOGO DE MOVES PARA \`propostasSimulador\` (use APENAS estes \`moveId\`):
${describeMoveCatalogForPrompt()}

REGRAS DAS PROPOSTAS:
- Cada proposta deve atacar um dos \`pontosCriticos\` identificados.
- \`magnitude\` DEVE estar dentro da faixa indicada (será clipada se sair).
- Para "pct" use número (ex: 10 = 10%); para "dias" use dias; para "BRL" use valor absoluto.
- Não repita o mesmo \`moveId\` duas vezes.
- Se o diagnóstico for saudável e nenhum ajuste se justificar, retorne \`propostasSimulador: []\`.`;
}

/** User prompt — entrega o briefing serializado. */
export function buildUserPrompt(briefing: Briefing): string {
  // Removemos `geradoEm` para manter o prompt determinístico (cache-friendly).
  const { geradoEm: _omit, ...rest } = briefing;
  void _omit;
  return `BRIEFING (versão schema ${briefing.schemaVersion}):

\`\`\`json
${JSON.stringify(rest, null, 2)}
\`\`\`

Gere o diagnóstico executivo no formato JSON especificado.`;
}
