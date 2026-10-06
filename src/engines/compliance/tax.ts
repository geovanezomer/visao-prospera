import type { AppState } from "@/engines/finance/types";
import { buildDRE, compareRegimes, resolveEffectiveRegime } from "@/engines/finance";
import { SIMPLES_SUBLIMITE_ESTADUAL } from "@/engines/finance/taxDefaults";
import { sum, fmtBRL } from "@/engines/finance/format";

export function regimeComparisonToMarkdown(state: AppState): string {
  // SSOT-4: usa llBy/best já calculados pela engine — não recalcula localmente.
  const era = state.tax.era ?? "atual";
  const regimes = compareRegimes(state, era);
  const { llBy, best } = regimes;
  const current = state.tax.regime;
  const delta = llBy[best] - llBy[current];

  let md = `## Comparativo de Regimes Tributários (Anual)\n\n`;
  md += `_Análise referente à era: **${era}** ${era !== "atual" ? "(Reforma Tributária)" : ""}_\n`;
  if (era === "transicao") {
    md += `\n> ⚠️ Valores incluem **CBS/IBS parciais** e PIS/COFINS+ICMS/ISS em redução proporcional conforme cronograma LC 214/2025 (2027–2032).\n`;
    md += `> Valores da transição representam o **PONTO MÉDIO** do cronograma (IBS ~50%, ICMS/ISS ~50%). Para um ano específico (ex: 2029), use a ferramenta \`simular_transicao_reforma\`.\n`;
  }
  if (era === "pleno")
    md += `\n> ℹ️ Valores refletem o regime **pleno CBS+IBS** (2033+), sem tributos legados.\n`;
  md += `\n`;
  md += `| Regime | Tributos Totais | Lucro Líquido | Eficácia |\n`;
  md += `| --- | --- | --- | --- |\n`;
  md += `| **Simples** | ${fmtBRL(regimes.simples.annual)} | ${fmtBRL(llBy.simples)} | ${best === "simples" ? "🏆 Melhor" : ""} |\n`;
  md += `| **Presumido** | ${fmtBRL(regimes.presumido.annual)} | ${fmtBRL(llBy.presumido)} | ${best === "presumido" ? "🏆 Melhor" : ""} |\n`;
  md += `| **Real** | ${fmtBRL(regimes.real.annual)} | ${fmtBRL(llBy.real)} | ${best === "real" ? "🏆 Melhor" : ""} |\n\n`;

  if (current !== best && delta > 100) {
    md += `⚠️ **Economia Potencial:** A migração do ${current} para o **${best}** pode gerar uma economia de **${fmtBRL(delta)}/ano**.`;
  } else {
    md += `✅ A empresa já está no regime mais vantajoso (${current}).`;
  }

  return md;
}

export function taxAuditToMarkdown(state: AppState): string {
  const era = state.tax.era ?? "atual";
  const rbAnual = sum(state.revenue.bruta);
  // Auditoria #5: usa regime EFETIVO (consistente com Indicadores/Diagnóstico/Valuation).
  // Quando RBT12 estoura o limite do Simples, o regime efetivo migra para Presumido
  // e a auditoria precisa refletir isso.
  const currentRegime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, currentRegime);
  const llAnual = sum(dre.lucroLiquido);
  const regimes = compareRegimes(state, era);

  let md = `## Diagnóstico Tributário Detalhado\n\n`;
  md += `_Análise referente à era: **${era}** ${era !== "atual" ? "(Reforma Tributária)" : ""}_\n`;
  if (era === "transicao") {
    md += `\n> ⚠️ Carga híbrida: CBS/IBS parciais + PIS/COFINS+ICMS/ISS em redução proporcional (cronograma LC 214/2025, 2027–2032).\n`;
    md += `> Valores da transição representam o **PONTO MÉDIO** do cronograma (IBS ~50%, ICMS/ISS ~50%). Para um ano específico (ex: 2029), use a ferramenta \`simular_transicao_reforma\`.\n`;
  }
  if (era === "pleno") md += `\n> ℹ️ Regime pleno CBS+IBS (2033+) — tributos legados extintos.\n`;
  md += `\n`;
  md += `- **Regime Atual:** ${currentRegime.toUpperCase()}\n`;
  md += `- **Faturamento (RBT12):** ${fmtBRL(rbAnual)}\n`;
  md += `- **Lucro Líquido Real:** ${fmtBRL(llAnual)}\n\n`;

  // Economia = ganho de LUCRO LÍQUIDO no melhor regime elegível. Comparar só o
  // total de tributos ignorava a CPP sobre a folha (dentro do DAS no Simples,
  // por fora no Presumido/Real) e incluía o Simples mesmo após desenquadramento.
  const savings = Math.max(0, regimes.llBy[regimes.best] - regimes.llBy[currentRegime]);

  md += `### 🔍 Análise de Oportunidades\n`;

  if (currentRegime === "presumido" && llAnual < rbAnual * 0.1) {
    md += `1. **Alerta de Lucro Real:** Seu lucro líquido (${((llAnual / rbAnual) * 100).toFixed(1)}%) está abaixo da margem presumida. A migração para o Lucro Real é altamente recomendada.\n`;
  }

  if (savings > 0) {
    md += `2. **Oportunidade de economia:** No regime ${regimes.best.toUpperCase()} o lucro líquido seria **${fmtBRL(savings)}/ano** maior.\n`;
  } else {
    md += `2. **Otimização:** Você já está no regime de menor carga nominal.\n`;
  }

  if (currentRegime === "simples" && rbAnual > SIMPLES_SUBLIMITE_ESTADUAL) {
    md += `3. **Sublimite do Simples:** Atenção! Acima de ${fmtBRL(SIMPLES_SUBLIMITE_ESTADUAL)} o ICMS/ISS é recolhido por fora (regime normal).\n`;
  }

  md += `\n### 💡 Sugestão de Pergunta para o Consultor:\n`;
  md += `> "Como ficaria meu valuation se eu capturasse esses ${fmtBRL(savings)} de economia tributária?"`;

  return md;
}
