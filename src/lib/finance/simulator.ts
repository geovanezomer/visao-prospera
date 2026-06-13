/**
 * Simulator engine — aplica uma combinação de "alavancas" sobre o AppState
 * base e retorna um novo AppState ajustado, pronto para passar por buildDRE.
 *
 * Todas as alavancas são aditivas / multiplicativas e neutras quando em 0.
 * Permite combinar livremente para criar o "cenário perfeito".
 */

import { AppState, CostLine, TaxRegime } from "./types";
import { buildDRE, calcIndicators, monthValues, resolveEffectiveRegime, type DRE, type Indicators } from "./calculations";
import { buildValuation, defaultValuationParams } from "./valuation";
import { buildCashFlow, type CashFlow } from "./cashflow";
import { fill12, sum } from "./format";

// Mesmo regex usado em sensitivity.ts/prescriptive.ts — verdade única para identificar folha.
const LABOR_RE = /sal[áa]rio|folha|clt|prolabore|pr[óo]-labore|mod|m[ãa]o de obra/i;
const isLaborLine = (c: CostLine) => c.encargosAuto === true || LABOR_RE.test(c.label);

export interface SimulatorParams {
  // Receita & Preço
  priceDeltaPct: number;        // -30..+30  → multiplica receita
  volumeDeltaPct: number;       // -50..+50  → multiplica receita + CPV variável

  // Custos & Pessoal
  cpvDeltaPct: number;          // -20..+30  → multiplica linhas custo_vendas
  payrollDeltaPct: number;      // -30..+30  → multiplica linhas com encargosAuto
  fixedCutPct: number;          // 0..50     → % de redução nos top-N fixos
  fixedCutTopN: number;         // 1..5
  outsourcePctCpv: number;      // 0..100    → % do CPV substituído
  outsourceFixedMonthly: number;// R$/mês fixo contratado

  // Capital de Giro
  pmrDeltaDays: number;         // -60..0    (sempre reduz ou 0)
  pmpDeltaDays: number;         // 0..+60    (sempre aumenta ou 0)
  antecipPctAm: number;         // 0..6      custo % a.m. sobre 50% da receita

  // Dívida & Juros
  loanPrincipal: number;        // R$ captado no mês 1
  loanTermMonths: number;       // 6..60
  loanRatePctAm: number;        // 0.5..5 % a.m.
  debtPaydownPct: number;       // 0..100  % do principal quitado no mês 1
  kdDeltaPp: number;            // -5..+5  pontos percentuais ao ano

  // Tributário
  regimeOverride: TaxRegime | "base"; // base = não muda
}

export const DEFAULT_SIM: SimulatorParams = {
  priceDeltaPct: 0,
  volumeDeltaPct: 0,
  cpvDeltaPct: 0,
  payrollDeltaPct: 0,
  fixedCutPct: 0,
  fixedCutTopN: 3,
  outsourcePctCpv: 0,
  outsourceFixedMonthly: 0,
  pmrDeltaDays: 0,
  pmpDeltaDays: 0,
  antecipPctAm: 0,
  loanPrincipal: 0,
  loanTermMonths: 12,
  loanRatePctAm: 2,
  debtPaydownPct: 0,
  kdDeltaPp: 0,
  regimeOverride: "base",
};

const cloneCosts = (c: CostLine[]) => c.map((x) => ({ ...x, values: x.values.slice() }));

