// Pipeline de sub-agentes especialistas — Análise 360°.
// Encadeia 3 estágios (cfo → controller → auditor), cada um lendo o output
// do estágio anterior como contexto. Disponível apenas a partir do Board Mode.
//
// Por que aqui: manter a lógica de orquestração separada do hook (UI) e do
// systemPrompt (conteúdo). Pure-ish: recebe runners injetáveis para teste.

import type { AIMode } from "./systemPrompt";

export const PIPELINE_360: ReadonlyArray<
  Exclude<AIMode, "chat" | "board" | "tributarista" | "contador">
> = ["cfo", "controller", "auditor"] as const;

export type Pipeline360Stage = (typeof PIPELINE_360)[number];

export const STAGE_LABEL: Record<Pipeline360Stage, string> = {
  cfo: "🧭 CFO — Tese Estratégica",
  controller: "🔎 Controller — Qualidade do Número",
  auditor: "🛡️ Auditor — Veredito Final",
};

/**
 * Monta o prompt do usuário para cada estágio, injetando o output anterior.
 * O estágio inicial recebe apenas a pergunta original; os seguintes recebem
 * um resumo do estágio anterior + a pergunta para reforçar o foco do papel.
 */
export function buildStagePrompt(
  stage: Pipeline360Stage,
  userQuestion: string,
  previous: Array<{ stage: Pipeline360Stage; output: string }>,
): string {
  const q = userQuestion.trim() || "Análise 360° desta empresa para decisão de conselho.";
  if (previous.length === 0) {
    return `[Pipeline 360° · Estágio 1/3 — CFO]\nPergunta do conselho: ${q}\n\nProduza sua tese no formato do MODO CFO ESTRATÉGICO.`;
  }
  const blocks = previous
    .map((p, i) => `### Estágio ${i + 1} — ${STAGE_LABEL[p.stage]}\n${p.output.trim()}`)
    .join("\n\n");
  const idx = previous.length + 1;
  const focus =
    stage === "controller"
      ? "Valide os números citados pelo CFO. Aponte inconsistências, dados frágeis ou conclusões que dependem de hipóteses não verificadas."
      : "Emita o veredito final do conselho: confirme/refute a tese, classifique riscos (Baixo/Médio/Alto) e proponha a decisão executiva.";
  return `[Pipeline 360° · Estágio ${idx}/3 — ${stage.toUpperCase()}]\nPergunta original: ${q}\n\n## Análises anteriores\n${blocks}\n\n## Sua tarefa\n${focus}`;
}

/** Cabeçalho markdown que prefixa a resposta de cada estágio na conversa. */
export function stageHeader(stage: Pipeline360Stage, idx: number): string {
  return `### ${STAGE_LABEL[stage]} _(estágio ${idx + 1}/${PIPELINE_360.length})_\n\n`;
}
