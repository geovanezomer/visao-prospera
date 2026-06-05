// Snapshot em camadas + estimativa de tokens + sanitização + cache por hash.
import type { AppState } from "@/lib/finance/types";
import { buildDRE, calcIndicators, diagnose } from "@/lib/finance/calculations";
import { buildCashFlow } from "@/lib/finance/cashflow";
import { buildValuation, defaultValuationParams } from "@/lib/finance/valuation";
import { computeHealth } from "@/lib/finance/health";
import { buildPrescriptiveCards } from "@/lib/finance/prescriptive";
import { MESES, sum, fmtNum } from "@/lib/finance/format";

// ===== Helpers =====
const safe = (n: any) =>
  (typeof n === "number" && Number.isFinite(n)) ? n : 0;

const brl = (n: number) => `R$ ${safe(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number, d = 1) => `${safe(n).toFixed(d)}%`;

function tryRun<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => "---").join(" | ");
  return `| ${headers.join(" | ")} |\n| ${sep} |\n${rows.map(r => `| ${r.join(" | ")} |`).join("\n")}`;
}

/** Estimativa grosseira de tokens (1 token ~ 4 chars em português). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

// ============================================================
// CAMADAS — cada uma retorna uma string markdown independente
// ============================================================

export interface SnapshotSections {
  premissas: string;
  dre: string;
  indicadores: string;
  diagnostico: string;
  caixa: string;
  valuation: string;
  saude: string;
  prescritivo: string;
  estrategico: string;
  comparativo?: string; // estado base vs simulado
}

export function buildSections(state: AppState, simulatedState?: AppState): SnapshotSections {
  const built = tryRun(() => buildDRE(state, state.tax.regime), null as any);
  const dre = built?.dre ?? null;
  const ind = dre ? tryRun(() => calcIndicators(state, dre), null as any) : null;
  const cf = tryRun(() => buildCashFlow(state), null as any);
  const val = tryRun(() => buildValuation(state, defaultValuationParams(state.businessType)), null as any);
  const health = tryRun(() => computeHealth(state), null as any);
  const cards = tryRun(() => buildPrescriptiveCards(state), [] as any[]);

  // ----- premissas -----
  const p: string[] = [
    `## Empresa e Premissas`,
    `- **Empresa:** ${state.companyName || "(sem nome)"}`,
    `- **Negócio:** ${state.businessType}`,
    `- **Regime:** ${state.tax.regime}${state.tax.regime === "simples" ? ` (Anexo ${state.tax.simplesAnexo}, Fator R ${pct(state.tax.fatorR)})` : ""}`,
    `- **Era tributária:** ${state.tax.era ?? "atual"}`,
    `- **Ke ${pct(state.capital.ke * 100)} | Kd ${pct(state.capital.kd * 100)}**`,
    `- **PL:** ${brl(state.capital.patrimonioLiquido)} | **Dívida onerosa:** ${brl(state.capital.dividaOnerosa)} | **Ativo total:** ${brl(state.capital.ativoTotal)}`,
    `- **PMR ${state.revenue.pmr}d · PMP ${state.revenue.pmp}d**`,
    `- **Caixa mínimo:** ${brl(state.cashflow.caixaMinimo)}`,
  ];

  // ----- DRE -----
  const dreLines: string[] = [];
  if (dre) {
    dreLines.push(`## DRE Anual (R$)`);
    dreLines.push(table(
      ["Linha", "Anual"],
      [
        ["Receita Bruta", brl(sum(dre.receitaBruta))],
        ["(−) Deduções inadimplência", brl(sum(dre.deducoesInadimplencia))],
        ["(−) Outras deduções", brl(sum(dre.outrasDeducoes))],
        ["(−) Impostos sobre venda", brl(sum(dre.impostosVendas))],
        ["(−) PDD", brl(sum(dre.pdd))],
        ["= Receita Líquida", brl(sum(dre.receitaLiquida))],
        ["(−) CPV/CMV/CSP", brl(sum(dre.cpv))],
        ["= Lucro Bruto", brl(sum(dre.lucroBruto))],
        ["(−) Despesas Operacionais", brl(sum(dre.despesasOperacionais))],
        ["= EBITDA", brl(sum(dre.ebitda))],
        ["(−) Depreciação", brl(sum(dre.depreciacao))],
        ["= EBIT", brl(sum(dre.ebit))],
        ["(+/−) Resultado Financeiro", brl(sum(dre.resultadoFinanceiro))],
        ["= LAIR", brl(sum(dre.lair))],
        ["(−) IRPJ + CSLL", brl(sum(dre.impostos))],
        ["= Lucro Líquido", brl(sum(dre.lucroLiquido))],
        ["Custos Fixos (ano)", brl(sum(dre.custosFixos))],
        ["Custos Variáveis (ano)", brl(sum(dre.custosVariaveis))],
        ["Folha CLT (anual)", brl(dre.folhaCltAnual)],
        ["Carga tributária total", brl(sum(dre.impostosTotal))],
      ],
    ));
    dreLines.push(`\n### DRE Mensal — Receita / EBITDA / LL`);
    dreLines.push(table(
      ["Mês", "Receita", "EBITDA", "LL"],
      MESES.map((m, i) => [m, brl(dre.receitaBruta[i]), brl(dre.ebitda[i]), brl(dre.lucroLiquido[i])]),
    ));
    const cats = Object.entries(dre.despesasPorCategoria || {}).filter(([, v]) => sum(v as number[]) > 0);
    if (cats.length) {
      dreLines.push(`\n### Despesas por categoria (ano)`);
      cats.forEach(([k, v]) => dreLines.push(`- ${k}: ${brl(sum(v as number[]))}`));
    }
  }

  // ----- Indicadores -----
  const indLines: string[] = [];
  if (ind) {
    indLines.push(`## Indicadores`);
    indLines.push(table(
      ["Indicador", "Valor"],
      [
        ["Margem Bruta", pct(ind.margemBruta)],
        ["Margem EBITDA", pct(ind.margemEbitda)],
        ["Margem EBIT", pct(ind.margemEbit)],
        ["Margem Líquida", pct(ind.margemLiquida)],
        ["Margem de Contribuição", pct(ind.margemContribuicao)],
        ["Ponto Equilíbrio (op.)", brl(ind.pontoEquilibrio)],
        ["Ponto Equilíbrio (fin.)", brl(ind.pontoEquilibrioFinanceiro)],
        ["ROE", pct(ind.roe)], ["ROA", pct(ind.roa)], ["ROIC", pct(ind.roic)],
        ["WACC", pct(ind.wacc * 100, 2)],
        ["Ciclo Financeiro (d)", fmtNum(safe(ind.cicloFinanceiro), 0)],
        ["NCG", brl(ind.ncg)],
        ["Gap Cap. Giro", brl(ind.gapCapitalGiro)],
        ["Liquidez Corrente", fmtNum(safe(ind.liquidezCorrente), 2)],
        ["Liquidez Seca", fmtNum(safe(ind.liquidezSeca), 2)],
        ["Liquidez Imediata", fmtNum(safe(ind.liquidezImediata), 2)],
        ["Endividamento Geral", pct(ind.endividamentoGeral)],
        ["Grau Endivid. (D/PL)", pct(ind.grauEndividamento)],
        ["Cobertura Juros (EBIT/Juros)", fmtNum(safe(ind.coberturaJuros), 2) + "x"],
        ["Giro Ativo", fmtNum(safe(ind.giroAtivo), 2)],
        ["Dívida Líq./EBITDA", fmtNum(safe(ind.dividaLiqEbitda), 2) + "x"],
        ["Payback PL (anos)", fmtNum(safe(ind.payback), 1)],
        ["FCF (proxy)", brl(ind.fcf)],
      ],
    ));
  }

  // ----- Diagnóstico -----
  const diagLines: string[] = [];
  if (dre && ind) {
    const diag = tryRun(() => diagnose(state, dre, ind), [] as any[]);
    if (diag.length) {
      diagLines.push(`## Diagnóstico`);
      diag.forEach((d: any) => diagLines.push(`- **[${d.level.toUpperCase()}] ${d.title}** — ${d.message}`));
    }
  }

  // ----- Fluxo de caixa -----
  const cfLines: string[] = [];
  if (cf) {
    cfLines.push(`## Fluxo de Caixa Mensal`);
    cfLines.push(table(
      ["Mês", "Recebim.", "Pagam.Op.", "Fluxo Op.", "Capex", "Financ.", "Saldo Final"],
      MESES.map((m, i) => [
        m,
        brl(cf.recebimentos[i]),
        brl(cf.pagamentosFornecedores[i] + cf.pagamentosFixos[i] + cf.pagamentosVariaveis[i] + cf.pagamentosFinanceiros[i] + cf.pagamentosImpostos[i]),
        brl(cf.fluxoOperacional[i]),
        brl(cf.capex[i]),
        brl(cf.fluxoFinanciamento[i]),
        brl(cf.saldoFinal[i]),
      ]),
    ));
    cfLines.push(`\n**Totais:** Recebim. ${brl(cf.totais.recebimentos)} · Fluxo Op. ${brl(cf.totais.fluxoOperacional)} · Invest. ${brl(cf.totais.fluxoInvestimento)} · Financ. ${brl(cf.totais.fluxoFinanciamento)} · Variação ${brl(cf.totais.variacao)} · Saldo final ${brl(cf.totais.saldoFinal)}`);
    if (cf.totais.pioresMes) cfLines.push(`**Pior mês:** ${cf.totais.pioresMes.mes} → ${brl(cf.totais.pioresMes.saldo)}`);
    if (cf.alertas?.length) {
      cfLines.push(`**Alertas:**`);
      cf.alertas.forEach((a: any) => cfLines.push(`- ${a.mes}: ${brl(a.saldo)} (${a.tipo})`));
    }
  }

  // ----- Valuation -----
  const valLines: string[] = [];
  if (val) {
    valLines.push(`## Valuation`);
    valLines.push(`- **Método:** ${val.method}`);
    valLines.push(`- **EV:** ${brl(val.enterpriseValue.pessimista)} (pessim.) · **${brl(val.enterpriseValue.base)} (base)** · ${brl(val.enterpriseValue.otimista)} (otim.)`);
    valLines.push(`- **Equity:** ${brl(val.equityValue.pessimista)} (pessim.) · **${brl(val.equityValue.base)} (base)** · ${brl(val.equityValue.otimista)} (otim.)`);
    valLines.push(`- **Múltiplos implícitos:** EV/EBITDA ${fmtNum(safe(val.impliedMultiple.evEbitda), 2)}x · EV/Receita ${fmtNum(safe(val.impliedMultiple.evRevenue), 2)}x`);
    valLines.push(`- **Confiança:** ${val.confidenceScore} — ${val.confidenceRationale}`);
    valLines.push(`- **Haircut:** ${pct(val.haircutApplied * 100)}`);
    if (val.dcfDetails) {
      const d = val.dcfDetails as any;
      valLines.push(`- **DCF:** WACC ${pct(safe(d.wacc) * 100, 2)} · g ${pct(safe(d.terminalGrowth) * 100, 2)} · VP fluxos ${brl(safe(d.presentValueFlows))} · VP terminal ${brl(safe(d.presentValueTerminal))}`);
    }
    if (val.narrative) valLines.push(`> ${val.narrative}`);
  }

  // ----- Saúde -----
  const healthLines: string[] = [];
  if (health) {
    healthLines.push(`## Saúde Financeira`);
    healthLines.push(`- **Financeiro:** ${fmtNum(safe(health.financial), 0)}/100`);
    healthLines.push(`- **Total (c/ haircut):** ${fmtNum(safe(health.total), 0)}/100 — **Nota ${health.grade}** (${health.status})`);
    healthLines.push(`- **Headline:** ${health.headline}`);
    if (health.dimensions?.length) {
      healthLines.push(`### Dimensões:`);
      health.dimensions.forEach((d: any) =>
        healthLines.push(`- **${d.label}** [${d.status}]: ${d.value} (score ${fmtNum(safe(d.score), 0)}, peso ${pct(safe(d.weight) * 100, 0)}) — ${d.comment}`),
      );
    }
  }

  // ----- Prescritivo -----
  const presLines: string[] = [];
  if (cards?.length) {
    presLines.push(`## Recomendações Prescritivas`);
    cards.slice(0, 10).forEach((c: any) =>
      presLines.push(`- **${c.title || c.id}** — ${c.description || c.summary || ""}`),
    );
  }

  // ----- Estratégico -----
  const estrLines: string[] = [];
  if (state.strategic) {
    estrLines.push(`## Análise Estratégica (qualitativa)`);
    estrLines.push("```json");
    estrLines.push(JSON.stringify(state.strategic, null, 2));
    estrLines.push("```");
  }

  // ----- Comparativo simulado vs base -----
  let compLines: string | undefined;
  if (simulatedState && simulatedState !== state) {
    const builtSim = tryRun(() => buildDRE(simulatedState, simulatedState.tax.regime), null as any);
    const dreSim = builtSim?.dre ?? null;
    const indSim = dreSim ? tryRun(() => calcIndicators(simulatedState, dreSim), null as any) : null;
    const valSim = tryRun(() => buildValuation(simulatedState, defaultValuationParams(simulatedState.businessType)), null as any);
    if (dreSim && ind && indSim) {
      const rows: string[][] = [
        ["Receita Bruta", brl(sum(dre!.receitaBruta)), brl(sum(dreSim.receitaBruta))],
        ["EBITDA", brl(sum(dre!.ebitda)), brl(sum(dreSim.ebitda))],
        ["Lucro Líquido", brl(sum(dre!.lucroLiquido)), brl(sum(dreSim.lucroLiquido))],
        ["Margem EBITDA", pct(ind.margemEbitda), pct(indSim.margemEbitda)],
        ["ROIC", pct(ind.roic), pct(indSim.roic)],
        ["DSCR-like (Cob. Juros)", fmtNum(safe(ind.coberturaJuros), 2) + "x", fmtNum(safe(indSim.coberturaJuros), 2) + "x"],
      ];
      if (val && valSim) rows.push(["EV (base value.)", brl(val.enterpriseValue.base), brl(valSim.enterpriseValue.base)]);
      compLines = `## Comparativo: Cenário Base × Cenário Simulado\n` + table(["Métrica", "Base", "Simulado"], rows);
    }
  }

  return {
    premissas: p.join("\n"),
    dre: dreLines.join("\n"),
    indicadores: indLines.join("\n"),
    diagnostico: diagLines.join("\n"),
    caixa: cfLines.join("\n"),
    valuation: valLines.join("\n"),
    saude: healthLines.join("\n"),
    prescritivo: presLines.join("\n"),
    estrategico: estrLines.join("\n"),
    comparativo: compLines,
  };
}

