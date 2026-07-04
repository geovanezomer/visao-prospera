// Snapshot em camadas + estimativa de tokens + sanitização + cache por referência.
import type { AppState } from "@/engines/finance/types";
import {
  buildDRE,
  calcIndicators,
  diagnose,
  resolveEffectiveRegime,
  compareErasForRegime,
} from "@/engines/finance";
import { buildCashFlow } from "@/engines/finance/cashflow";
import { buildValuation, defaultValuationParams } from "@/engines/finance/valuation";
import { computeHealth } from "@/engines/finance/health";
import { buildPrescriptiveCards } from "@/engines/finance/prescriptive";
import { deriveBalancoFechamento } from "@/engines/finance/balancoFechamento";
import { deriveAbertura } from "@/engines/finance/aberturaDerivada";
import { MESES, sum, fmtNum } from "@/engines/finance/format";
import { getCbsAliquota, getIbsAliquotaRef } from "@/engines/finance/taxDefaults";
import { getFinancialModelCached } from "@/engines/finance/financialModel";
import { calcKanitz } from "@/engines/finance/kanitz";

// ===== Helpers =====
const safe = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

const brl = (n: number) =>
  `R$ ${safe(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number, d = 1) => `${safe(n).toFixed(d)}%`;

function tryRun<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function table(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => "---").join(" | ");
  return `| ${headers.join(" | ")} |\n| ${sep} |\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;
}

