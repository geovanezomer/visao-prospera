import { AppState } from "./types";
import { buildDRE } from "./dre";
import { calcIndicators } from "./indicators";
import { effectiveMonthValues, isComercialCost, isCpvCost } from "./costs";
import { resolveEffectiveRegime } from "./regime";
import { sum } from "./format";
import { vplClassico } from "./external";
import { computeCapexMensal } from "./shared";
import { stateForReformYear } from "./tax/compare";
import { eraForYear } from "./tax/reforma";

export interface ForecastMonth {
  idx: number; // 0..N-1
  ano: number; // 1..
  mes: number; // 1..12
  label: string; // "Y1 Jan" (modo Odoo: "Out/2026")
  /** Ano-calendário do mês, quando conhecido (modo Odoo ou `anoBase`). */
  anoCalendario: number | null;
  receita: number;
  ebitda: number;
  /** Tributos sobre vendas do mês (PIS/COFINS/ICMS/ISS/CBS/IBS ou DAS). */
  impostosReceita: number;
  /** IRPJ/CSLL do mês (Real: sobre o LAIR; Presumido: sobre a receita). */
  impostosLucro: number;
  lucroLiquido: number;
  /** Necessidade de Capital de Giro estimada no fim do mês. */
  ncg: number;
  /** Variação de NCG no mês (consome caixa quando positiva). */
  deltaNcg: number;
  /** FCL/FCFF = NOPAT + D&A − CAPEX − ΔNCG; não inclui resultado financeiro. */
  fcl: number;
  saldoCaixa: number; // acumulado
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
  /** Ano-calendário dos 12 meses informados (modo manual). Quando presente, os
   *  tributos sobre vendas seguem o cronograma da Reforma ano a ano. No modo
   *  Odoo o ano vem da janela do razão e este campo é ignorado. */
  anoBase?: number;
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
  tir: number | null; // %a.m.
  tirError?: string;
  paybackMeses: number | null;
  taxaDescontoMensal: number;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const LABOR_RE = /sal[áa]rio|folha|prolabore|pró-labore|mod|mão de obra|m\.o\.|clt/i;

/**
 * Projeção estruturada (substitui o modelo de fator único):
 *   • Receita: crescimento composto mensal.
 *   • Custos variáveis (CPV + variáveis não-folha): escalam com receita, com ganho de escala anual no CPV.
 *   • Folha (CPV + fixos com encargosAuto ou label de folha): saltos discretos quando receita acumulada ultrapassa o step.
 *   • Demais fixos: inflação anual, NÃO escalam com receita.
 *   • Depreciação: constante.
 *   • Impostos sobre vendas: alíquota efetiva do ano-base, corrigida ano a ano pelo
 *     cronograma da Reforma (CBS/IBS) quando o ano-calendário é conhecido.
 *     IRPJ/CSLL: proporção do ano-base (Real sobre o LAIR; demais sobre a receita).
 *   • Tempo: no modo manual, crescimento e inflação correm mês a mês desde o
 *     ano-base. No modo Odoo, cada mês projetado é o MESMO mês do ano-base
 *     acrescido de N anos (Y1 = +12 meses de crescimento, +1 ano de inflação),
 *     preservando a sazonalidade sem atrasar a tendência em um ano.
 *   • NCG: recalculada mês a mês (CR via PMR + estoque proporcional ao CPV − fornecedores via PMP).
 *   • FCL/FCFF = NOPAT + D&A − CAPEX − ΔNCG, sem resultado financeiro.
 */
export function buildForecast(state: AppState, cfg: ForecastConfig): ForecastResult {
  // SSOT: regime EFETIVO. Garante consistência com IndicatorsTab/Valuation
  // quando a RBT12 estoura o limite do Simples (downgrade para Presumido).
  const regime = resolveEffectiveRegime(state);
  const { dre } = buildDRE(state, regime);
  const receitaBase = dre.receitaBruta.slice(); // 12
  const receitaAnoBase = sum(receitaBase) || 1;
  const cpvBase = dre.cpv.slice();
  const cpvAnoBase = sum(cpvBase);
  const cpvRatioBase = cpvAnoBase / receitaAnoBase; // CPV / receita
  // Auditoria bug #6: usar média anual da depreciação (estava usando só janeiro,
  // o que distorce projeções quando há capex ativado no meio do ano).
  const depMensal = sum(dre.depreciacao) / 12;
  // Auditoria #4: separa impostos sobre venda (proporcionais à receita) dos
  // impostos sobre lucro (proporcionais à margem). No Lucro Real, IRPJ/CSLL
  // dependem do LAIR, não da receita — manter um ratio único distorce projeções
  // quando a margem projetada muda em relação ao ano-base.
  // Série da DRE (no modo Odoo já inclui o ajuste ao contabilizado).
  const impostosVendasAnoBase = sum(dre.impostosVendas);
  const impostosLucroAnoBase = sum(dre.impostos);
  // Deduções da receita (inadimplência como dedução + devoluções/abatimentos):
  // tudo que separa a Receita Líquida da Bruta além dos tributos.
  const deducoesRatioBase =
    (sum(receitaBase) - sum(dre.receitaLiquida) - impostosVendasAnoBase) / receitaAnoBase;
  // PDD (quando a inadimplência é provisão) é despesa variável com a receita.
  const pddRatioBase = sum(dre.pdd) / receitaAnoBase;
  // Aluguéis/venda de ativos operacionais: mantidos no nível médio do ano-base.
  const outrasReceitasOpMensal = sum(dre.outrasReceitasOperacionais) / 12;
  // Presumido/Simples têm tributos majoritariamente sobre receita; Lucro Real separa
  // IRPJ/CSLL sobre lucro. Isso evita o bug de dividir imposto por LAIR negativo/baixo,
  // que fazia a projeção multiplicar impostos por milhares de vezes.
  const vendasRatioBase = impostosVendasAnoBase / receitaAnoBase;
  const lucroSobreReceitaRatio = regime === "real" ? 0 : impostosLucroAnoBase / receitaAnoBase;
  const ebitAnoBase = sum(dre.ebit);
  const taxLucroRatio =
    regime === "real" && ebitAnoBase > 1
      ? Math.max(0, Math.min(0.5, impostosLucroAnoBase / ebitAnoBase))
      : 0;
  // Resultado financeiro projetado como proporção da receita (aproximação razoável
  // enquanto a estrutura de dívida não é re-projetada). Inclui juros pagos − juros recebidos.
  const resultadoFinanceiroRatioBase = sum(dre.resultadoFinanceiro) / receitaAnoBase;

  // Quebra custos por tipo
  let fixosNaoFolhaBase = 0;
  let folhaFixaBase = 0;
  let variaveisNaoCpvBase = 0; // variáveis (não-CPV) que escalam com receita
  for (const c of state.costs) {
    if (c.category === "financeiro") continue;
    const v = sum(effectiveMonthValues(c, regime));
    const isLabor = c.encargosAuto || LABOR_RE.test(c.label);
    if (isCpvCost(c)) continue; // já em cpvBase (inclui direto_venda)
    // Mesmo critério de comportamento da DRE: despesa comercial é variável por
    // padrão (comissão, frete s/ vendas); `comportamento` sobrepõe.
    const variavel = (c.comportamento ?? (isComercialCost(c) ? "variavel" : "fixo")) === "variavel";
    if (variavel) variaveisNaoCpvBase += v;
    else if (isLabor) folhaFixaBase += v;
    else fixosNaoFolhaBase += v;
  }
  const fixosNaoFolhaMensalBase = fixosNaoFolhaBase / 12;
  const folhaFixaMensalBase = folhaFixaBase / 12;
  const variaveisRatioBase = variaveisNaoCpvBase / receitaAnoBase + pddRatioBase;

  // Folha de CPV (MOD): escala como folha por steps de receita
  let folhaCpvBase = 0;
  let cpvNaoFolhaBase = 0;
  for (const c of state.costs) {
    if (!isCpvCost(c)) continue;
    const v = sum(effectiveMonthValues(c, regime));
    const isLabor = c.encargosAuto || LABOR_RE.test(c.label);
    if (isLabor) folhaCpvBase += v;
    else cpvNaoFolhaBase += v;
  }

  const folhaCpvMensalBase = folhaCpvBase / 12;
  const cpvNaoFolhaRatioBase = cpvNaoFolhaBase / receitaAnoBase;

  // NCG inicial (mesma lógica de calcIndicators)
  const { capital, revenue } = state;
  const crBase0 =
    capital.contasReceber > 0 ? capital.contasReceber : (receitaAnoBase / 360) * revenue.pmr;
  const fornecBase0 =
    capital.fornecedores > 0 ? capital.fornecedores : (cpvAnoBase / 360) * revenue.pmp;
  const estoqueBase0 = capital.estoques;
  const ncg0 = crBase0 + estoqueBase0 - fornecBase0;

  const g = cfg.crescimentoMensalPct / 100;
  // Tempo decorrido (anos) entre o mês-base que serve de molde e o mês projetado.
  // Manual: convenção contínua (auditoria #15) — "5% a.a." ≈ 0,407% a.m. composto.
  // Odoo: a janela do razão é o ano realizado; o mês i projeta o mesmo mês do
  // ano-base (i % 12) com floor(i/12)+1 anos decorridos.
  const janela = state.realizado?.meses;
  const modoOdoo = janela?.length === 12 && janela.every((m) => /^\d{4}-\d{2}$/.test(m));
  const tempoAnos = (i: number) => (modoOdoo ? Math.floor(i / 12) + 1 : i / 12);
  const inflacaoFator = (i: number) => Math.pow(1 + cfg.inflacaoFixosAA / 100, tempoAnos(i));
  const escalaCpvFator = (i: number) => Math.pow(1 - cfg.ganhoEscalaCpvAA / 100, tempoAnos(i));
  const horizon = cfg.horizonteMeses;

  // Ano-calendário do molde (mês-base) e do mês projetado.
  const anoMolde = (i: number): number | null =>
    modoOdoo ? Number(janela![i % 12].slice(0, 4)) : (cfg.anoBase ?? null);
  const anoProjetado = (i: number): number | null => {
    const a = anoMolde(i);
    return a == null ? null : a + (modoOdoo ? Math.floor(i / 12) + 1 : Math.floor(i / 12));
  };
  // Reforma: fator = carga-modelo do ano projetado ÷ carga-modelo do ano do molde,
  // aplicado à carga EFETIVA do ano-base (preserva a calibração do razão). Só vale
  // quando a era do estado é a do ano-base — uma era escolhida à mão é simulação
  // "e se" e mantém a carga constante.
  const eraDoAno = (y: number) => (y === 2026 ? "atual" : eraForYear(y));
  const anoRef = modoOdoo ? Number(janela![11].slice(0, 4)) : cfg.anoBase;
  const aplicaReforma = anoRef != null && (state.tax.era ?? "atual") === eraDoAno(anoRef);
  const cargaModelo = new Map<number, number>();
  const cargaVendasModelo = (y: number) => {
    let r = cargaModelo.get(y);
    if (r === undefined) {
      const s = stateForReformYear({ ...state, realizado: undefined }, y).state;
      const d = buildDRE(s, regime);
      const rb = sum(d.dre.receitaBruta);
      r = rb > 0 ? sum(d.tax.monthlyVendas ?? []) / rb : 0;
      cargaModelo.set(y, r);
    }
    return r;
  };
  const fatorReforma = (i: number) => {
    if (!aplicaReforma) return 1;
    const molde = anoMolde(i)!;
    const alvo = anoProjetado(i)!;
    if (alvo === molde) return 1;
    const base = cargaVendasModelo(molde);
    return base > 1e-9 ? cargaVendasModelo(alvo) / base : 1;
  };

  const meses: ForecastMonth[] = [];
  let saldo = capital.disponibilidades - cfg.capexInicial;
  let ncgAnterior = ncg0;
  // Auditoria F-03: CapEx vem do card "Investimentos em equipamentos e ativo"
  // (SSOT — capital.capexAtivacao) e NÃO de uma linha avulsa em cashflow.
  const capexBase = computeCapexMensal(state);

  for (let i = 0; i < horizon; i++) {
    const ano = Math.floor(i / 12) + 1;
    const mes = i % 12;
    const anoCalendario = anoProjetado(i);
    const mesCalendario = modoOdoo ? Number(janela![mes].slice(5, 7)) - 1 : mes;
    const label = modoOdoo ? `${MESES[mesCalendario]}/${anoCalendario}` : `Y${ano} ${MESES[mes]}`;

    const fatorReceita = Math.pow(1 + g, 12 * tempoAnos(i));
    const receita = receitaBase[mes] * fatorReceita;

    // CPV unitário melhora/piora com escala (fator anual aplicado à fração do ano)
    const cpvNaoFolha = receita * cpvNaoFolhaRatioBase * escalaCpvFator(i);

    // Variáveis não-CPV: escalam com receita
    const variaveisNaoCpv = receita * variaveisRatioBase;

    // Folha: saltos discretos. Step baseado na receita acumulada do ano corrente vs base.
    // Usa média da receita mensal anualizada do mês corrente vs base.
    const receitaAnualizada = receita * 12;
    const crescimentoVsBase = Math.max(0, receitaAnualizada / receitaAnoBase - 1);
    const stepsFolha =
      cfg.stepReceitaPct > 0 ? Math.floor((crescimentoVsBase * 100) / cfg.stepReceitaPct) : 0;
    const multFolha = Math.pow(1 + cfg.stepFolhaPct / 100, stepsFolha);
    const folhaCpv = folhaCpvMensalBase * multFolha;
    const folhaFixa = folhaFixaMensalBase * multFolha;

    const cpv = cpvNaoFolha + folhaCpv;

    // Fixos não-folha: inflação anual elevada à fração do ano
    const fatorInflacao = inflacaoFator(i);
    const fixosNaoFolha = fixosNaoFolhaMensalBase * fatorInflacao;

    const despesasOp = fixosNaoFolha + folhaFixa + variaveisNaoCpv;
    // Auditoria A1/F-01: EBITDA segue CPC 26 / DRE legal brasileira.
    // Receita Líquida = Receita Bruta − Impostos sobre Vendas (PIS/COFINS/ICMS/ISS/CBS/IBS).
    // Antes, EBITDA era calculado sobre receita BRUTA, inflando margem.
    const impostosReceita = receita * vendasRatioBase * fatorReforma(i);
    const receitaLiquida = receita * (1 - deducoesRatioBase) - impostosReceita;
    const lucroBruto = receitaLiquida - cpv;
    const ebitda = lucroBruto - despesasOp + outrasReceitasOpMensal;
    const ebit = ebitda - depMensal;
    const resultadoFinanceiro = receita * resultadoFinanceiroRatioBase; // negativo para empresas alavancadas
    // A2: IRPJ/CSLL incidem sobre o LAIR (EBIT + Resultado Financeiro), não sobre EBIT puro.
    // Para empresas alavancadas isso reduz a carga tributária (juros dedutíveis).
    const lair = ebit + resultadoFinanceiro;
    // Real: IRPJ/CSLL sobre o LAIR. Presumido: sobre a receita (presunção) — abaixo
    // do EBITDA, como na DRE. Simples: dentro do DAS (zero aqui).
    const impostosLucro = Math.max(0, lair) * taxLucroRatio + receita * lucroSobreReceitaRatio;
    const lucroLiquido = lair - impostosLucro;

    // NCG do mês: anualiza receita e CPV do mês para PMR/PMP
    const estoqueT = cpvAnoBase > 0 ? estoqueBase0 * (cpv / (cpvAnoBase / 12)) : estoqueBase0;
    const crT = (receitaAnualizada / 360) * revenue.pmr;
    const fornecT = ((cpv * 12) / 360) * revenue.pmp;
    const ncgT = crT + estoqueT - fornecT;
    const deltaNcg = ncgT - ncgAnterior;
    ncgAnterior = ncgT;

    const capex = (capexBase[mes] || 0) * fatorInflacao;
    // FCFF: não inclui resultado financeiro. O DCF desconta a WACC e depois faz o bridge
    // EV → Equity pela dívida líquida; incluir juros aqui penalizaria a dívida duas vezes.
    const fcl = ebit + depMensal - impostosLucro - capex - deltaNcg;
    saldo += fcl;

    // Guarda final: nunca propagar NaN/Infinity para a UI mesmo que algum
    // input degenerado (ex.: receita=0 + ratios indefinidos) escape.
    const safe = (n: number) => (Number.isFinite(n) ? n : 0);
    meses.push({
      idx: i,
      ano,
      mes: mesCalendario + 1,
      label,
      anoCalendario,
      receita: safe(receita),
      ebitda: safe(ebitda),
      impostosReceita: safe(impostosReceita),
      impostosLucro: safe(impostosLucro),
      lucroLiquido: safe(lucroLiquido),
      ncg: safe(ncgT),
      deltaNcg: safe(deltaNcg),
      fcl: safe(fcl),
      saldoCaixa: safe(saldo),
    });
  }

  // VPL via WACC — só precisamos de ind.wacc. Não usa cache aqui para
  // evitar ciclo forecast → financialModel → valuation → forecast.
  // Passa cf/balanco não-precomputados: essa chamada acontece 1× por
  // buildValuation e é dominada por outros custos do forecast.
  const ind = calcIndicators(state, dre);
  const waccA = Math.max(0.5, ind.wacc) / 100;
  const i_m = Math.pow(1 + waccA, 1 / 12) - 1;
  const flows: number[] = [-cfg.capexInicial, ...meses.map((m) => m.fcl)];
  const vpl = npv(flows, i_m);
  const tirDet = irrDetailed(flows);
  const payback = paybackMonths(flows);

  return {
    meses,
    totalReceita: sum(meses.map((m) => m.receita)),
    totalEbitda: sum(meses.map((m) => m.ebitda)),
    totalLucro: sum(meses.map((m) => m.lucroLiquido)),
    totalFcl: sum(meses.map((m) => m.fcl)),
    totalDeltaNcg: sum(meses.map((m) => m.deltaNcg)),
    vpl,
    tir: tirDet.value == null ? null : tirDet.value * 100,
    tirError: tirDet.error,
    paybackMeses: payback,
    taxaDescontoMensal: i_m * 100,
  };
}

// VPL clássico: flows[0] no t=0. Delegado para a biblioteca centralizada (external.ts).
export function npv(flows: number[], rate: number): number {
  return vplClassico(rate, flows);
}

// TIR via Newton-Raphson com fallback bisseção. Protegido contra r→-1 e df≈0.
export function irr(flows: number[], guess = 0.01): number | null {
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;

  let r = guess;
  for (let iter = 0; iter < 80; iter++) {
    let f = 0,
      df = 0;
    for (let t = 0; t < flows.length; t++) {
      const d = Math.pow(1 + r, t);
      f += flows[t] / d;
      if (t > 0) df += (-t * flows[t]) / (d * (1 + r));
    }
    if (Math.abs(f) < 1e-7) return r;
    if (!Number.isFinite(df) || Math.abs(df) < 1e-12) break;
    if (Math.abs(1 + r) < 1e-9) break;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -0.999) break;
    r = next;
  }
  let lo = -0.99,
    hi = 10;
  const vLo = npv(flows, lo);
  const vHi = npv(flows, hi);
  if (!Number.isFinite(vLo) || !Number.isFinite(vHi) || vLo * vHi > 0) return null;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const v = npv(flows, mid);
    if (Math.abs(v) < 1e-6) return mid;
    if (npv(flows, lo) * v < 0) hi = mid;
    else lo = mid;
  }
  return null;
}

/** Diagnóstico de TIR para auditoria — devolve o valor ou o motivo da não convergência. */
export function irrDetailed(flows: number[]): { value: number | null; error?: string } {
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg)
    return { value: null, error: "Fluxos sem sinais opostos — TIR indefinida." };
  const v = irr(flows);
  return v == null
    ? { value: null, error: "Newton-Raphson e bisseção não convergiram para esses fluxos." }
    : { value: v };
}

function paybackMonths(flows: number[]): number | null {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) {
    acc += flows[t];
    if (acc >= 0 && t > 0) return t;
  }
  return null;
}
