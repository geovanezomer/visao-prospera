// Simulador comparativo de regime tributário — Simples × Presumido × Real.
// Heurística para PMEs; números aproximados — usar apenas como sinal.

import type { AppState } from "@/lib/finance/types";
import { buildDRE } from "@/lib/finance/calculations";
import { sum } from "@/lib/finance/format";

export interface RegimeComparison {
  regime: "Simples" | "Presumido" | "Real";
  cargaTotal: number;        // R$ anual
  cargaPct: number;          // % sobre receita
  obs: string[];
}

/** Alíquotas efetivas médias por anexo do Simples (estimativa para PMEs ~ R$ 1-4M/ano). */
const SIMPLES_EFFECTIVE = {
  I: 0.085, II: 0.095, III: 0.13, IV: 0.16, V: 0.21,
};

export function compareRegimes(state: AppState): RegimeComparison[] {
  const { dre } = buildDRE(state, state.tax.regime);
  const receita = sum(dre.receitaBruta);
  const lucroBruto = sum(dre.lucroBruto);
  const ebitda = sum(dre.ebitda);

  // ---- Simples ----
  const anexoFlag = state.tax.simplesAnexo as keyof typeof SIMPLES_EFFECTIVE | undefined;
  const aliqSimples = SIMPLES_EFFECTIVE[anexoFlag ?? "III"] ?? 0.13;
  const simples: RegimeComparison = {
    regime: "Simples",
    cargaTotal: receita * aliqSimples,
    cargaPct: aliqSimples * 100,
    obs: [
      `Alíquota efetiva estimada para o Anexo ${anexoFlag ?? "III"}: ${(aliqSimples * 100).toFixed(1)}%.`,
      receita > 4_800_000 ? "⚠️ Receita acima do teto do Simples (R$ 4,8M)." : "Dentro do teto do Simples (R$ 4,8M).",
      anexoFlag === "V" ? `Verifique Fator R atual (${(state.tax.fatorR ?? 0).toFixed(1)}%) — se ≥ 28%, migra para Anexo III (carga menor).` : "",
    ].filter(Boolean),
  };

  // ---- Presumido ----
  const bt = state.businessType;
  const presBaseIR = bt === "industria" || bt === "comercio" ? 0.08 : 0.32;
  const presBaseCSLL = bt === "industria" || bt === "comercio" ? 0.12 : 0.32;
  const irpj = receita * presBaseIR * 0.15 + Math.max(0, receita * presBaseIR - 240_000) * 0.10;
  const csll = receita * presBaseCSLL * 0.09;
  const pisCofins = receita * (0.0065 + 0.03);
  const icmsIss = bt === "servicos" ? receita * 0.05 : receita * 0.18; // estimativa
  const presumido: RegimeComparison = {
    regime: "Presumido",
    cargaTotal: irpj + csll + pisCofins + icmsIss,
    cargaPct: ((irpj + csll + pisCofins + icmsIss) / receita) * 100,
    obs: [
      `Base presumida: IRPJ ${(presBaseIR * 100).toFixed(0)}% · CSLL ${(presBaseCSLL * 100).toFixed(0)}%.`,
      "PIS/COFINS cumulativos (3,65%).",
      `${bt === "servicos" ? "ISS estimado em 5%" : "ICMS estimado em 18%"} — substitua pela alíquota real do município/UF.`,
      receita > 78_000_000 ? "⚠️ Receita acima do teto do Presumido (R$ 78M)." : "Dentro do teto do Presumido.",
    ],
  };

  // ---- Real ----
  // Aproximação: tributa lucro real (~lucro contábil) a 34% (IRPJ 15+10% adicional + CSLL 9%)
  const lucroEstimado = Math.max(0, ebitda * 0.85); // simplificação grossa
  const irpjReal = lucroEstimado * 0.15 + Math.max(0, lucroEstimado - 240_000) * 0.10;
  const csllReal = lucroEstimado * 0.09;
  const pisCofinsReal = receita * (0.0165 + 0.076) - lucroBruto * 0.0; // não-cumulativo, mas sem detalhar créditos
  const icmsIssReal = bt === "servicos" ? receita * 0.05 : receita * 0.18;
  const real: RegimeComparison = {
    regime: "Real",
    cargaTotal: irpjReal + csllReal + Math.max(0, pisCofinsReal) + icmsIssReal,
    cargaPct: ((irpjReal + csllReal + Math.max(0, pisCofinsReal) + icmsIssReal) / receita) * 100,
    obs: [
      "Tributa o lucro efetivo (34% IRPJ+CSLL).",
      "PIS/COFINS não-cumulativos (1,65% + 7,6%) com direito a créditos (não considerados aqui — carga real costuma ser menor).",
      "Indicado quando margem líquida < ~12% ou quando créditos de PIS/COFINS são relevantes.",
    ],
  };

  return [simples, presumido, real].sort((a, b) => a.cargaTotal - b.cargaTotal);
}

const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

export function regimeComparisonToMarkdown(state: AppState): string {
  const list = compareRegimes(state);
  const { dre } = buildDRE(state, state.tax.regime);
  const receita = sum(dre.receitaBruta);
  const out: string[] = [];
  out.push(`## Simulador de Regime Tributário`);
  out.push(`Receita bruta anual considerada: **${brl(receita)}** · Tipo: **${state.businessType}** · Regime atual: **${state.tax.regime}**`);
  out.push("");
  out.push("| Regime | Carga (R$) | Carga (% receita) |");
  out.push("| --- | --- | --- |");
  list.forEach(r => out.push(`| ${r.regime} | ${brl(r.cargaTotal)} | ${r.cargaPct.toFixed(2)}% |`));
  out.push("");
  out.push(`**Vencedor (menor carga):** ${list[0].regime} — economia vs pior: ${brl(list[list.length - 1].cargaTotal - list[0].cargaTotal)}.`);
  out.push("");
  list.forEach(r => {
    out.push(`### ${r.regime}`);
    r.obs.forEach(o => out.push(`- ${o}`));
  });
  out.push("");
  out.push(`> ⚠️ Estimativa heurística para sinalização. Decisão tributária real exige análise contábil detalhada com créditos, substituição tributária, benefícios fiscais e regime do município/UF.`);
  return out.join("\n");
}