/** Estimativa grosseira de tokens (1 token ~ 4 chars em português). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

// ============================================================
// CAMADAS — cada uma retorna uma string markdown independente
// ============================================================

export interface SnapshotNumeric {
  dre: ReturnType<typeof buildDRE>["dre"] | null;
  ind: ReturnType<typeof calcIndicators> | null;
  cf: ReturnType<typeof buildCashFlow> | null;
  val: ReturnType<typeof buildValuation> | null;
  health: ReturnType<typeof computeHealth> | null;
  alerts: ReturnType<typeof diagnose>;
}

export interface SnapshotSections {
  premissas: string;
  receitas: string;
  despesas: string;
  capital: string;
  /** Balanço Patrimonial de FECHAMENTO derivado por construção (Ativo = Passivo + PL). */
  balanco: string;
  /** Saldos de ABERTURA derivados (SSOT) — caixa, CR, estoques, fornecedores, empréstimos CP/LP, impostos, salários a pagar + plug Lucros Acumulados. */
  balancoAbertura: string;
  /** Contratos de dívida (saldo, taxa, sistema, prazo, split CP/LP) com agregados. */
  dividas: string;
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
  // Aliases dos tipos derivados — evita `any` nos fallbacks de `tryRun`.
  type BuiltDRE = ReturnType<typeof buildDRE>;
  type Ind = ReturnType<typeof calcIndicators>;
  type CF = ReturnType<typeof buildCashFlow>;
  type Val = ReturnType<typeof buildValuation>;
  type Health = ReturnType<typeof computeHealth>;
  type Cards = ReturnType<typeof buildPrescriptiveCards>;

  // SSOT: reaproveita o modelo financeiro memoizado por referência (WeakMap).
  // Evita refazer buildDRE/calcIndicators/buildCashFlow/buildValuation/computeHealth
  // quando qualquer aba (Dashboard, Indicadores, etc.) já aqueceu o cache.
  const model = tryRun(() => getFinancialModelCached(state), null);

  const effectiveRegime =
    model?.regime ?? tryRun(() => resolveEffectiveRegime(state), state.tax.regime);
  const dre = model?.dre ?? tryRun<BuiltDRE | null>(() => buildDRE(state, effectiveRegime), null)?.dre ?? null;
  const ind =
    model?.ind ?? (dre ? tryRun<Ind | null>(() => calcIndicators(state, dre), null) : null);
  const cf = model?.cf ?? tryRun<CF | null>(() => buildCashFlow(state), null);
  const val =
    model?.val ??
    tryRun<Val | null>(
      () => buildValuation(state, defaultValuationParams(state.businessType)),
      null,
    );
  const health = model?.health ?? tryRun<Health | null>(() => computeHealth(state), null);
  const cards = tryRun<Cards>(() => buildPrescriptiveCards(state), [] as Cards);

  // ----- premissas -----
  const regimeLabel =
    effectiveRegime !== state.tax.regime
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
    dreLines.push(
      table(
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
      ),
    );
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
    dreLines.push(
      table(
        ["Linha", ...MESES],
        monthlyRows.map(([label, arr]) => [label, ...arr.map((v) => brl(v))]),
      ),
    );

    // Tabela trimestral (Q1..Q4)
    const quarters = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ];
    const qSum = (arr: number[]) => quarters.map((q) => q.reduce((a, i) => a + safe(arr[i]), 0));
    dreLines.push(`\n### DRE Trimestral completo (R$)`);
    dreLines.push(
      table(
        ["Linha", "Q1", "Q2", "Q3", "Q4"],
        monthlyRows.map(([label, arr]) => [label, ...qSum(arr).map((v) => brl(v))]),
      ),
    );

    // Despesas por categoria — mensal
    const catsMensal = Object.entries(dre.despesasPorCategoria || {}).filter(
      ([, v]) => sum(v as number[]) > 0,
    );
    if (catsMensal.length) {
      dreLines.push(`\n### Despesas Operacionais por categoria — mensal (R$)`);
      dreLines.push(
        table(
          ["Categoria", ...MESES, "Anual"],
          catsMensal.map(([k, v]) => [
            k,
            ...(v as number[]).map((x) => brl(x)),
            brl(sum(v as number[])),
          ]),
        ),
      );
    }
  }

  // ----- Indicadores -----
  const indLines: string[] = [];
  if (ind) {
    indLines.push(`## Indicadores`);
    indLines.push(
      table(
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
          ["GAF (alavancagem fin.)", fmtNum(safe(ind.gaf), 2) + "x"],
          ["ROE", pct(ind.roe)],
          ["ROA", pct(ind.roa)],
          ["ROIC", pct(ind.roic)],
          ["WACC", pct(ind.wacc, 2)],
          ["EVA (Lucro Econômico)", brl(ind.eva)],
          ["Ciclo Financeiro (d)", fmtNum(safe(ind.cicloFinanceiro), 0)],
          ["NCG", brl(ind.ncg)],
          ["Gap Cap. Giro", brl(ind.gapCapitalGiro)],
          ["Liquidez Corrente", fmtNum(safe(ind.liquidezCorrente), 2)],
          ["Liquidez Seca", fmtNum(safe(ind.liquidezSeca), 2)],
          ["Liquidez Imediata", fmtNum(safe(ind.liquidezImediata), 2)],
          ["Endividamento Geral", pct(ind.endividamentoGeral)],
          ["Grau Endivid. (D/PL)", pct(ind.grauEndividamento)],
          ["D/PL Bruto", fmtNum(safe(ind.dividaPlBruto), 2) + "x"],
          ["Capital Próprio %", pct(ind.proprioPercent)],
          ["Cobertura Juros (EBIT/Juros)", fmtNum(safe(ind.coberturaJuros), 2) + "x"],
          ["DSCR (EBITDA/Serviço Dívida)", fmtNum(safe(ind.dscr), 2) + "x"],
          ["Serviço Dívida Mensal", brl(ind.servicoDividaMensal)],
          ["Giro Ativo", fmtNum(safe(ind.giroAtivo), 2)],
          ["Dívida Líq./EBITDA", fmtNum(safe(ind.dividaLiqEbitda), 2) + "x"],
          ["Dívida Líq./EBIT", fmtNum(safe(ind.dividaLiqEbit), 2) + "x"],
          ["Dívida Líq./PL", fmtNum(safe(ind.dividaLiqPl), 2) + "x"],
          ["Dívida Onerosa", brl(ind.dividaOnerosa)],
          ["Dívida Líquida", brl(ind.dividaLiquida)],
          ["Ativo Circulante", brl(ind.ativoCirculante)],
          ["Passivo Circulante", brl(ind.passivoCirculante)],
          ["Payback PL (anos)", fmtNum(safe(ind.payback), 1)],
          ["Payback CAPEX (anos)", fmtNum(safe(ind.paybackCapex), 1)],
          ["CAPEX Anual", brl(ind.capexAnual)],
          ["FCF (antes CAPEX)", brl(ind.fcf)],
          ["FCF após CAPEX (FCFF)", brl(ind.fcfAposCapex)],
          ["Conversão EBITDA→Caixa", pct(ind.conversaoEbitdaCaixa)],
          ["Qualidade do Lucro (FCO/LL)", fmtNum(safe(ind.qualidadeLucro), 2)],
          ["Impostos/Receita", pct(ind.impostosSobreReceita)],
          ["Impostos/Lucro", pct(ind.impostosSobreLucro)],
          ["Receita Líq./Colaborador", brl(ind.receitaPorColaborador)],
          ["Faturamento/Colaborador", brl(ind.faturamentoPorColaborador)],
          ["EBITDA/Colaborador", brl(ind.ebitdaPorColaborador)],
          ["Lucro/Colaborador", brl(ind.lucroPorColaborador)],
          ["Custo Pessoal/Receita", pct(ind.custoPessoalSobreReceita)],
        ],
      ),
    );
    // Kanitz — Termômetro de Insolvência
    const kanitz = tryRun(() => calcKanitz(state, ind), null as null | ReturnType<typeof calcKanitz>);
    if (kanitz && !kanitz.baseInsuficiente) {
      indLines.push(
        `\n**Kanitz (Termômetro de Insolvência):** FI = ${fmtNum(safe(kanitz.fi), 2)} → **${kanitz.label}**`,
      );
    }
  }

  // ----- Diagnóstico -----
  const diagLines: string[] = [];
  if (dre && ind) {
    type DiagItem = ReturnType<typeof diagnose>[number];
    const diag = tryRun<DiagItem[]>(() => diagnose(state, dre, ind), []);
    if (diag.length) {
      diagLines.push(`## Diagnóstico`);
      diag.forEach((d) =>
        diagLines.push(`- **[${d.level.toUpperCase()}] ${d.title}** — ${d.message}`),
      );
    }
  }

  // ----- Fluxo de caixa -----
  const cfLines: string[] = [];
  if (cf) {
    cfLines.push(`## Fluxo de Caixa Mensal — completo (R$)`);
    // Tabela 1: entradas e saídas operacionais detalhadas
    cfLines.push(`\n### Entradas e Pagamentos Operacionais`);
    cfLines.push(
      table(
        [
          "Mês",
          "Saldo Ini.",
          "Recebim.",
          "Rec.Financ.",
          "Pag.Forn.",
          "Pag.Fixos",
          "Pag.Variáv.",
          "Pag.Financ.",
          "Pag.Impostos",
          "Fluxo Op.",
        ],
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
      ),
    );
    // Tabela 2: investimento, financiamento e saldo
    cfLines.push(`\n### Investimento, Financiamento e Saldo`);
    cfLines.push(
      table(
        [
          "Mês",
          "Capex",
          "Fluxo Inv.",
          "Aportes",
          "Emprést.Capt.",
          "Amortiz.",
          "Dividendos",
          "Fluxo Fin.",
          "Var.Caixa",
          "Saldo Final",
        ],
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
      ),
    );
    cfLines.push(
      `\n**Totais:** Recebim. ${brl(cf.totais.recebimentos)} · Rec.Financ. ${brl(cf.totais.receitasFinanceiras)} · Pagam.Totais ${brl(cf.totais.pagamentosTotais)} · Fluxo Op. ${brl(cf.totais.fluxoOperacional)} · Invest. ${brl(cf.totais.fluxoInvestimento)} · Financ. ${brl(cf.totais.fluxoFinanciamento)} · Variação ${brl(cf.totais.variacao)} · Saldo final ${brl(cf.totais.saldoFinal)}`,
    );
    cfLines.push(
      `**Transbordo ano seguinte:** Contas a Receber ${brl(cf.contasReceberAnoSeguinte)} · Fornecedores ${brl(cf.fornecedoresAnoSeguinte)} · Impostos ${brl(cf.impostosAnoSeguinte)}`,
    );
    if (cf.totais.pioresMes)
      cfLines.push(`**Pior mês:** ${cf.totais.pioresMes.mes} → ${brl(cf.totais.pioresMes.saldo)}`);
    if (cf.alertas?.length) {
      cfLines.push(`**Alertas:**`);
      cf.alertas.forEach((a) => cfLines.push(`- ${a.mes}: ${brl(a.saldo)} (${a.tipo})`));
    }
  }

  // ----- Valuation -----
  const valLines: string[] = [];
  if (val) {
    valLines.push(`## Valuation`);
    valLines.push(`- **Método:** ${val.method}`);
    valLines.push(
      `- **EV:** ${brl(val.enterpriseValue.low)} (pessim.) · **${brl(val.enterpriseValue.base)} (base)** · ${brl(val.enterpriseValue.high)} (otim.)`,
    );
    valLines.push(
      `- **Equity:** ${brl(val.equityValue.low)} (pessim.) · **${brl(val.equityValue.base)} (base)** · ${brl(val.equityValue.high)} (otim.)`,
    );
    valLines.push(
      `- **Múltiplos implícitos:** EV/EBITDA ${fmtNum(safe(val.impliedMultiple.evEbitda), 2)}x · EV/Receita ${fmtNum(safe(val.impliedMultiple.evRevenue), 2)}x`,
    );
    valLines.push(`- **Confiança:** ${val.confidenceScore} — ${val.confidenceRationale}`);
    valLines.push(`- **Haircut:** ${pct(val.haircutApplied * 100)}`);
    if (val.dcfDetails) {
      const d = val.dcfDetails;
      // C-1 fix: dcfDetails.wacc é armazenado em % (valuation.ts:241 `waccAnnual * 100`).
      // growthTerminal permanece em fração (ex.: 0.025) — multiplica × 100 só nele.
      valLines.push(
        `- **DCF:** WACC ${pct(safe(d.wacc), 2)} · g ${pct(safe(d.growthTerminal) * 100, 2)} · VP fluxos ${brl(safe(d.npvFlows))} · VP terminal ${brl(safe(d.npvTerminal))}`,
      );
    }
    if (val.narrative) valLines.push(`> ${val.narrative}`);
  }

  // ----- Saúde -----
  const healthLines: string[] = [];
  if (health) {
    healthLines.push(`## Saúde Financeira`);
    healthLines.push(`- **Financeiro:** ${fmtNum(safe(health.financial), 0)}/100`);
    healthLines.push(
      `- **Total (c/ haircut):** ${fmtNum(safe(health.total), 0)}/100 — **Nota ${health.grade}** (${health.status})`,
    );
    healthLines.push(`- **Headline:** ${health.headline}`);
    if (health.dimensions?.length) {
      healthLines.push(`### Dimensões:`);
      health.dimensions.forEach((d) =>
        healthLines.push(
          `- **${d.label}** [${d.status}]: ${d.value} (score ${fmtNum(safe(d.score), 0)}, peso ${pct(safe(d.weight) * 100, 0)}) — ${d.comment}`,
        ),
      );
    }
  }

  // ----- Prescritivo -----
  const presLines: string[] = [];
  if (cards?.length) {
    presLines.push(`## Recomendações Prescritivas`);
    cards.slice(0, 10).forEach((c) => presLines.push(`- **${c.problem}** — ${c.cause}`));
  }

  // ----- Estratégico -----
  // Renderiza StrategicAnswers como markdown legível em vez de JSON bruto:
  // economiza tokens, melhora a compreensão do LLM e omite campos não preenchidos.
  const estrLines: string[] = [];
  if (state.strategic) {
    estrLines.push(`## Análise Estratégica (qualitativa)`);
    const s = state.strategic;
    const kv = (label: string, v: unknown): string | null =>
      v === undefined || v === null || v === "" ? null : `- **${label}:** ${String(v)}`;

    const conc = [
      kv("% maior cliente", s.concentration?.pctMaiorCliente),
      kv("Clientes p/ 80%", s.concentration?.clientesPara80Pct),
      kv("Tempo do maior cliente", s.concentration?.tempoMaiorCliente),
      kv("% maior fornecedor", s.concentration?.pctMaiorFornecedor),
      kv("Dependência de canal", s.concentration?.dependeCanal),
    ].filter(Boolean);
    if (conc.length) {
      estrLines.push(`### Concentração`);
      estrLines.push(...(conc as string[]));
    }

    const gov = [
      kv("Sócio afastado 60d", s.governance?.socioAfastado60d),
      kv("Quem fecha contrato", s.governance?.quemFechaContrato),
      kv("Processos documentados", s.governance?.processosDocumentados),
      kv("Plano de sucessão", s.governance?.planoSucessao),
    ].filter(Boolean);
    if (gov.length) {
      estrLines.push(`### Governança`);
      estrLines.push(...(gov as string[]));
    }

    const comp = [
      kv("Reajuste de preços", s.competitive?.reajustePrecos),
      kv("Elasticidade a +10%", s.competitive?.elasticidade10pct),
      kv("Razão de contratação", s.competitive?.razaoContratacao),
      kv("Concorrentes", s.competitive?.concorrentes),
      kv("Switching cost", s.competitive?.switchingCost),
    ].filter(Boolean);
    if (comp.length) {
      estrLines.push(`### Posicionamento competitivo`);
      estrLines.push(...(comp as string[]));
    }

    const reg = [kv("Exposição regulatória", s.regulatory?.exposicaoRegulatoria)].filter(Boolean);
    if (reg.length) {
      estrLines.push(`### Regulatório`);
      estrLines.push(...(reg as string[]));
    }
  }

  // ----- Comparativo simulado vs base -----
  let compLines: string | undefined;
  if (simulatedState && simulatedState !== state) {
    const simRegime = tryRun(
      () => resolveEffectiveRegime(simulatedState),
      simulatedState.tax.regime,
    );
    type BuiltDRE = ReturnType<typeof buildDRE>;
    type Ind = ReturnType<typeof calcIndicators>;
    type Val = ReturnType<typeof buildValuation>;
    const builtSim = tryRun<BuiltDRE | null>(() => buildDRE(simulatedState, simRegime), null);
    const dreSim = builtSim?.dre ?? null;
    const indSim = dreSim
      ? tryRun<Ind | null>(() => calcIndicators(simulatedState, dreSim), null)
      : null;
    const valSim = tryRun<Val | null>(
      () => buildValuation(simulatedState, defaultValuationParams(simulatedState.businessType)),
      null,
    );
    if (dreSim && ind && indSim) {
      const rows: string[][] = [
        ["Receita Bruta", brl(sum(dre!.receitaBruta)), brl(sum(dreSim.receitaBruta))],
        ["EBITDA", brl(sum(dre!.ebitda)), brl(sum(dreSim.ebitda))],
        ["Lucro Líquido", brl(sum(dre!.lucroLiquido)), brl(sum(dreSim.lucroLiquido))],
        ["Margem EBITDA", pct(ind.margemEbitda), pct(indSim.margemEbitda)],
        ["ROIC", pct(ind.roic), pct(indSim.roic)],
        [
          "DSCR-like (Cob. Juros)",
          fmtNum(safe(ind.coberturaJuros), 2) + "x",
          fmtNum(safe(indSim.coberturaJuros), 2) + "x",
        ],
      ];
      if (val && valSim)
        rows.push([
          "EV (base value.)",
          brl(val.enterpriseValue.base),
          brl(valSim.enterpriseValue.base),
        ]);
      compLines =
        `## Comparativo: Cenário Base × Cenário Simulado\n` +
        table(["Métrica", "Base", "Simulado"], rows);
    }
  }

  // ----- Receitas (config bruta) -----
  const recLines: string[] = [`## Receitas (inputs)`];
  {
    const r = state.revenue;
    recLines.push(
      `- **Receita Bruta anual:** ${brl(sum(r.bruta))}${r.brutaFixa ? " (modo fixo)" : ""}`,
    );
    recLines.push(
      table(
        ["Mês", "Receita Bruta", "Inadimplência %"],
        MESES.map((m, i) => [m, brl(r.bruta[i]), pct(r.inadimplencia[i] ?? 0, 2)]),
      ),
    );
    recLines.push(
      `- **PMR médio:** ${r.pmr}d${r.pmrFixo ? " (fixo)" : " (mensal variável)"} · **PMP médio:** ${r.pmp}d${r.pmpFixo ? " (fixo)" : ""}`,
    );
    recLines.push(
      `- **Inadimplência tratada como:** ${r.inadimplenciaComoPDD ? "PDD (despesa operacional)" : "Dedução de receita"}`,
    );
    if (r.deducoes?.length) {
      recLines.push(`### Deduções customizadas`);
      r.deducoes.forEach((d) => recLines.push(`- ${d.label}: ${brl(sum(d.valores))}`));
    }
    if (r.receitasFinanceiras?.length) {
      recLines.push(`### Receitas Financeiras`);
      r.receitasFinanceiras.forEach((d) => recLines.push(`- ${d.label}: ${brl(sum(d.valores))}`));
    }
  }

  // ----- Despesas (linhas detalhadas) -----
  const despLines: string[] = [`## Despesas (linhas detalhadas)`];
  {
    const rows = state.costs.map((c) => [
      c.label,
      c.category,
      c.fixed ? "Fixa" : "Variável",
      brl(sum(c.values)),
      c.encargosAuto ? `Folha CLT (encargos ${pct(c.encargosPct ?? 70)})` : "",
    ]);
    despLines.push(table(["Linha", "Categoria", "Tipo", "Anual", "Obs."], rows));
    const totalFixos = state.costs.filter((c) => c.fixed).reduce((a, c) => a + sum(c.values), 0);
    const totalVar = state.costs.filter((c) => !c.fixed).reduce((a, c) => a + sum(c.values), 0);
    despLines.push(
      `\n**Total Fixos:** ${brl(totalFixos)} · **Total Variáveis:** ${brl(totalVar)} · **Total Geral:** ${brl(totalFixos + totalVar)}`,
    );
  }

  // ----- Capital (estrutura) -----
  const capLines: string[] = [`## Estrutura de Capital`];
  {
    const c = state.capital;
    capLines.push(
      table(
        ["Campo", "Valor"],
        [
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
          ["Ke (custo do equity)", pct(c.ke, 2)],
          ["Kd (custo da dívida)", pct(c.kd, 2)],
        ],
      ),
    );
    if (c.capexAtivacao?.length) {
      capLines.push(`\n### Capex ativado no ano`);
      c.capexAtivacao.forEach((a) =>
        capLines.push(`- ${a.label}: ${brl(a.valor)} (mês ${a.mes}, ${a.vidaUtilMeses}m)`),
      );
    }
    if (c.balanco?.ativoNaoCirculante?.imobilizado) {
      const imo = c.balanco.ativoNaoCirculante.imobilizado;
      const total =
        safe(imo.terrenos) +
        safe(imo.edificacoes) +
        safe(imo.maquinasEquipamentos) +
        safe(imo.veiculos) +
        safe(imo.moveisUtensilios) +
        safe(imo.outrosImobilizados);
      if (total > 0) {
        capLines.push(`\n### Imobilizado detalhado (bruto)`);
        capLines.push(
          table(
            ["Item", "Valor"],
            [
              ["Terrenos", brl(safe(imo.terrenos))],
              ["Edificações", brl(safe(imo.edificacoes))],
              ["Máquinas e Equipamentos", brl(safe(imo.maquinasEquipamentos))],
              ["Veículos", brl(safe(imo.veiculos))],
              ["Móveis e Utensílios", brl(safe(imo.moveisUtensilios))],
              ["Outros Imobilizados", brl(safe(imo.outrosImobilizados))],
              ["(−) Depreciação acumulada", brl(safe(imo.depreciacaoAcumulada))],
              ["**Total bruto**", `**${brl(total)}**`],
            ],
          ),
        );
      }
    }
    if (c.balanco?.patrimonioLiquido) {
      const plD = c.balanco.patrimonioLiquido;
      const plSum =
        safe(plD.capitalSocial) +
        safe(plD.reservasCapital) +
        safe(plD.reservasLucros) +
        safe(plD.lucrosPrejuizosAcumulados);
      if (plSum > 0) {
        capLines.push(`\n### PL detalhado (origens)`);
        capLines.push(
          table(
            ["Origem", "Valor"],
            [
              ["Capital Social", brl(safe(plD.capitalSocial))],
              ["Reservas de Capital", brl(safe(plD.reservasCapital))],
              ["Reservas de Lucros", brl(safe(plD.reservasLucros))],
              ["Lucros/Prejuízos Acumulados", brl(safe(plD.lucrosPrejuizosAcumulados))],
            ],
          ),
        );
      }
    }
  }

  // ----- Balanço de ABERTURA derivado (SSOT) -----
  const aberturaLines: string[] = [];
  const abertura = tryRun(
    () => deriveAbertura({ state, impostosTotalMensais: dre?.impostosTotal }),
    null as ReturnType<typeof deriveAbertura> | null,
  );
  if (abertura) {
    aberturaLines.push(`## Balanço de Abertura (saldos derivados — SSOT)`);
    aberturaLines.push(
      `_Cada rubrica mostra a FONTE única. Para corrigir um valor, edite na fonte (Balanço, Contratos, Receitas, Despesas) — não no card de abertura._`,
    );
    const row = (s: { label: string; origem: string; value: number; editavel?: boolean }) => [
      s.label,
      brl(s.value),
      `${s.origem}${s.editavel ? " · editável" : ""}`,
    ];
    aberturaLines.push(
      table(
        ["Rubrica", "Valor", "Fonte"],
        [
          row(abertura.caixa),
          row(abertura.contasReceber),
          row(abertura.estoques),
          row(abertura.impostosRecuperar),
          row(abertura.depreciacaoAcumulada),
          row(abertura.amortizacaoAcumulada),
          row(abertura.fornecedores),
          row(abertura.emprestimosCP),
          row(abertura.emprestimosLP),
          row(abertura.impostosPagar),
          row(abertura.salariosEncargos),
          row(abertura.lucrosAcumulados),
        ],
      ),
    );
    const t = abertura.totals;
    aberturaLines.push(
      `\n**Totais abertura:** Ativo ${brl(t.ativo)} · Passivo ${brl(t.passivo)} · PL ${brl(t.pl)} · Diferença ${brl(t.diferenca)} ${t.fechado ? "✅ fechado" : "⚠️ diferença absorvida em Lucros Acumulados (plug histórico)"}`,
    );
    aberturaLines.push(
      `\n_Regra automática de split de dívida:_ contratos com prazo **≤ 12 meses** entram em Empréstimos CP; **> 12 meses** em Empréstimos LP.`,
    );
  }

  // ----- Balanço de FECHAMENTO derivado por construção -----
  const balancoLines: string[] = [];
  if (dre && cf) {
    const fech = tryRun(
      () => deriveBalancoFechamento({ state, dre, cf, tax: model?.tax ?? undefined }),
      null as ReturnType<typeof deriveBalancoFechamento> | null,
    );
    if (fech) {
      balancoLines.push(`## Balanço Patrimonial de Fechamento (derivado por construção)`);
      balancoLines.push(
        `_Identidade contábil garantida: saldo_fim = saldo_abertura + movimento_período. Para alterar uma rubrica, ajuste a CAUSA na aba correspondente._`,
      );
      const b = fech.balanco;
      const ac = b.ativoCirculante ?? {};
      const imo = b.ativoNaoCirculante?.imobilizado ?? {};
      const intg = b.ativoNaoCirculante?.intangivel ?? {};
      const pc = b.passivoCirculante ?? {};
      const pnc = b.passivoNaoCirculante ?? {};
      const pl = b.patrimonioLiquido ?? {};
      balancoLines.push(`\n### Ativo`);
      balancoLines.push(
        table(
          ["Rubrica", "Valor"],
          [
            ["Caixa e equivalentes", brl(safe(ac.caixaEquivalentes))],
            ["Contas a receber de clientes", brl(safe(ac.contasReceberClientes))],
            ["Estoques", brl(safe(ac.estoques))],
            ["Impostos a recuperar", brl(safe(ac.impostosRecuperar))],
            ["Terrenos", brl(safe(imo.terrenos))],
            ["Edificações", brl(safe(imo.edificacoes))],
            ["Máquinas e equipamentos", brl(safe(imo.maquinasEquipamentos))],
            ["Veículos", brl(safe(imo.veiculos))],
            ["Móveis e utensílios", brl(safe(imo.moveisUtensilios))],
            ["Outros imobilizados (inclui CAPEX)", brl(safe(imo.outrosImobilizados))],
            ["(−) Depreciação acumulada", brl(safe(imo.depreciacaoAcumulada))],
            ["Marcas e Patentes", brl(safe(intg.marcasPatentes))],
            ["Goodwill", brl(safe(intg.goodwill))],
            ["Outros intangíveis", brl(safe(intg.outrosIntangiveis))],
            ["(−) Amortização acumulada", brl(safe(intg.amortizacaoAcumulada))],
            ["**TOTAL ATIVO**", `**${brl(fech.totals.ativo)}**`],
          ],
        ),
      );
      balancoLines.push(`\n### Passivo + Patrimônio Líquido`);
      balancoLines.push(
        table(
          ["Rubrica", "Valor"],
          [
            ["Fornecedores", brl(safe(pc.fornecedores))],
            ["Empréstimos CP (≤12m)", brl(safe(pc.emprestimosFinanciamentosCP))],
            ["Impostos a pagar", brl(safe(pc.impostosPagar))],
            ["Salários e encargos", brl(safe(pc.salariosEncargos))],
            ["Empréstimos LP (>12m)", brl(safe(pnc.emprestimosFinanciamentosLP))],
            ["**TOTAL PASSIVO**", `**${brl(fech.totals.passivo)}**`],
            ["Capital Social", brl(safe(pl.capitalSocial))],
            ["Reservas de Capital", brl(safe(pl.reservasCapital))],
            ["Reservas de Lucros", brl(safe(pl.reservasLucros))],
            ["Lucros/Prejuízos acumulados", brl(safe(pl.lucrosPrejuizosAcumulados))],
            ["Resultado do exercício (DRE − Dividendos)", brl(safe(pl.resultadoExercicio))],
            ["**TOTAL PL**", `**${brl(fech.totals.pl)}**`],
            ["**TOTAL PASSIVO + PL**", `**${brl(fech.totals.passivo + fech.totals.pl)}**`],
          ],
        ),
      );
      balancoLines.push(
        `\n**Diferença Ativo − (Passivo + PL):** ${brl(fech.totals.diferenca)} ${fech.totals.fechado ? "✅ balanço fechado por construção" : "⚠️ revisar abertura (resíduo deveria estar em Lucros Acumulados)"}`,
      );
    }
  }

  // ----- Contratos de Dívida -----
  const dividasLines: string[] = [];
  {
    const contracts = state.capital?.debtContracts ?? [];
    if (contracts.length > 0) {
      dividasLines.push(`## Contratos de Dívida`);
      let saldoCP = 0;
      let saldoLP = 0;
      let totalJurosPond = 0;
      let totalSaldo = 0;
      const rows = contracts.map((c) => {
        const saldo = safe(c.saldoDevedor);
        const prazo = Math.max(0, Math.floor(c.prazoMeses || 0));
        const tipo = prazo <= 12 ? "CP" : "LP";
        if (tipo === "CP") saldoCP += saldo;
        else saldoLP += saldo;
        totalJurosPond += saldo * safe(c.taxaAA);
        totalSaldo += saldo;
        return [
          c.credor || "(sem credor)",
          c.tipoCredor ?? "—",
          c.descricao || "—",
          brl(saldo),
          `${safe(c.taxaAA).toFixed(2)}% a.a.`,
          c.sistema,
          c.frequenciaAmortizacao ?? "mensal",
          `${prazo}m`,
          tipo,
          c.garantia || "—",
          c.covenants || "—",
          c.observacoes || "—",
        ];
      });
      dividasLines.push(
        table(
          ["Credor", "Tipo", "Descrição", "Saldo", "Taxa", "Sistema", "Freq. Amort.", "Prazo", "CP/LP", "Garantia", "Covenants", "Obs."],
          rows,
        ),
      );
      const kdMedio = totalSaldo > 0 ? totalJurosPond / totalSaldo : 0;
      dividasLines.push(
        `\n**Agregados:** Saldo total ${brl(totalSaldo)} · CP (≤12m) ${brl(saldoCP)} · LP (>12m) ${brl(saldoLP)} · Kd médio ponderado ${kdMedio.toFixed(2)}% a.a. · ${contracts.length} contrato(s).`,
      );
      dividasLines.push(
        `\n_A engine gera automaticamente: linha "Juros sobre contratos de dívida" em Despesas, parcela de amortização do principal em DFC, e split CP/LP no Balanço._`,
      );
    } else if ((state.capital?.dividaOnerosa ?? 0) > 0) {
      dividasLines.push(`## Contratos de Dívida`);
      dividasLines.push(
        `_Sem contratos detalhados. Dívida Onerosa agregada: ${brl(state.capital.dividaOnerosa)} · Kd: ${pct(state.capital.kd ?? 0, 2)} · Split CP/LP estimado por % (default 30% CP)._`,
      );
    }
  }


  // ----- Regime Tributário (config) -----
  const regLines: string[] = [`## Regime Tributário (config)`];
  {
    const t = state.tax;
    regLines.push(
      `- **Regime nominal:** ${t.regime} · **Efetivo:** ${effectiveRegime}${effectiveRegime !== t.regime ? " (downgrade automático)" : ""}`,
    );
    regLines.push(
      `- **Era tributária:** ${t.era ?? "atual"} · **Anexo Simples:** ${t.simplesAnexo} · **Fator R:** ${pct(t.fatorR)}${t.fatorRAuto ? " (auto)" : ""}`,
    );
    regLines.push(
      `- **ISS/ICMS débito:** ${pct(t.issIcms)} · **ICMS crédito:** ${pct(t.aliquotaICMSCredito ?? 0)}`,
    );
    regLines.push(
      `- **PIS/COFINS créditos:** PIS ${pct(t.pisCreditos)} · COFINS ${pct(t.cofinsCreditos)}`,
    );
    regLines.push(
      `- **Bases Presumido:** IRPJ ${pct(t.presumidoBaseIRPJ)} · CSLL ${pct(t.presumidoBaseCSLL)}`,
    );
    regLines.push(
      `- **CBS:** ${pct(getCbsAliquota(t))} · **IBS ref:** ${pct(getIbsAliquotaRef(t))}`,
    );
    if (t.issDeducoes)
      regLines.push(`- **Deduções ISS (materiais/subempreitada):** ${brl(t.issDeducoes)}`);
    if (model?.tax?.annual !== undefined)
      regLines.push(`- **Carga tributária total apurada (ano):** ${brl(model.tax.annual)}`);
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
    erasComparativo.forEach((p) => {
      const delta = p.annual - base;
      const deltaTxt =
        p.era === "atual"
          ? "—"
          : `${delta >= 0 ? "+" : ""}${brl(delta)} (${base !== 0 ? ((delta / base) * 100).toFixed(1) : "0.0"}%)`;
      const periodo =
        p.era === "atual" ? "até 2026" : p.era === "transicao" ? "2027–2032" : "2033+";
      erasLines.push(
        `| ${p.era} | ${periodo} | ${brl(p.annual)} | ${pct(p.effective)} | ${deltaTxt} |`,
      );
    });
    const eraAtiva = state.tax.era ?? "atual";
    erasLines.push(`\n_Era selecionada pelo consultor: **${eraAtiva}**_`);
  }

  // ----- Governança (qualitativo) -----
  const govLines: string[] = [];
  govLines.push(`## Governança & Sucessão`);
  govLines.push(`- **Nº de sócios/acionistas:** ${state.numSocios ?? "—"}`);
  govLines.push(`- **Nº de colaboradores:** ${state.numColaboradores ?? "—"}`);
  if (state.strategic?.governance) {
    const g = state.strategic.governance;
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
    balanco: balancoLines.join("\n"),
    balancoAbertura: aberturaLines.join("\n"),
    dividas: dividasLines.join("\n"),
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
      cf,
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
    s.premissas,
    s.regime,
    s.eras,
    s.dre,
    s.indicadores,
    s.valuation,
    s.comparativo,
    s.receitas,
    s.despesas,
    s.capital,
    s.balancoAbertura,
    s.balanco,
    s.dividas,
    s.caixa,
    s.diagnostico,
    s.saude,
    s.prescritivo,
    s.governanca,
    s.estrategico,
  ].filter(Boolean) as string[];
  return all.join("\n\n");
}

