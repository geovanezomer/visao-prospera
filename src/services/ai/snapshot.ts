// Snapshot COMPLETO do estado financeiro em markdown estruturado para o LLM.
// Inclui tudo que o sistema calcula: DRE, fluxo de caixa, indicadores,
// valuation, saúde, diagnóstico, premissas e dados estratégicos.

import type { AppState } from "@/lib/finance/types";
import { buildDRE, calcIndicators, diagnose } from "@/lib/finance/calculations";
import { buildCashFlow } from "@/lib/finance/cashflow";
import { buildValuation, defaultValuationParams } from "@/lib/finance/valuation";
import { computeHealth } from "@/lib/finance/health";
import { buildPrescriptiveCards } from "@/lib/finance/prescriptive";
import { MESES, sum, fmtNum } from "@/lib/finance/format";

const brl = (n: number) =>
  Number.isFinite(n)
    ? `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : "—";
const pct = (n: number, d = 1) =>
  Number.isFinite(n) ? `${n.toFixed(d)}%` : "—";

function tryRun<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => "---").join(" | ");
  const head = headers.join(" | ");
  const body = rows.map(r => r.join(" | ")).join("\n");
  return `| ${head} |\n| ${sep} |\n${rows.map(r => `| ${r.join(" | ")} |`).join("\n")}`;
}

export function buildSnapshot(state: AppState): string {
  const out: string[] = [];

  // ===== 1. EMPRESA & PREMISSAS =====
  out.push(`## Empresa e Premissas`);
  out.push(`- **Empresa:** ${state.companyName || "(sem nome)"}`);
  out.push(`- **Tipo de negócio:** ${state.businessType}`);
  out.push(`- **Regime tributário:** ${state.tax.regime}${state.tax.regime === "simples" ? ` (Anexo ${state.tax.simplesAnexo}, Fator R ${pct(state.tax.fatorR)})` : ""}`);
  out.push(`- **Era tributária:** ${state.tax.era ?? "atual"}`);
  out.push(`- **Capital próprio (Ke):** ${pct(state.capital.ke * 100)} | **Custo da dívida (Kd):** ${pct(state.capital.kd * 100)}`);
  out.push(`- **PL:** ${brl(state.capital.patrimonioLiquido)} | **Dívida onerosa:** ${brl(state.capital.dividaOnerosa)} | **Ativo total:** ${brl(state.capital.ativoTotal)}`);
  out.push(`- **PMR:** ${state.revenue.pmr}d | **PMP:** ${state.revenue.pmp}d`);
  out.push(`- **Caixa mínimo configurado:** ${brl(state.cashflow.caixaMinimo)}`);

  // ===== 2. DRE =====
  const { dre, tax } = tryRun(() => buildDRE(state, state.tax.regime), { dre: null as any, tax: null as any });
  if (dre) {
    out.push(`\n## DRE Anual (R$)`);
    out.push(table(
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
        ["Custos Fixos (total ano)", brl(sum(dre.custosFixos))],
        ["Custos Variáveis (total ano)", brl(sum(dre.custosVariaveis))],
        ["Folha CLT (anual c/ encargos)", brl(dre.folhaCltAnual)],
        ["Carga tributária total", brl(sum(dre.impostosTotal))],
      ],
    ));

    out.push(`\n### DRE Mensal — Receita / EBITDA / Lucro Líquido`);
    out.push(table(
      ["Mês", "Receita Bruta", "EBITDA", "Lucro Líquido"],
      MESES.map((m, i) => [m, brl(dre.receitaBruta[i]), brl(dre.ebitda[i]), brl(dre.lucroLiquido[i])]),
    ));

    // Despesas por categoria
    const cats = Object.entries(dre.despesasPorCategoria || {}).filter(([, v]) => sum(v as number[]) > 0);
    if (cats.length) {
      out.push(`\n### Despesas por categoria (anual)`);
      out.push(cats.map(([k, v]) => `- ${k}: ${brl(sum(v as number[]))}`).join("\n"));
    }
  }

  // ===== 3. INDICADORES =====
  if (dre) {
    const ind = tryRun(() => calcIndicators(state, dre), null as any);
    if (ind) {
      out.push(`\n## Indicadores Financeiros`);
      out.push(table(
        ["Indicador", "Valor"],
        [
          ["Margem Bruta", pct(ind.margemBruta)],
          ["Margem EBITDA", pct(ind.margemEbitda)],
          ["Margem EBIT", pct(ind.margemEbit)],
          ["Margem Líquida", pct(ind.margemLiquida)],
          ["Margem de Contribuição", pct(ind.margemContribuicao)],
          ["Ponto de Equilíbrio (operacional)", brl(ind.pontoEquilibrio)],
          ["Ponto de Equilíbrio (financeiro)", brl(ind.pontoEquilibrioFinanceiro)],
          ["ROE", pct(ind.roe)],
          ["ROA", pct(ind.roa)],
          ["ROIC", pct(ind.roic)],
          ["WACC", pct(ind.wacc * 100, 2)],
          ["Ciclo Financeiro (dias)", fmtNum(ind.cicloFinanceiro, 0)],
          ["NCG", brl(ind.ncg)],
          ["Gap Capital de Giro", brl(ind.gapCapitalGiro)],
          ["Liquidez Corrente", fmtNum(ind.liquidezCorrente, 2)],
          ["Liquidez Seca", fmtNum(ind.liquidezSeca, 2)],
          ["Liquidez Imediata", fmtNum(ind.liquidezImediata, 2)],
          ["Endividamento Geral", pct(ind.endividamentoGeral)],
          ["Grau de Endividamento (D/PL)", pct(ind.grauEndividamento)],
          ["Cobertura de Juros (EBIT/Juros)", fmtNum(ind.coberturaJuros, 2) + "x"],
          ["Giro do Ativo", fmtNum(ind.giroAtivo, 2)],
          ["Dívida Líquida / EBITDA", fmtNum(ind.dividaLiqEbitda, 2) + "x"],
          ["Payback do PL (anos)", fmtNum(ind.payback, 1)],
          ["FCF (proxy)", brl(ind.fcf)],
        ],
      ));
    }

    // ===== 4. DIAGNÓSTICO =====
    if (ind) {
      const diag = tryRun(() => diagnose(state, dre, ind), [] as any[]);
      if (diag.length) {
        out.push(`\n## Diagnóstico Automático`);
        diag.forEach((d: any) => out.push(`- **[${d.level.toUpperCase()}] ${d.title}** — ${d.message}`));
      }
    }
  }

  // ===== 5. FLUXO DE CAIXA =====
  const cf = tryRun(() => buildCashFlow(state), null as any);
  if (cf) {
    out.push(`\n## Fluxo de Caixa Mensal (R$)`);
    out.push(table(
      ["Mês", "Recebimentos", "Pgtos Op.", "Fluxo Op.", "Capex", "Financ.", "Saldo Final"],
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
    out.push(`\n**Totais:** Recebimentos ${brl(cf.totais.recebimentos)} | Fluxo Op. ${brl(cf.totais.fluxoOperacional)} | Fluxo Invest. ${brl(cf.totais.fluxoInvestimento)} | Fluxo Financ. ${brl(cf.totais.fluxoFinanciamento)} | Variação ${brl(cf.totais.variacao)} | Saldo Final ${brl(cf.totais.saldoFinal)}`);
    if (cf.totais.pioresMes) {
      out.push(`**Pior mês de caixa:** ${cf.totais.pioresMes.mes} → ${brl(cf.totais.pioresMes.saldo)}`);
    }
    if (cf.alertas?.length) {
      out.push(`**Alertas de caixa:**`);
      cf.alertas.forEach((a: any) => out.push(`- ${a.mes}: ${brl(a.saldo)} (${a.tipo})`));
    }
  }

  // ===== 6. VALUATION =====
  const val = tryRun(() => buildValuation(state, defaultValuationParams(state.businessType)), null as any);
  if (val) {
    out.push(`\n## Valuation`);
    out.push(`- **Método:** ${val.method}`);
    out.push(`- **Enterprise Value:** ${brl(val.enterpriseValue.pessimista)} (pessim.) | **${brl(val.enterpriseValue.base)} (base)** | ${brl(val.enterpriseValue.otimista)} (otim.)`);
    out.push(`- **Equity Value:** ${brl(val.equityValue.pessimista)} (pessim.) | **${brl(val.equityValue.base)} (base)** | ${brl(val.equityValue.otimista)} (otim.)`);
    out.push(`- **Múltiplos implícitos:** EV/EBITDA = ${fmtNum(val.impliedMultiple.evEbitda, 2)}x | EV/Receita = ${fmtNum(val.impliedMultiple.evRevenue, 2)}x`);
    out.push(`- **Confiança:** ${val.confidenceScore} — ${val.confidenceRationale}`);
    out.push(`- **Haircut estratégico aplicado:** ${pct(val.haircutApplied * 100)}`);
    if (val.dcfDetails) {
      const d = val.dcfDetails as any;
      out.push(`- **DCF:** WACC ${pct((d.wacc ?? 0) * 100, 2)} | g ${pct((d.terminalGrowth ?? 0) * 100, 2)} | VP fluxos ${brl(d.presentValueFlows ?? 0)} | VP terminal ${brl(d.presentValueTerminal ?? 0)}`);
    }
    if (val.narrative) out.push(`> ${val.narrative}`);
  }

  // ===== 7. SAÚDE FINANCEIRA =====
  const h = tryRun(() => computeHealth(state), null as any);
  if (h) {
    out.push(`\n## Saúde Financeira`);
    out.push(`- **Score financeiro:** ${fmtNum(h.financial, 0)} / 100`);
    out.push(`- **Score total (c/ haircut estratégico):** ${fmtNum(h.total, 0)} / 100 — **Nota ${h.grade}** (${h.status})`);
    out.push(`- **Headline:** ${h.headline}`);
    if (h.dimensions?.length) {
      out.push(`\n### Dimensões da saúde:`);
      h.dimensions.forEach((d: any) =>
        out.push(`- **${d.label}** [${d.status}]: ${d.value} (score ${fmtNum(d.score, 0)}, peso ${pct(d.weight * 100, 0)}) — ${d.comment}`),
      );
    }
  }

  // ===== 8. RECOMENDAÇÕES PRESCRITIVAS =====
  const cards = tryRun(() => buildPrescriptiveCards(state), [] as any[]);
  if (cards?.length) {
    out.push(`\n## Recomendações Prescritivas`);
    cards.slice(0, 8).forEach((c: any) => {
      out.push(`- **${c.title || c.id}** — ${c.description || c.summary || ""}`);
    });
  }

  // ===== 9. ESTRATÉGICO (qualitativo) =====
  if (state.strategic) {
    out.push(`\n## Análise Estratégica (qualitativa)`);
    out.push("```json");
    out.push(JSON.stringify(state.strategic, null, 2));
    out.push("```");
  }

  return out.join("\n");
}
