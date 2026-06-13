import type { AppState } from "@/lib/finance/types";
import { buildDRE, compareRegimes } from "@/lib/finance/calculations";
import { SIMPLES_SUBLIMITE_ESTADUAL } from "@/lib/finance/taxDefaults";
import { sum, fmtBRL } from "@/lib/finance/format";

export function regimeComparisonToMarkdown(state: AppState): string {
  // SSOT-4: usa llBy/best já calculados pela engine — não recalcula localmente.
  const regimes = compareRegimes(state);
  const { llBy, best } = regimes;
  const current = state.tax.regime;
  const delta = llBy[best] - llBy[current];

  let md = `## Comparativo de Regimes Tributários (Anual)\n\n`;
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
  const rbAnual = sum(state.revenue.bruta);
  const { dre } = buildDRE(state, state.tax.regime);
  const llAnual = sum(dre.lucroLiquido);
  const regimes = compareRegimes(state);
  const currentRegime = state.tax.regime;
  
  let md = `## Diagnóstico Tributário Detalhado\n\n`;
  md += `- **Regime Atual:** ${currentRegime.toUpperCase()}\n`;
  md += `- **Faturamento (RBT12):** ${fmtBRL(rbAnual)}\n`;
  md += `- **Lucro Líquido Real:** ${fmtBRL(llAnual)}\n\n`;

  const savings = regimes[currentRegime].annual - Math.min(regimes.simples.annual, regimes.presumido.annual, regimes.real.annual);

  md += `### 🔍 Análise de Oportunidades\n`;
  
  if (state.tax.regime === "presumido" && llAnual < (rbAnual * 0.10)) {
    md += `1. **Alerta de Lucro Real:** Seu lucro líquido (${((llAnual/rbAnual)*100).toFixed(1)}%) está abaixo da margem presumida. A migração para o Lucro Real é altamente recomendada.\n`;
  }
  
  if (savings > 0) {
    md += `2. **Inha de Economia:** Existe um potencial de redução de carga tributária de **${fmtBRL(savings)}/ano**.\n`;
  } else {
    md += `2. **Otimização:** Você já está no regime de menor carga nominal.\n`;
  }

  if (state.tax.regime === "simples" && rbAnual > SIMPLES_SUBLIMITE_ESTADUAL) {
    md += `3. **Sublimite do Simples:** Atenção! Acima de ${fmtBRL(SIMPLES_SUBLIMITE_ESTADUAL)} o ICMS/ISS é recolhido por fora (regime normal).\n`;
  }

  md += `\n### 💡 Sugestão de Pergunta para o Consultor:\n`;
  md += `> "Como ficaria meu valuation se eu capturasse esses ${fmtBRL(savings)} de economia tributária?"`;

  return md;
}