/**
 * Monta o snapshot full respeitando um orçamento de tokens.
 * Prioridade: premissas + DRE + indicadores + valuation + comparativo são sempre mantidos.
 * Demais são incluídas até saturar o orçamento.
 */
export function buildSnapshot(state: AppState, simulatedState?: AppState, maxTokens = 6000): string {
  const s = buildSections(state, simulatedState);
  const essential = [s.premissas, s.dre, s.indicadores, s.valuation, s.comparativo].filter(Boolean) as string[];
  const optional = [s.diagnostico, s.caixa, s.saude, s.prescritivo, s.estrategico].filter(Boolean);

  const parts: string[] = [...essential];
  let used = estimateTokens(parts.join("\n\n"));
  for (const opt of optional) {
    const t = estimateTokens(opt);
    if (used + t > maxTokens) continue;
    parts.push(opt);
    used += t;
  }
  return parts.join("\n\n");
}

// ============================================================
// Cache por hash do estado (evita reconstruir sem mudanças)
// ============================================================
let cacheKey = "";
let cacheVal: SnapshotSections | null = null;
let cacheSimKey = "";

function fastHash(o: any): string {
  try {
    const s = JSON.stringify(o);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return `${s.length}:${h}`;
  } catch { return Math.random().toString(); }
}

export function getSectionsCached(state: AppState, simulatedState?: AppState): SnapshotSections {
  const k = fastHash(state);
  const sk = simulatedState ? fastHash(simulatedState) : "";
  if (k === cacheKey && sk === cacheSimKey && cacheVal) return cacheVal;
  const v = buildSections(state, simulatedState);
  cacheKey = k; cacheSimKey = sk; cacheVal = v;
  return v;
}