// ============================================================
// Cache por IDENTIDADE de referência (WeakMap) — O(1) sem JSON.stringify
// ------------------------------------------------------------
// Como o AppState é imutável (reducers retornam nova referência a cada mudança),
// comparar por referência é suficiente — e elimina o custo do `fastHash`/JSON.stringify
// anterior, que rodava O(n) sobre o state inteiro a cada chamada.
//
// Estrutura: WeakMap<state, Map<simulatedState | SENTINEL, SnapshotSections>>
//   - chave externa: state base (descartado pelo GC quando sai de escopo)
//   - chave interna: state simulado OU sentinela para "sem simulação"
//
// Trocas de empresa naturalmente trocam a referência do state → cache miss correto.

const NO_SIM = Symbol("no-sim");
type SimKey = AppState | typeof NO_SIM;
const sectionsCache = new WeakMap<AppState, Map<SimKey, SnapshotSections>>();

export function getSectionsCached(state: AppState, simulatedState?: AppState): SnapshotSections {
  const simKey: SimKey = simulatedState ?? NO_SIM;
  let inner = sectionsCache.get(state);
  if (inner) {
    const cached = inner.get(simKey);
    if (cached) return cached;
  } else {
    inner = new Map();
    sectionsCache.set(state, inner);
  }
  const v = buildSections(state, simulatedState);
  inner.set(simKey, v);
  return v;
}
