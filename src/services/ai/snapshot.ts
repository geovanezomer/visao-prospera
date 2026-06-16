// Snapshot em camadas + estimativa de tokens + sanitização + cache por hash.
import type { AppState } from "@/lib/finance/types";
import { buildDRE, calcIndicators, diagnose, resolveEffectiveRegime, compareErasForRegime } from "@/lib/finance/calculations";
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

export interface SnapshotNumeric {
  dre: ReturnType<typeof buildDRE>["dre"] | null;
  ind: ReturnType<typeof calcIndicators> | null;
  val: ReturnType<typeof buildValuation> | null;
  health: ReturnType<typeof computeHealth> | null;
  alerts: ReturnType<typeof diagnose>;
}

export interface SnapshotSections {
  premissas: string;
  receitas: string;
  despesas: string;
  capital: string;
  regime: string;
  /** Comparativo de eras da Reforma (atual/transição/pleno) — separado de `regime` para evitar duplicação com simular_transicao_reforma. */
  eras: string;
  dre: string;
  indicadores: string;
  diagnostico: string;
  caixa: string;
  valuation: string;
  saude: string;
  prescritivo: string;
  estrategico: string;
  governanca: string;
  comparativo?: string; // estado base vs simulado
  /** Dados numéricos pré-calculados — reutilizáveis por tools sem recalcular. */
  data?: SnapshotNumeric;
}


