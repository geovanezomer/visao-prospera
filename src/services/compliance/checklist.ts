// Checklist de obrigações fiscais/trabalhistas por regime.

import type { AppState } from "@/engines/finance/types";

interface Obligation {
  sigla: string;
  nome: string;
  periodicidade: string;
  prazo: string;
  regimes: Array<"simples" | "presumido" | "real" | "todos">;
  observacao?: string;
}

const OBLIGATIONS: Obligation[] = [
  { sigla: "DAS", nome: "Documento de Arrecadação do Simples", periodicidade: "Mensal", prazo: "Dia 20 do mês seguinte", regimes: ["simples"] },
  { sigla: "PGDAS-D", nome: "Programa Gerador do DAS", periodicidade: "Mensal", prazo: "Até dia 20", regimes: ["simples"] },
  { sigla: "DEFIS", nome: "Declaração de Informações Socioeconômicas e Fiscais", periodicidade: "Anual", prazo: "31/março do ano seguinte", regimes: ["simples"] },
  { sigla: "DCTFWeb", nome: "Declaração de Débitos e Créditos Tributários Federais Previdenciários", periodicidade: "Mensal", prazo: "Até dia 15 do 2º mês subsequente", regimes: ["presumido", "real"] },
  { sigla: "ECF", nome: "Escrituração Contábil Fiscal", periodicidade: "Anual", prazo: "Último dia útil de julho", regimes: ["presumido", "real"] },
  { sigla: "ECD", nome: "Escrituração Contábil Digital", periodicidade: "Anual", prazo: "Último dia útil de maio", regimes: ["presumido", "real"] },
  { sigla: "EFD-Contribuições", nome: "EFD das Contribuições (PIS/COFINS)", periodicidade: "Mensal", prazo: "10º dia útil do 2º mês subsequente", regimes: ["presumido", "real"] },
  { sigla: "EFD-ICMS/IPI", nome: "EFD ICMS/IPI (SPED Fiscal)", periodicidade: "Mensal", prazo: "Varia por UF (normalmente dia 20)", regimes: ["presumido", "real"] },
  { sigla: "eSocial", nome: "Sistema de Escrituração de Obrigações Trabalhistas", periodicidade: "Mensal/Eventual", prazo: "Eventos até dia 15", regimes: ["todos"] },
  { sigla: "DCTF Mensal", nome: "Declaração de Débitos e Créditos Tributários Federais", periodicidade: "Mensal", prazo: "15º dia útil do 2º mês subsequente", regimes: ["presumido", "real"] },
  { sigla: "DIRF", nome: "Declaração do Imposto de Renda Retido na Fonte", periodicidade: "Anual", prazo: "Último dia útil de fevereiro", regimes: ["todos"], observacao: "Substituída gradualmente pela DCTFWeb" },
  { sigla: "RAIS / CAGED", nome: "Movimentação trabalhista (via eSocial)", periodicidade: "Mensal", prazo: "Eventos eSocial", regimes: ["todos"] },
];

export function checklistToMarkdown(state: AppState): string {
  const regime = state.tax.regime;
  const applicable = OBLIGATIONS.filter(o => o.regimes.includes(regime) || o.regimes.includes("todos"));
  const out: string[] = [];
  out.push(`## Checklist de Compliance Fiscal — Regime ${regime}`);
  out.push("");
  out.push("| Sigla | Obrigação | Periodicidade | Prazo |");
  out.push("| --- | --- | --- | --- |");
  applicable.forEach(o => out.push(`| ${o.sigla} | ${o.nome} | ${o.periodicidade} | ${o.prazo} |`));
  const notes = applicable.filter(o => o.observacao);
  if (notes.length) {
    out.push("");
    out.push("**Observações:**");
    notes.forEach(o => out.push(`- ${o.sigla}: ${o.observacao}`));
  }
  out.push("");
  out.push("> Lista geral federal; obrigações estaduais/municipais (GIA, DESTDA, NFS-e local) variam por UF/município.");
  return out.join("\n");
}