function topNFixedIds(state: AppState, n: number): Set<string> {
  return new Set(
    state.costs
      .filter((c) => c.category === "fixo")
      .map((c) => ({ id: c.id, total: sum(monthValues(c)) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, Math.max(1, Math.round(n)))
      .map((x) => x.id),
  );
}

export function applySimulator(base: AppState, p: SimulatorParams): AppState {
  let s: AppState = {
    ...base,
    revenue: {
      ...base.revenue,
      bruta: base.revenue.bruta.slice(),
      inadimplencia: base.revenue.inadimplencia.slice(),
      // Clona deduções e receitas financeiras profundas — para aplicar volume sem mutar o estado base.
      deducoes: base.revenue.deducoes?.map((d) => ({ ...d, valores: d.valores.slice() })),
      receitasFinanceiras: base.revenue.receitasFinanceiras?.map((d) => ({ ...d, valores: d.valores.slice() })),
    },
    costs: cloneCosts(base.costs),
    capital: { ...base.capital },
    cashflow: { ...base.cashflow, emprestimosCaptados: base.cashflow.emprestimosCaptados.slice(), amortizacoes: base.cashflow.amortizacoes.slice(), capex: base.cashflow.capex.slice() },
    tax: { ...base.tax },
  };

  // 1) Preço
  if (p.priceDeltaPct !== 0) {
    const f = 1 + p.priceDeltaPct / 100;
    s.revenue.bruta = s.revenue.bruta.map((v) => v * f);
  }

  // 2) Volume: receita + custo_vendas + variavel + deduções absolutas (S2)
  // Inadimplência é %, escala automaticamente. Devoluções/descontos/abatimentos são R$ absolutos —
  // precisam crescer junto, senão Receita Líquida fica artificialmente alta em volumes maiores.
  if (p.volumeDeltaPct !== 0) {
    const f = 1 + p.volumeDeltaPct / 100;
    s.revenue.bruta = s.revenue.bruta.map((v) => v * f);
    if (s.revenue.deducoes) {
      s.revenue.deducoes = s.revenue.deducoes.map((d) => ({ ...d, valores: d.valores.map((v) => v * f) }));
    }
    s.costs = s.costs.map((c) =>
      c.category === "custo_vendas" || c.category === "variavel"
        ? { ...c, values: c.values.map((v) => v * f) }
        : c,
    );
  }

  // 3) CPV
  if (p.cpvDeltaPct !== 0) {
    const f = 1 + p.cpvDeltaPct / 100;
    s.costs = s.costs.map((c) =>
      c.category === "custo_vendas" ? { ...c, values: c.values.map((v) => v * f) } : c,
    );
  }

  // 4) Folha (linhas com encargosAuto)
  if (p.payrollDeltaPct !== 0) {
    const f = 1 + p.payrollDeltaPct / 100;
    s.costs = s.costs.map((c) =>
      c.encargosAuto ? { ...c, values: c.values.map((v) => v * f) } : c,
    );
  }

  // 5) Corte de fixos
  if (p.fixedCutPct > 0) {
    const ids = topNFixedIds(s, p.fixedCutTopN);
    const f = 1 - p.fixedCutPct / 100;
    s.costs = s.costs.map((c) => (ids.has(c.id) ? { ...c, values: c.values.map((v) => v * f) } : c));
  }

  // 6) Terceirização — reduz CPV proporcionalmente ao % terceirizado e adiciona
  // (opcionalmente) um custo fixo mensal para o contrato de terceirização.
  if (p.outsourcePctCpv > 0) {
    const f = 1 - p.outsourcePctCpv / 100;
    s.costs = s.costs.map((c) =>
      c.category === "custo_vendas" ? { ...c, values: c.values.map((v) => v * f) } : c,
    );
    if (p.outsourceFixedMonthly > 0) {
      s.costs.push({
        id: `sim_outsource`,
        label: `Terceirização (${p.outsourcePctCpv.toFixed(0)}% da operação)`,
        category: "fixo",
        values: fill12(p.outsourceFixedMonthly),
        fixed: true,
        custom: true,
      });
    }
  }

  // 7) PMR / PMP
  if (p.pmrDeltaDays !== 0) {
    s.revenue.pmr = Math.max(0, s.revenue.pmr + p.pmrDeltaDays);
  }
  if (p.pmpDeltaDays !== 0) {
    s.revenue.pmp = Math.max(0, s.revenue.pmp + p.pmpDeltaDays);
  }

  // 8) Antecipação de recebíveis (custo financeiro)
  if (p.antecipPctAm > 0) {
    const custo = s.revenue.bruta.map((v) => v * 0.5 * (p.antecipPctAm / 100));
    s.costs.push({
      id: "sim_antecip",
      label: `Antecipação de recebíveis (${p.antecipPctAm.toFixed(2)}% a.m.)`,
      category: "financeiro",
      values: custo,
      fixed: false,
      custom: true,
    });
  }

  // 9) Captar empréstimo (PRICE)
  if (p.loanPrincipal > 0 && p.loanTermMonths > 0) {
    const i = p.loanRatePctAm / 100;
    const pmt = i === 0 ? p.loanPrincipal / p.loanTermMonths : p.loanPrincipal * (i / (1 - Math.pow(1 + i, -p.loanTermMonths)));
    const jurosArr = Array(12).fill(0);
    const amortArr = s.cashflow.amortizacoes.slice();
    let saldo = p.loanPrincipal;
    for (let k = 0; k < p.loanTermMonths && k < 12; k++) {
      const j = saldo * i;
      const a = pmt - j;
      jurosArr[k] += j;
      amortArr[k] = (amortArr[k] || 0) + a;
      saldo -= a;
    }
    s.cashflow.emprestimosCaptados[0] = (s.cashflow.emprestimosCaptados[0] || 0) + p.loanPrincipal;
    s.cashflow.amortizacoes = amortArr;
    s.capital.dividaOnerosa = s.capital.dividaOnerosa + p.loanPrincipal;
    s.costs.push({
      id: "sim_loan_juros",
      label: `Juros novo empréstimo (${p.loanRatePctAm.toFixed(2)}% a.m.)`,
      category: "financeiro",
      values: jurosArr,
      fixed: false,
      custom: true,
    });
  }

  // 10) Quitar dívida
  if (p.debtPaydownPct > 0) {
    const pct = p.debtPaydownPct / 100;
    const pago = s.capital.dividaOnerosa * pct;
    s.capital.dividaOnerosa = s.capital.dividaOnerosa * (1 - pct);
    s.costs = s.costs.map((c) =>
      c.category === "financeiro" && /juros/i.test(c.label)
        ? { ...c, values: c.values.map((v) => v * (1 - pct)) }
        : c,
    );
    s.cashflow.amortizacoes[0] = (s.cashflow.amortizacoes[0] || 0) + pago;
  }

  // 11) kd / Selic
  if (p.kdDeltaPp !== 0) {
    const novoKd = Math.max(0.5, s.capital.kd + p.kdDeltaPp);
    const fator = novoKd / Math.max(s.capital.kd, 0.5);
    s.capital.kd = novoKd;
    s.costs = s.costs.map((c) =>
      c.category === "financeiro" && /juros/i.test(c.label)
        ? { ...c, values: c.values.map((v) => v * fator) }
        : c,
    );
  }

  // 12) Regime
  if (p.regimeOverride !== "base") {
    s.tax = { ...s.tax, regime: p.regimeOverride };
  }

  return s;
}

// ---------- Resumo de DRE para a UI ----------

export interface SimDREView {
  receitaBruta: number;
  deducoes: number;
  // Detalhamento das deduções (anual)
  devolucoesCancelamentos: number;
  descontosIncondicionais: number;
  abatimentos: number;
  tributosReceita: number;
  receitaLiquida: number;
  cpv: number;
  lucroBruto: number;
  despesasOp: number;
  // Detalhamento das despesas operacionais (anual)
  despesasComerciais: number;
  despesasAdministrativas: number;
  outrasOperacionais: number; // inclui D&A com sinal negativo
  ebitda: number;
  depreciacao: number;
  ebit: number;                // = Lucro Operacional
  // Bloco financeiro
  receitasFinanceiras: number;
  ganhoAlienacao: number;
  laft: number;                // Lucro Antes do Financiamento e Tributos
  despesasFinanceiras: number;
  resultadoFinanceiro: number; // receitasFin − despesasFin (compat)
  lair: number;                // = EBT
  impostos: number;
  lucroLiquido: number;

  margemBruta: number;
  margemEbitda: number;
  margemLiquida: number;
  roic: number;
  ncg: number;
  saldoCaixaFinal: number;
  piorMesCaixa: number;
  coberturaJuros: number;
  enterpriseValue: number;
  equityValue: number;
}

export function computeSimView(state: AppState): SimDREView {
  const { dre, tax } = buildDRE(state, state.tax.regime);
  const ind = calcIndicators(state, dre);
  const cf = buildCashFlow(state);
  const deducoes = sum(dre.deducoesInadimplencia);

  // Descontos Incondicionais e Abatimentos via revenue.deducoes
  const dedById = (id: string) => state.revenue.deducoes?.find((d) => d.id === id);
  const descIncond = sum(dedById("desc_incond")?.valores ?? []);
  const abatim = sum(dedById("abatimentos")?.valores ?? []);

  // Comerciais (variavel) / Administrativas (fixo) / Financeiras (financeiro)
  let despComerciais = 0, despAdmin = 0, despFinanc = 0;
  for (const c of state.costs) {
    const v = sum(monthValues(c, state.tax.regime));
    if (c.category === "variavel") despComerciais += v;
    else if (c.category === "fixo") despAdmin += v;
    else if (c.category === "financeiro") despFinanc += v;
  }
  const outrasOp = -sum(dre.depreciacao);
  const receitasFin = sum(state.revenue.receitasFinanceiras?.flatMap((r) => r.valores ?? []) ?? []);
  const ganhoAlien = 0;
  const ebit = sum(dre.ebit);
  const laft = ebit + receitasFin + ganhoAlien;

  const valParams = defaultValuationParams(state.businessType);
  const val = buildValuation(state, valParams);

  return {
    receitaBruta: sum(dre.receitaBruta),
    deducoes,
    devolucoesCancelamentos: deducoes,
    descontosIncondicionais: descIncond,
    abatimentos: abatim,
    tributosReceita: sum(dre.impostosVendas),
    receitaLiquida: sum(dre.receitaLiquida),
    cpv: sum(dre.cpv),
    lucroBruto: sum(dre.lucroBruto),
    despesasOp: sum(dre.despesasOperacionais),
    despesasComerciais: despComerciais,
    despesasAdministrativas: despAdmin,
    outrasOperacionais: outrasOp,
    ebitda: sum(dre.ebitda),
    depreciacao: sum(dre.depreciacao),
    ebit,
    receitasFinanceiras: receitasFin,
    ganhoAlienacao: ganhoAlien,
    laft,
    despesasFinanceiras: despFinanc,
    resultadoFinanceiro: sum(dre.resultadoFinanceiro),
    lair: sum(dre.lair),
    impostos: tax.annual,
    lucroLiquido: sum(dre.lucroLiquido),
    margemBruta: ind.margemBruta,
    margemEbitda: ind.margemEbitda,
    margemLiquida: ind.margemLiquida,
    roic: ind.roic,
    ncg: ind.ncg,
    saldoCaixaFinal: cf.totais.saldoFinal,
    piorMesCaixa: cf.totais.pioresMes?.saldo ?? 0,
    coberturaJuros: ind.coberturaJuros,
    enterpriseValue: val.enterpriseValue.base,
    equityValue: val.equityValue.base,
  };
}

export function countActiveLevers(p: SimulatorParams): number {
  let n = 0;
  if (p.priceDeltaPct !== 0) n++;
  if (p.volumeDeltaPct !== 0) n++;
  if (p.cpvDeltaPct !== 0) n++;
  if (p.payrollDeltaPct !== 0) n++;
  if (p.fixedCutPct > 0) n++;
  if (p.outsourcePctCpv > 0) n++;
  if (p.pmrDeltaDays !== 0) n++;
  if (p.pmpDeltaDays !== 0) n++;
  if (p.antecipPctAm > 0) n++;
  if (p.loanPrincipal > 0) n++;
  if (p.debtPaydownPct > 0) n++;
  if (p.kdDeltaPp !== 0) n++;
  if (p.regimeOverride !== "base") n++;
  return n;
}

export const PRESETS: { id: string; label: string; params: Partial<SimulatorParams> }[] = [
  { id: "neutro", label: "Resetar", params: {} },
  { id: "crise_leve", label: "Crise leve", params: { volumeDeltaPct: -10, cpvDeltaPct: 5, kdDeltaPp: 1 } },
  { id: "crise_dura", label: "Crise dura", params: { volumeDeltaPct: -25, cpvDeltaPct: 10, kdDeltaPp: 3, fixedCutPct: 10, fixedCutTopN: 3 } },
  { id: "expansao", label: "Expansão", params: { volumeDeltaPct: 25, payrollDeltaPct: 15, priceDeltaPct: 3 } },
  { id: "reestruturacao", label: "Reestruturação", params: { fixedCutPct: 20, fixedCutTopN: 3, payrollDeltaPct: -15, debtPaydownPct: 30, pmrDeltaDays: -10 } },
];
