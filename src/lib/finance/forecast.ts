import { AppState } from "./types";
import { buildDRE, calcIndicators, effectiveMonthValues } from "./calculations";
import { sum } from "./format";

export interface ForecastMonth {
  idx: number;            // 0..N-1
  ano: number;            // 1..
  mes: number;            // 1..12
  label: string;          // "Y1 Jan"
  receita: number;
  ebitda: number;
  lucroLiquido: number;
  /** Necessidade de Capital de Giro estimada no fim do mês. */
  ncg: number;
  /** Variação de NCG no mês (consome caixa quando positiva). */
  deltaNcg: number;
  /** FCL = EBITDA − impostos − capex − ΔNCG. */
  fcl: number;
  saldoCaixa: number;     // acumulado
}

export interface ForecastConfig {
  /** Crescimento mensal composto da receita (%). */
  crescimentoMensalPct: number;
  /** Inflação anual aplicada aos custos fixos (%). */
  inflacaoFixosAA: number;
  /** Ganho de escala anual no CPV — reduz o CPV/receita (%). Negativo = perda de escala. */
  ganhoEscalaCpvAA: number;
  /** A cada X% de receita extra vs base, folha sobe 1 step. */
  stepReceitaPct: number;
  /** Incremento de folha por step (%). */
  stepFolhaPct: number;
  /** Horizonte em meses. */
  horizonteMeses: number;
  /** Investimento inicial no t=0 (R$). */
  capexInicial: number;
}

export const DEFAULT_FORECAST_CFG: ForecastConfig = {
  crescimentoMensalPct: 1.0,
  inflacaoFixosAA: 5,
  ganhoEscalaCpvAA: 0,
  stepReceitaPct: 50,
  stepFolhaPct: 25,
  horizonteMeses: 36,
  capexInicial: 0,
};

export interface ForecastResult {
  meses: ForecastMonth[];
  totalReceita: number;
  totalEbitda: number;
  totalLucro: number;
  totalFcl: number;
  totalDeltaNcg: number;
  vpl: number;
  tir: number | null;     // %a.m.
  paybackMeses: number | null;
  taxaDescontoMensal: number;
}

const LABOR_RE = /sal[áa]rio|folha|prolabore|pró-labore|mod|mão de obra|m\.o\.|clt/i;

/**
 * Projeção estruturada (substitui o modelo de fator único):
 *   • Receita: crescimento composto mensal.
 *   • Custos variáveis (CPV + variáveis não-folha): escalam com receita, com ganho de escala anual no CPV.
 *   • Folha (CPV + fixos com encargosAuto ou label de folha): saltos discretos quando receita acumulada ultrapassa o step.
 *   • Demais fixos: inflação anual, NÃO escalam com receita.
 *   • Depreciação: constante.
 *   • Impostos: alíquota efetiva do ano-base aplicada à receita projetada (aproximação).
 *   • NCG: recalculada mês a mês (CR via PMR + estoque proporcional ao CPV − fornecedores via PMP).
 *   • FCL = EBITDA − impostos − capex − ΔNCG.
 */