export function buildSections(state: AppState, simulatedState?: AppState): SnapshotSections {
  // SSOT: usa regime efetivo (downgrade automático Simples→Presumido se excedeu limite),
  // alinhado com TaxTab, IndicatorsTab, ValuationTab e demais consumidores.
  const effectiveRegime = tryRun(() => resolveEffectiveRegime(state), state.tax.regime);
  const built = tryRun(() => buildDRE(state, effectiveRegime), null as any);
  const dre = built?.dre ?? null;
  const ind = dre ? tryRun(() => calcIndicators(state, dre), null as any) : null;
  const cf = tryRun(() => buildCashFlow(state), null as any);
  const val = tryRun(() => buildValuation(state, defaultValuationParams(state.businessType)), null as any);
  const health = tryRun(() => computeHealth(state), null as any);
  const cards = tryRun(() => buildPrescriptiveCards(state), [] as any[]);

  // ----- premissas -----
  const regimeLabel = effectiveRegime !== state.tax.regime
    ? `${effectiveRegime} (nominal: ${state.tax.regime} — downgrade por exceder limite)`
    : state.tax.regime;
  const p: string[] = [
    `## Empresa e Premissas`,
    `- **Empresa:** ${state.companyName || "(sem nome)"}`,
    `- **Negócio:** ${state.businessType}`,
    `- **Regime:** ${regimeLabel}${effectiveRegime === "simples" ? ` (Anexo ${state.tax.simplesAnexo}, Fator R ${pct(state.tax.fatorR)})` : ""}`,
    `- **Era tributária:** ${state.tax.era ?? "atual"}`,
    // C-1 fix: state.capital.ke / kd já estão em % (ex.: 15 = 15%). Não multiplicar por 100.
    `- **Ke ${pct(state.capital.ke, 2)} | Kd ${pct(state.capital.kd, 2)}**`,
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
        ["(+) Outras Receitas Operacionais", brl(sum(dre.outrasReceitasOperacionais))],
        ["= EBITDA", brl(sum(dre.ebitda))],
        ["(−) Depreciação", brl(sum(dre.depreciacao))],
        ["= EBIT", brl(sum(dre.ebit))],
        ["(+/−) Resultado Financeiro", brl(sum(dre.resultadoFinanceiro))],
        ["(−) Custos Financeiros (juros)", brl(sum(dre.custosFinanceirosTotal))],
        ["= LAIR", brl(sum(dre.lair))],
        ["(−) IRPJ + CSLL", brl(sum(dre.impostos))],
        ["= Lucro Líquido", brl(sum(dre.lucroLiquido))],
        ["Custos Operacionais (total)", brl(sum(dre.custosOperacionaisTotal))],
        ["Custos Fixos (ano)", brl(sum(dre.custosFixos))],
        ["Custos Variáveis (ano)", brl(sum(dre.custosVariaveis))],
        ["Folha CLT (anual)", brl(dre.folhaCltAnual)],
        ["Carga tributária total", brl(sum(dre.impostosTotal))],
      ],
    ));
    dreLines.push(`\n### DRE Mensal completo (R$) — todas as linhas`);
    const monthlyRows: Array<[string, number[]]> = [
      ["Receita Bruta", dre.receitaBruta],
      ["(−) Deduções inadimplência", dre.deducoesInadimplencia],
      ["(−) Outras deduções", dre.outrasDeducoes],
      ["(−) Impostos sobre venda", dre.impostosVendas],
      ["(−) PDD", dre.pdd],
      ["= Receita Líquida", dre.receitaLiquida],
      ["(−) CPV/CMV/CSP", dre.cpv],
      ["= Lucro Bruto", dre.lucroBruto],
      ["(−) Despesas Operacionais", dre.despesasOperacionais],
      ["(+) Outras Receitas Operacionais", dre.outrasReceitasOperacionais],
      ["= EBITDA", dre.ebitda],
      ["(−) Depreciação", dre.depreciacao],
      ["= EBIT", dre.ebit],
      ["(+/−) Resultado Financeiro", dre.resultadoFinanceiro],
      ["(−) Custos Financeiros (juros)", dre.custosFinanceirosTotal],
      ["= LAIR", dre.lair],
      ["(−) IRPJ + CSLL", dre.impostos],
      ["= Lucro Líquido", dre.lucroLiquido],
      ["Custos Operacionais (total)", dre.custosOperacionaisTotal],
      ["Custos Fixos", dre.custosFixos],
      ["Custos Variáveis", dre.custosVariaveis],
      ["Carga tributária total", dre.impostosTotal],
    ];
    // Tabela mensal: linhas = contas, colunas = meses
    dreLines.push(table(
      ["Linha", ...MESES],
      monthlyRows.map(([label, arr]) => [label, ...arr.map(v => brl(v))]),
    ));

    // Tabela trimestral (Q1..Q4)
    const quarters = [[0,1,2],[3,4,5],[6,7,8],[9,10,11]];
    const qSum = (arr: number[]) => quarters.map(q => q.reduce((a, i) => a + safe(arr[i]), 0));
    dreLines.push(`\n### DRE Trimestral completo (R$)`);
    dreLines.push(table(
      ["Linha", "Q1", "Q2", "Q3", "Q4"],
      monthlyRows.map(([label, arr]) => [label, ...qSum(arr).map(v => brl(v))]),
    ));

    // Despesas por categoria — mensal
    const catsMensal = Object.entries(dre.despesasPorCategoria || {}).filter(([, v]) => sum(v as number[]) > 0);
    if (catsMensal.length) {
      dreLines.push(`\n### Despesas Operacionais por categoria — mensal (R$)`);
      dreLines.push(table(
        ["Categoria", ...MESES, "Anual"],
        catsMensal.map(([k, v]) => [k, ...(v as number[]).map(x => brl(x)), brl(sum(v as number[]))]),
      ));
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
        ["Margem de Segurança", pct(ind.margemSeguranca)],
        ["Ponto Equilíbrio (op.)", brl(ind.pontoEquilibrio)],
        ["Ponto Equilíbrio (fin.)", brl(ind.pontoEquilibrioFinanceiro)],
        ["GAO (alavancagem op.)", fmtNum(safe(ind.gao), 2) + "x"],
        ["ROE", pct(ind.roe)], ["ROA", pct(ind.roa)], ["ROIC", pct(ind.roic)],
        ["WACC", pct(ind.wacc, 2)],
        ["Ciclo Financeiro (d)", fmtNum(safe(ind.cicloFinanceiro), 0)],
        ["NCG", brl(ind.ncg)],
        ["Gap Cap. Giro", brl(ind.gapCapitalGiro)],
        ["Liquidez Corrente", fmtNum(safe(ind.liquidezCorrente), 2)],
        ["Liquidez Seca", fmtNum(safe(ind.liquidezSeca), 2)],
        ["Liquidez Imediata", fmtNum(safe(ind.liquidezImediata), 2)],
        ["Endividamento Geral", pct(ind.endividamentoGeral)],
        ["Grau Endivid. (D/PL)", pct(ind.grauEndividamento)],
        ["Cobertura Juros (EBIT/Juros)", fmtNum(safe(ind.coberturaJuros), 2) + "x"],
        ["DSCR (EBITDA/Serviço Dívida)", fmtNum(safe(ind.dscr), 2) + "x"],
        ["Giro Ativo", fmtNum(safe(ind.giroAtivo), 2)],
        ["Dívida Líq./EBITDA", fmtNum(safe(ind.dividaLiqEbitda), 2) + "x"],
        ["Dívida Líq./EBIT", fmtNum(safe(ind.dividaLiqEbit), 2) + "x"],
        ["Dívida Líq./PL", fmtNum(safe(ind.dividaLiqPl), 2) + "x"],
        ["Dívida Onerosa", brl(ind.dividaOnerosa)],
        ["Ativo Circulante", brl(ind.ativoCirculante)],
        ["Passivo Circulante", brl(ind.passivoCirculante)],
        ["Payback PL (anos)", fmtNum(safe(ind.payback), 1)],
        ["FCF (proxy)", brl(ind.fcf)],
        ["Conversão EBITDA→Caixa", pct(ind.conversaoEbitdaCaixa)],
        ["Qualidade do Lucro (FCF/LL)", fmtNum(safe(ind.qualidadeLucro), 2)],
        ["Receita Líq./Colaborador", brl(ind.receitaPorColaborador)],
        ["Faturamento/Colaborador", brl(ind.faturamentoPorColaborador)],
        ["EBITDA/Colaborador", brl(ind.ebitdaPorColaborador)],
        ["Lucro/Colaborador", brl(ind.lucroPorColaborador)],
        ["Custo Pessoal/Receita", pct(ind.custoPessoalSobreReceita)],
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
    cfLines.push(`## Fluxo de Caixa Mensal — completo (R$)`);
    // Tabela 1: entradas e saídas operacionais detalhadas
    cfLines.push(`\n### Entradas e Pagamentos Operacionais`);
    cfLines.push(table(
      ["Mês", "Saldo Ini.", "Recebim.", "Rec.Financ.", "Pag.Forn.", "Pag.Fixos", "Pag.Variáv.", "Pag.Financ.", "Pag.Impostos", "Fluxo Op."],
      MESES.map((m, i) => [
        m,
        brl(cf.saldoInicial[i]),
        brl(cf.recebimentos[i]),
        brl(cf.receitasFinanceiras[i]),
        brl(cf.pagamentosFornecedores[i]),
        brl(cf.pagamentosFixos[i]),
        brl(cf.pagamentosVariaveis[i]),
        brl(cf.pagamentosFinanceiros[i]),
        brl(cf.pagamentosImpostos[i]),
        brl(cf.fluxoOperacional[i]),
      ]),
    ));
    // Tabela 2: investimento, financiamento e saldo
    cfLines.push(`\n### Investimento, Financiamento e Saldo`);
    cfLines.push(table(
      ["Mês", "Capex", "Fluxo Inv.", "Aportes", "Emprést.Capt.", "Amortiz.", "Dividendos", "Fluxo Fin.", "Var.Caixa", "Saldo Final"],
      MESES.map((m, i) => [
        m,
        brl(cf.capex[i]),
        brl(cf.fluxoInvestimento[i]),
        brl(cf.aportes[i]),
        brl(cf.emprestimosCaptados[i]),
        brl(cf.amortizacoes[i]),
        brl(cf.dividendos[i]),
        brl(cf.fluxoFinanciamento[i]),
        brl(cf.variacaoCaixa[i]),
        brl(cf.saldoFinal[i]),
      ]),
    ));
    cfLines.push(`\n**Totais:** Recebim. ${brl(cf.totais.recebimentos)} · Rec.Financ. ${brl(cf.totais.receitasFinanceiras)} · Pagam.Totais ${brl(cf.totais.pagamentosTotais)} · Fluxo Op. ${brl(cf.totais.fluxoOperacional)} · Invest. ${brl(cf.totais.fluxoInvestimento)} · Financ. ${brl(cf.totais.fluxoFinanciamento)} · Variação ${brl(cf.totais.variacao)} · Saldo final ${brl(cf.totais.saldoFinal)}`);
    cfLines.push(`**Transbordo ano seguinte:** Contas a Receber ${brl(cf.contasReceberAnoSeguinte)} · Fornecedores ${brl(cf.fornecedoresAnoSeguinte)} · Impostos ${brl(cf.impostosAnoSeguinte)}`);
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
      // C-1 fix: dcfDetails.wacc é armazenado em % (valuation.ts:198 `waccAnnual * 100`).
      // terminalGrowth permanece em fração (ex.: 0.025) — multiplica × 100 só nele.
      valLines.push(`- **DCF:** WACC ${pct(safe(d.wacc), 2)} · g ${pct(safe(d.terminalGrowth) * 100, 2)} · VP fluxos ${brl(safe(d.presentValueFlows))} · VP terminal ${brl(safe(d.presentValueTerminal))}`);
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
    const simRegime = tryRun(() => resolveEffectiveRegime(simulatedState), simulatedState.tax.regime);
    const builtSim = tryRun(() => buildDRE(simulatedState, simRegime), null as any);
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

  // ----- Receitas (config bruta) -----
  const recLines: string[] = [`## Receitas (inputs)`];
  {
    const r = state.revenue;
    recLines.push(`- **Receita Bruta anual:** ${brl(sum(r.bruta))}${r.brutaFixa ? " (modo fixo)" : ""}`);
    recLines.push(table(["Mês", "Receita Bruta", "Inadimplência %"],
      MESES.map((m, i) => [m, brl(r.bruta[i]), pct(r.inadimplencia[i] ?? 0, 2)])));
    recLines.push(`- **PMR médio:** ${r.pmr}d${r.pmrFixo ? " (fixo)" : " (mensal variável)"} · **PMP médio:** ${r.pmp}d${r.pmpFixo ? " (fixo)" : ""}`);
    recLines.push(`- **Inadimplência tratada como:** ${r.inadimplenciaComoPDD ? "PDD (despesa operacional)" : "Dedução de receita"}`);
    if (r.deducoes?.length) {
      recLines.push(`### Deduções customizadas`);
      r.deducoes.forEach(d => recLines.push(`- ${d.label}: ${brl(sum(d.valores))}`));
    }
    if (r.receitasFinanceiras?.length) {
      recLines.push(`### Receitas Financeiras`);
      r.receitasFinanceiras.forEach(d => recLines.push(`- ${d.label}: ${brl(sum(d.valores))}`));
    }
  }

  // ----- Despesas (linhas detalhadas) -----
  const despLines: string[] = [`## Despesas (linhas detalhadas)`];
  {
    const rows = state.costs.map(c => [
      c.label,
      c.category,
      c.fixed ? "Fixa" : "Variável",
      brl(sum(c.values)),
      c.encargosAuto ? `Folha CLT (encargos ${pct((c.encargosPct ?? 70))})` : "",
    ]);
    despLines.push(table(["Linha", "Categoria", "Tipo", "Anual", "Obs."], rows));
    const totalFixos = state.costs.filter(c => c.fixed).reduce((a, c) => a + sum(c.values), 0);
    const totalVar = state.costs.filter(c => !c.fixed).reduce((a, c) => a + sum(c.values), 0);
    despLines.push(`\n**Total Fixos:** ${brl(totalFixos)} · **Total Variáveis:** ${brl(totalVar)} · **Total Geral:** ${brl(totalFixos + totalVar)}`);
  }

  // ----- Capital (estrutura) -----
  const capLines: string[] = [`## Estrutura de Capital`];
  {
    const c = state.capital;
    capLines.push(table(["Campo", "Valor"], [
      ["Patrimônio Líquido", brl(c.patrimonioLiquido)],
      ["Dívida Onerosa", brl(c.dividaOnerosa)],
      ["Ativo Total", brl(c.ativoTotal)],
      ["Ativo Circulante", brl(c.ativoCirculante)],
      ["Passivo Circulante", brl(c.passivoCirculante)],
      ["Estoques", brl(c.estoques)],
      ["Disponibilidades", brl(c.disponibilidades)],
      ["Contas a Receber", brl(c.contasReceber)],
      ["Fornecedores", brl(c.fornecedores)],
      ["Caixa Ocioso", brl(c.caixaOcioso ?? 0)],
      ["Capital Giro Disponível", brl(c.capitalGiroDisponivel)],
      ["Depreciação Mensal", brl(c.depreciacaoMensal)],
      ["Ke (custo do equity)", pct(c.ke * 100, 2)],
      ["Kd (custo da dívida)", pct(c.kd * 100, 2)],
    ]));
    if (c.capexAtivacao?.length) {
      capLines.push(`\n### Capex ativado no ano`);
      c.capexAtivacao.forEach(a => capLines.push(`- ${a.label}: ${brl(a.valor)} (mês ${a.mes}, ${a.vidaUtilMeses}m)`));
    }
  }

  // ----- Regime Tributário (config) -----
  const regLines: string[] = [`## Regime Tributário (config)`];
  {
    const t = state.tax;
    regLines.push(`- **Regime nominal:** ${t.regime} · **Efetivo:** ${effectiveRegime}${effectiveRegime !== t.regime ? " (downgrade automático)" : ""}`);
    regLines.push(`- **Era tributária:** ${t.era ?? "atual"} · **Anexo Simples:** ${t.simplesAnexo} · **Fator R:** ${pct(t.fatorR)}${t.fatorRAuto ? " (auto)" : ""}`);
    regLines.push(`- **ISS/ICMS débito:** ${pct(t.issIcms)} · **ICMS crédito:** ${pct(t.aliquotaICMSCredito ?? 0)}`);
    regLines.push(`- **PIS/COFINS créditos:** PIS ${pct(t.pisCreditos)} · COFINS ${pct(t.cofinsCreditos)}`);
    regLines.push(`- **Bases Presumido:** IRPJ ${pct(t.presumidoBaseIRPJ)} · CSLL ${pct(t.presumidoBaseCSLL)}`);
    regLines.push(`- **CBS:** ${pct(t.cbsAliquota ?? 8.8)} · **IBS ref:** ${pct(t.ibsAliquotaRef ?? 17.7)}`);
    if (t.issDeducoes) regLines.push(`- **Deduções ISS (materiais/subempreitada):** ${brl(t.issDeducoes)}`);
    if (built?.tax?.totalAnual !== undefined) regLines.push(`- **Carga tributária total apurada (ano):** ${brl(built.tax.totalAnual)}`);
  }

  // ----- Comparativo de eras da Reforma Tributária (seção separada para dedup com simular_transicao_reforma) -----
  const erasLines: string[] = [];
  const erasComparativo = tryRun(
    () => compareErasForRegime(state, state.tax.regime),
    [] as ReturnType<typeof compareErasForRegime>,
  );
  if (erasComparativo.length === 3) {
    erasLines.push(`## Impacto da Reforma Tributária — ${state.tax.regime}`);
    erasLines.push(`| Era | Período | Tributos (ano) | Carga Efetiva | Δ vs. Atual |`);
    erasLines.push(`| --- | --- | --- | --- | --- |`);
    const base = erasComparativo[0].annual;
    erasComparativo.forEach(p => {
      const delta = p.annual - base;
      const deltaTxt = p.era === "atual"
        ? "—"
        : `${delta >= 0 ? "+" : ""}${brl(delta)} (${base !== 0 ? ((delta / base) * 100).toFixed(1) : "0.0"}%)`;
      const periodo = p.era === "atual" ? "até 2026" : p.era === "transicao" ? "2027–2032" : "2033+";
      erasLines.push(`| ${p.era} | ${periodo} | ${brl(p.annual)} | ${pct(p.effective)} | ${deltaTxt} |`);
    });
    const eraAtiva = state.tax.era ?? "atual";
    erasLines.push(`\n_Era selecionada pelo consultor: **${eraAtiva}**_`);
  }


  // ----- Governança (qualitativo) -----
  const govLines: string[] = [];
  if (state.strategic?.governance) {
    const g = state.strategic.governance;
    govLines.push(`## Governança & Sucessão`);
    govLines.push(`- **Sócio afastado 60d:** ${g.socioAfastado60d ?? "—"}`);
    govLines.push(`- **Quem fecha contrato:** ${g.quemFechaContrato ?? "—"}`);
    govLines.push(`- **Processos documentados:** ${g.processosDocumentados ?? "—"}`);
    govLines.push(`- **Plano de sucessão:** ${g.planoSucessao ?? "—"}`);
  }

  return {
    premissas: p.join("\n"),
    receitas: recLines.join("\n"),
    despesas: despLines.join("\n"),
    capital: capLines.join("\n"),
    regime: regLines.join("\n"),
    eras: erasLines.join("\n"),
    dre: dreLines.join("\n"),
    indicadores: indLines.join("\n"),
    diagnostico: diagLines.join("\n"),
    caixa: cfLines.join("\n"),
    valuation: valLines.join("\n"),
    saude: healthLines.join("\n"),
    prescritivo: presLines.join("\n"),
    estrategico: estrLines.join("\n"),
    governanca: govLines.join("\n"),
    comparativo: compLines,
    // Expõe os números já calculados para que tools como get_resumo_executivo e
    // get_alertas_criticos não precisem refazer buildDRE/calcIndicators/diagnose.
    data: {
      dre,
      ind,
      val,
      health,
      alerts: dre && ind ? tryRun(() => diagnose(state, dre, ind), []) : [],
    },
  };
}


/**
 * Monta o snapshot full SEM limite de tokens — envia todas as seções disponíveis.
 */
export function buildSnapshot(state: AppState, simulatedState?: AppState): string {
  const s = buildSections(state, simulatedState);
  const all = [
    s.premissas, s.regime, s.eras, s.dre, s.indicadores, s.valuation, s.comparativo,
    s.receitas, s.despesas, s.capital, s.caixa, s.diagnostico,
    s.saude, s.prescritivo, s.governanca, s.estrategico,
  ].filter(Boolean) as string[];
  return all.join("\n\n");
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
  // Inclui companyName explicitamente no key para evitar vazamento cross-empresa
  // mesmo que dois estados produzam hashes JSON idênticos por coincidência.
  const company = state.companyName || "(sem-empresa)";
  const k = `${company}::${fastHash(state)}`;
  const sk = simulatedState ? `${company}::${fastHash(simulatedState)}` : "";
  if (k === cacheKey && sk === cacheSimKey && cacheVal) return cacheVal;
  const v = buildSections(state, simulatedState);
  cacheKey = k; cacheSimKey = sk; cacheVal = v;
  return v;
}