export function buildForecast(state: AppState, cfg: ForecastConfig): ForecastResult {
  const { dre, tax } = buildDRE(state, state.tax.regime);
  const receitaBase = dre.receitaBruta.slice();          // 12
  const receitaAnoBase = sum(receitaBase) || 1;
  const cpvBase = dre.cpv.slice();
  const cpvAnoBase = sum(cpvBase);
  const cpvRatioBase = cpvAnoBase / receitaAnoBase;       // CPV / receita
  const depMensal = dre.depreciacao[0] || 0;
  const taxRatioBase = sum(tax.monthly) / receitaAnoBase; // alíquota efetiva sobre receita bruta
  // Resultado financeiro projetado como proporção da receita (aproximação razoável
  // enquanto a estrutura de dívida não é re-projetada). Inclui juros pagos − juros recebidos.
  const resultadoFinanceiroRatioBase = sum(dre.resultadoFinanceiro) / receitaAnoBase;

  // Quebra custos por tipo
  let fixosNaoFolhaBase = 0;
  let folhaFixaBase = 0;
  let variaveisNaoCpvBase = 0; // variáveis (não-CPV) que escalam com receita
  for (const c of state.costs) {
    if (c.category === "financeiro") continue;
    const v = sum(effectiveMonthValues(c));
    const isLabor = c.encargosAuto || LABOR_RE.test(c.label);
    if (c.category === "custo_vendas") continue; // já em cpvBase
    if (c.category === "variavel") variaveisNaoCpvBase += v;
    else if (isLabor) folhaFixaBase += v;
    else fixosNaoFolhaBase += v;
  }
  const fixosNaoFolhaMensalBase = fixosNaoFolhaBase / 12;
  const folhaFixaMensalBase = folhaFixaBase / 12;
  const variaveisRatioBase = variaveisNaoCpvBase / receitaAnoBase;

  // Folha de CPV (MOD): escala como folha por steps de receita
  let folhaCpvBase = 0;
  let cpvNaoFolhaBase = 0;
  for (const c of state.costs) {
    if (c.category !== "custo_vendas") continue;
    const v = sum(effectiveMonthValues(c));
    const isLabor = c.encargosAuto || LABOR_RE.test(c.label);
    if (isLabor) folhaCpvBase += v;
    else cpvNaoFolhaBase += v;
  }
  const folhaCpvMensalBase = folhaCpvBase / 12;
  const cpvNaoFolhaRatioBase = cpvNaoFolhaBase / receitaAnoBase;

  // NCG inicial (mesma lógica de calcIndicators)
  const { capital, revenue } = state;
  const crBase0 = capital.contasReceber > 0 ? capital.contasReceber : (receitaAnoBase / 360) * revenue.pmr;
  const fornecBase0 = capital.fornecedores > 0 ? capital.fornecedores : (cpvAnoBase / 360) * revenue.pmp;
  const estoqueBase0 = capital.estoques;
  const ncg0 = crBase0 + estoqueBase0 - fornecBase0;

  const g = cfg.crescimentoMensalPct / 100;
  // Auditoria: aplica fatores ANUAIS elevados à fração do ano para evitar erro composto mensal.
  const inflacaoFator = (i: number) => Math.pow(1 + cfg.inflacaoFixosAA / 100, i / 12);
  const escalaCpvFator = (i: number) => Math.pow(1 - cfg.ganhoEscalaCpvAA / 100, i / 12);
  const horizon = cfg.horizonteMeses;

  const meses: ForecastMonth[] = [];
  let saldo = capital.disponibilidades - cfg.capexInicial;
  let ncgAnterior = ncg0;
  const capexBase = state.cashflow.capex.slice();

  for (let i = 0; i < horizon; i++) {
    const ano = Math.floor(i / 12) + 1;
    const mes = i % 12;
    const label = `Y${ano} ${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][mes]}`;

    const fatorReceita = Math.pow(1 + g, i);
    const receita = receitaBase[mes] * fatorReceita;

    // CPV unitário melhora/piora com escala (ganhos compostos por mês)
    const cpvNaoFolha = receita * cpvNaoFolhaRatioBase * Math.pow(1 - escalaCpvMensal, i);

    // Variáveis não-CPV: escalam com receita
    const variaveisNaoCpv = receita * variaveisRatioBase;

    // Folha: saltos discretos. Step baseado na receita acumulada do ano corrente vs base.
    // Usa média da receita mensal anualizada do mês corrente vs base.
    const receitaAnualizada = receita * 12;
    const crescimentoVsBase = Math.max(0, (receitaAnualizada / receitaAnoBase) - 1);
    const stepsFolha = cfg.stepReceitaPct > 0 ? Math.floor(crescimentoVsBase * 100 / cfg.stepReceitaPct) : 0;
    const multFolha = Math.pow(1 + cfg.stepFolhaPct / 100, stepsFolha);
    const folhaCpv = folhaCpvMensalBase * multFolha;
    const folhaFixa = folhaFixaMensalBase * multFolha;

    const cpv = cpvNaoFolha + folhaCpv;

    // Fixos não-folha: inflação composta
    const fatorInflacao = Math.pow(1 + inflacaoMensal, i);
    const fixosNaoFolha = fixosNaoFolhaMensalBase * fatorInflacao;

    const despesasOp = fixosNaoFolha + folhaFixa + variaveisNaoCpv;
    const lucroBruto = receita - cpv;
    const ebitda = lucroBruto - despesasOp;
    const ebit = ebitda - depMensal;
    const resultadoFinanceiro = receita * resultadoFinanceiroRatioBase; // negativo para empresas alavancadas
    const impostos = receita * taxRatioBase; // alíquota efetiva sobre receita (aproximação)
    const lucroLiquido = ebit + resultadoFinanceiro - impostos;

    // NCG do mês: anualiza receita e CPV do mês para PMR/PMP
    const estoqueT = cpvAnoBase > 0 ? estoqueBase0 * (cpv / (cpvAnoBase / 12)) : estoqueBase0;
    const crT = (receitaAnualizada / 360) * revenue.pmr;
    const fornecT = ((cpv * 12) / 360) * revenue.pmp;
    const ncgT = crT + estoqueT - fornecT;
    const deltaNcg = ncgT - ncgAnterior;
    ncgAnterior = ncgT;

    const capex = (capexBase[mes] || 0) * fatorInflacao;
    const fcl = ebitda - impostos - capex - deltaNcg;
    saldo += fcl;

    meses.push({
      idx: i, ano, mes: mes + 1, label,
      receita, ebitda, lucroLiquido,
      ncg: ncgT, deltaNcg, fcl, saldoCaixa: saldo,
    });
  }

  // VPL via WACC
  const ind = calcIndicators(state, dre);
  const waccA = Math.max(0.5, ind.wacc) / 100;
  const i_m = Math.pow(1 + waccA, 1 / 12) - 1;
  const flows: number[] = [-cfg.capexInicial, ...meses.map((m) => m.fcl)];
  const vpl = npv(flows, i_m);
  const tir = irr(flows);
  const payback = paybackMonths(flows);

  return {
    meses,
    totalReceita: sum(meses.map((m) => m.receita)),
    totalEbitda: sum(meses.map((m) => m.ebitda)),
    totalLucro: sum(meses.map((m) => m.lucroLiquido)),
    totalFcl: sum(meses.map((m) => m.fcl)),
    totalDeltaNcg: sum(meses.map((m) => m.deltaNcg)),
    vpl,
    tir: tir == null ? null : tir * 100,
    paybackMeses: payback,
    taxaDescontoMensal: i_m * 100,
  };
}

// VPL: flows[0] no t=0
export function npv(flows: number[], rate: number): number {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) acc += flows[t] / Math.pow(1 + rate, t);
  return acc;
}

// TIR via Newton-Raphson com fallback bisseção
export function irr(flows: number[], guess = 0.01): number | null {
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;

  let r = guess;
  for (let iter = 0; iter < 80; iter++) {
    let f = 0, df = 0;
    for (let t = 0; t < flows.length; t++) {
      const d = Math.pow(1 + r, t);
      f += flows[t] / d;
      if (t > 0) df += -t * flows[t] / (d * (1 + r));
    }
    if (Math.abs(f) < 1e-7) return r;
    if (df === 0) break;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -0.999) break;
    r = next;
  }
  let lo = -0.99, hi = 10;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const v = npv(flows, mid);
    if (Math.abs(v) < 1e-6) return mid;
    if (npv(flows, lo) * v < 0) hi = mid; else lo = mid;
  }
  return null;
}

function paybackMonths(flows: number[]): number | null {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) {
    acc += flows[t];
    if (acc >= 0 && t > 0) return t;
  }
  return null;
}
