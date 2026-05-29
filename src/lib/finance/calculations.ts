import { AppState, SimplesAnexo, TaxRegime, BusinessType } from "./types";
import { sum, zeros12, fill12 } from "./format";

// Simples Nacional 2024 - faixas (RBT12, alíquota nominal %, parcela a deduzir R$)
type Faixa = [number, number, number];
const SIMPLES_TABLES: Record<SimplesAnexo, Faixa[]> = {
  I: [
    [180000, 4.0, 0],
    [360000, 7.3, 5940],
    [720000, 9.5, 13860],
    [1800000, 10.7, 22500],
    [3600000, 14.3, 87300],
    [4800000, 19.0, 378000],
  ],
  II: [
    [180000, 4.5, 0],
    [360000, 7.8, 5940],
    [720000, 10.0, 13860],
    [1800000, 11.2, 22500],
    [3600000, 14.7, 85500],
    [4800000, 30.0, 720000],
  ],
  III: [
    [180000, 6.0, 0],
    [360000, 11.2, 9360],
    [720000, 13.5, 17640],
    [1800000, 16.0, 35640],
    [3600000, 21.0, 125640],
    [4800000, 33.0, 648000],
  ],
  IV: [
    [180000, 4.5, 0],
    [360000, 9.0, 8100],
    [720000, 10.2, 12420],
    [1800000, 14.0, 39780],
    [3600000, 22.0, 183780],
    [4800000, 33.0, 828000],
  ],
  V: [
    [180000, 15.5, 0],
    [360000, 18.0, 4500],
    [720000, 19.5, 9900],
    [1800000, 20.5, 17100],
    [3600000, 23.0, 62100],
    [4800000, 30.5, 540000],
  ],
};

export function simplesAliquotaEfetiva(rbt12: number, anexo: SimplesAnexo): number {
  const table = SIMPLES_TABLES[anexo];
  for (const [teto, aliq, deduz] of table) {
    if (rbt12 <= teto) {
      if (rbt12 === 0) return 0;
      return Math.max(0, (rbt12 * (aliq / 100) - deduz) / rbt12) * 100;
    }
  }
  return 33;
}

export function presumidoBases(business: BusinessType): { irpj: number; csll: number } {
  if (business === "industria") return { irpj: 8, csll: 12 };
  if (business === "comercio") return { irpj: 8, csll: 12 };
  return { irpj: 32, csll: 32 };
}

export interface MonthlyTax {
  monthly: number[];
  annual: number;
  effective: number; // % over receita bruta annual
  detail: Record<string, number>; // annual breakdown
}

export function calcSimples(state: AppState): MonthlyTax {
  const { revenue, tax } = state;
  const rbAnual = sum(revenue.bruta);
  const aliq = simplesAliquotaEfetiva(rbAnual, tax.simplesAnexo) / 100;
  const monthly = revenue.bruta.map((r) => r * aliq);
  const annual = sum(monthly);
  return {
    monthly,
    annual,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail: { "DAS (Simples)": annual },
  };
}

export function calcPresumido(state: AppState): MonthlyTax {
  const { revenue, tax, businessType } = state;
  const bases = presumidoBases(businessType);
  const baseIRPJ = (tax.presumidoBaseIRPJ || bases.irpj) / 100;
  const baseCSLL = (tax.presumidoBaseCSLL || bases.csll) / 100;
  const iss = tax.issIcms / 100;

  let irpjTotal = 0,
    csllTotal = 0,
    pisTotal = 0,
    cofinsTotal = 0,
    issTotal = 0;
  const monthly = revenue.bruta.map((r) => {
    const lucroPresumidoIRPJ = r * baseIRPJ;
    const lucroPresumidoCSLL = r * baseCSLL;
    const irpj = lucroPresumidoIRPJ * 0.15;
    const adicional = Math.max(0, lucroPresumidoIRPJ - 20000) * 0.10;
    const csll = lucroPresumidoCSLL * 0.09;
    const pis = r * 0.0065;
    const cofins = r * 0.03;
    const issv = r * iss;
    irpjTotal += irpj + adicional;
    csllTotal += csll;
    pisTotal += pis;
    cofinsTotal += cofins;
    issTotal += issv;
    return irpj + adicional + csll + pis + cofins + issv;
  });
  const annual = sum(monthly);
  const rbAnual = sum(revenue.bruta);
  return {
    monthly,
    annual,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail: {
      "IRPJ + Adicional": irpjTotal,
      CSLL: csllTotal,
      PIS: pisTotal,
      COFINS: cofinsTotal,
      "ISS/ICMS": issTotal,
    },
  };
}

export function calcReal(state: AppState, baseLairMonthly: number[]): MonthlyTax {
  const { revenue, tax } = state;
  const iss = tax.issIcms / 100;
  let irpjTotal = 0,
    csllTotal = 0,
    pisTotal = 0,
    cofinsTotal = 0,
    issTotal = 0;
  const monthly = revenue.bruta.map((r, i) => {
    const lair = Math.max(0, baseLairMonthly[i] || 0);
    const irpj = lair * 0.15;
    const adicional = Math.max(0, lair - 20000) * 0.10;
    const csll = lair * 0.09;
    const pis = Math.max(0, r * 0.0165 - tax.pisCreditos);
    const cofins = Math.max(0, r * 0.076 - tax.cofinsCreditos);
    const issv = r * iss;
    irpjTotal += irpj + adicional;
    csllTotal += csll;
    pisTotal += pis;
    cofinsTotal += cofins;
    issTotal += issv;
    return irpj + adicional + csll + pis + cofins + issv;
  });
  const annual = sum(monthly);
  const rbAnual = sum(revenue.bruta);
  return {
    monthly,
    annual,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail: {
      "IRPJ + Adicional": irpjTotal,
      CSLL: csllTotal,
      "PIS (não-cum.)": pisTotal,
      "COFINS (não-cum.)": cofinsTotal,
      "ISS/ICMS": issTotal,
    },
  };
}

export function monthValues(line: { values: number[]; fixed: boolean }): number[] {
  return line.fixed ? fill12(line.values[0] || 0) : line.values;
}

export interface DRE {
  receitaBruta: number[];
  deducoesInadimplencia: number[];
  receitaLiquida: number[];
  cpv: number[]; // for now grouped under "insumos" type
  lucroBruto: number[];
  despesasOperacionais: number[];
  ebitda: number[];
  depreciacao: number[];
  ebit: number[];
  resultadoFinanceiro: number[]; // negative when expense exceeds income
  lair: number[];
  impostos: number[];
  lucroLiquido: number[];
  // breakdown
  despesasPorCategoria: Record<string, number[]>;
  custosFinanceirosTotal: number[];
  custosOperacionaisTotal: number[];
  custosFixos: number[];
  custosVariaveis: number[];
}

const VARIABLE_LIKE_IDS = new Set(["insumos", "fretes", "marketing"]);
const CPV_IDS = new Set(["insumos", "fretes"]);

export function buildDRE(state: AppState, regime: TaxRegime): { dre: DRE; tax: MonthlyTax } {
  const { revenue, costs, capital } = state;

  const receitaBruta = revenue.bruta.slice();
  const deducoesInadimplencia = revenue.bruta.map((r, i) => r * (revenue.inadimplencia[i] / 100));
  const receitaLiquida = receitaBruta.map((r, i) => r - deducoesInadimplencia[i]);

  const opLines = costs.filter((c) => c.group === "operacional");
  const finLines = costs.filter((c) => c.group === "financeiro");

  const cpv = zeros12();
  const despOp = zeros12();
  const custosFixos = zeros12();
  const custosVariaveis = zeros12();
  const despesasPorCategoria: Record<string, number[]> = {};

  for (const line of opLines) {
    const v = monthValues(line);
    despesasPorCategoria[line.label] = v;
    for (let i = 0; i < 12; i++) {
      if (CPV_IDS.has(line.id)) cpv[i] += v[i];
      else despOp[i] += v[i];
      if (line.variavel || VARIABLE_LIKE_IDS.has(line.id)) custosVariaveis[i] += v[i];
      else custosFixos[i] += v[i];
    }
  }

  const custosFinanceirosTotal = zeros12();
  for (const line of finLines) {
    const v = monthValues(line);
    for (let i = 0; i < 12; i++) custosFinanceirosTotal[i] += v[i];
  }

  const lucroBruto = receitaLiquida.map((r, i) => r - cpv[i]);
  const ebitda = lucroBruto.map((g, i) => g - despOp[i]);
  const depreciacao = fill12(capital.depreciacaoMensal);
  const ebit = ebitda.map((e, i) => e - depreciacao[i]);
  const resultadoFinanceiro = ebit.map((_, i) => capital.jurosRecebidosMensal - custosFinanceirosTotal[i]);
  const lair = ebit.map((e, i) => e + resultadoFinanceiro[i]);

  let tax: MonthlyTax;
  if (regime === "simples") tax = calcSimples(state);
  else if (regime === "presumido") tax = calcPresumido(state);
  else tax = calcReal(state, lair);

  const lucroLiquido = lair.map((l, i) => l - tax.monthly[i]);

  const custosOperacionaisTotal = cpv.map((c, i) => c + despOp[i]);

  return {
    dre: {
      receitaBruta,
      deducoesInadimplencia,
      receitaLiquida,
      cpv,
      lucroBruto,
      despesasOperacionais: despOp,
      ebitda,
      depreciacao,
      ebit,
      resultadoFinanceiro,
      lair,
      impostos: tax.monthly,
      lucroLiquido,
      despesasPorCategoria,
      custosFinanceirosTotal,
      custosOperacionaisTotal,
      custosFixos,
      custosVariaveis,
    },
    tax,
  };
}

export interface Indicators {
  margemBruta: number;
  margemEbitda: number;
  margemEbit: number;
  margemLiquida: number;
  margemContribuicao: number; // %
  pontoEquilibrio: number; // R$ anual de receita
  pontoEquilibrioFinanceiro: number;
  roe: number;
  roa: number;
  roic: number;
  wacc: number;
  cicloFinanceiro: number;
  ncg: number;
  gapCapitalGiro: number;
  liquidezCorrente: number;
  liquidezSeca: number;
  liquidezImediata: number;
  endividamentoGeral: number;
  grauEndividamento: number;
  coberturaJuros: number;
  giroAtivo: number;
  dividaLiqEbitda: number;
  payback: number;
  fcf: number;
}

export function calcIndicators(state: AppState, dre: DRE): Indicators {
  const { capital, revenue } = state;
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const receitaBrutaAnual = sum(dre.receitaBruta);
  const lucroBrutoAnual = sum(dre.lucroBruto);
  const ebitdaAnual = sum(dre.ebitda);
  const ebitAnual = sum(dre.ebit);
  const llAnual = sum(dre.lucroLiquido);
  const custosVarAnual = sum(dre.custosVariaveis);
  const custosFixosAnual = sum(dre.custosFixos) + sum(dre.depreciacao);
  const jurosAnual = sum(dre.custosFinanceirosTotal);
  const impostosAnual = sum(dre.impostos);

  const margemContribuicao = receitaLiqAnual > 0 ? ((receitaLiqAnual - custosVarAnual) / receitaLiqAnual) * 100 : 0;
  const pontoEquilibrio = margemContribuicao > 0 ? custosFixosAnual / (margemContribuicao / 100) : 0;
  const pontoEquilibrioFinanceiro =
    margemContribuicao > 0 ? (custosFixosAnual - sum(dre.depreciacao)) / (margemContribuicao / 100) : 0;

  const E = capital.proprio / 100;
  const D = 1 - E;
  const irShield = 1 - 0.34; // assume 34% combined for shield reference
  const wacc = E * capital.ke + D * capital.kd * irShield;

  const capitalInvestido = capital.patrimonioLiquido + (capital.ativoTotal - capital.patrimonioLiquido);
  const nopat = ebitAnual * (1 - 0.34);
  const roic = capitalInvestido > 0 ? (nopat / capitalInvestido) * 100 : 0;
  const roe = capital.patrimonioLiquido > 0 ? (llAnual / capital.patrimonioLiquido) * 100 : 0;
  const roa = capital.ativoTotal > 0 ? (llAnual / capital.ativoTotal) * 100 : 0;

  const cicloFinanceiro = revenue.pmr - revenue.pmp;
  const custoMedioMensal = (custosFixosAnual + custosVarAnual) / 12;
  const ncg = (custoMedioMensal / 30) * Math.max(0, cicloFinanceiro);
  const gapCapitalGiro = ncg - capital.capitalGiroDisponivel;

  const passivoTotal = capital.ativoTotal - capital.patrimonioLiquido;
  const ativoCirculante = capital.disponibilidades + (receitaBrutaAnual / 360) * revenue.pmr + capital.estoques;
  const passivoCirculante = Math.max(1, passivoTotal); // simplified

  const liquidezCorrente = ativoCirculante / passivoCirculante;
  const liquidezSeca = (ativoCirculante - capital.estoques) / passivoCirculante;
  const liquidezImediata = capital.disponibilidades / passivoCirculante;
  const endividamentoGeral = capital.ativoTotal > 0 ? (passivoTotal / capital.ativoTotal) * 100 : 0;
  const grauEndividamento = capital.patrimonioLiquido > 0 ? (passivoTotal / capital.patrimonioLiquido) * 100 : 0;
  const coberturaJuros = jurosAnual > 0 ? ebitAnual / jurosAnual : Infinity;
  const giroAtivo = capital.ativoTotal > 0 ? receitaLiqAnual / capital.ativoTotal : 0;
  const dividaLiqEbitda = ebitdaAnual > 0 ? (passivoTotal - capital.disponibilidades) / ebitdaAnual : Infinity;
  const payback = llAnual > 0 ? capital.patrimonioLiquido / llAnual : Infinity;
  const fcf = ebitdaAnual - impostosAnual - Math.max(0, ncg);

  return {
    margemBruta: receitaLiqAnual > 0 ? (lucroBrutoAnual / receitaLiqAnual) * 100 : 0,
    margemEbitda: receitaLiqAnual > 0 ? (ebitdaAnual / receitaLiqAnual) * 100 : 0,
    margemEbit: receitaLiqAnual > 0 ? (ebitAnual / receitaLiqAnual) * 100 : 0,
    margemLiquida: receitaLiqAnual > 0 ? (llAnual / receitaLiqAnual) * 100 : 0,
    margemContribuicao,
    pontoEquilibrio,
    pontoEquilibrioFinanceiro,
    roe,
    roa,
    roic,
    wacc,
    cicloFinanceiro,
    ncg,
    gapCapitalGiro,
    liquidezCorrente,
    liquidezSeca,
    liquidezImediata,
    endividamentoGeral,
    grauEndividamento,
    coberturaJuros,
    giroAtivo,
    dividaLiqEbitda,
    payback,
    fcf,
  };
}

export interface Diagnostic {
  level: "ok" | "warn" | "danger";
  title: string;
  message: string;
}

export function diagnose(state: AppState, dre: DRE, ind: Indicators): Diagnostic[] {
  const out: Diagnostic[] = [];
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const folha = (state.costs.find((c) => c.id === "salarios")?.values.reduce((a, b) => a + b, 0) || 0) *
    (state.costs.find((c) => c.id === "salarios")?.fixed ? 12 : 1);
  const folhaPct = receitaLiqAnual > 0 ? (folha / receitaLiqAnual) * 100 : 0;
  if (folhaPct > 35) out.push({ level: "danger", title: "Custo de mão de obra elevado", message: `Folha CLT representa ${folhaPct.toFixed(1)}% da receita líquida. Acima de 35% pressiona margens — avalie produtividade, terceirização ou redesenho de processos.` });
  else if (folhaPct > 25) out.push({ level: "warn", title: "Folha em zona de atenção", message: `Folha em ${folhaPct.toFixed(1)}% da receita. Monitore eficiência por colaborador.` });

  const fixoPct = receitaLiqAnual > 0 ? (sum(dre.custosFixos) / receitaLiqAnual) * 100 : 0;
  if (fixoPct > 50) out.push({ level: "danger", title: "Custos fixos altos demais", message: `Custos fixos somam ${fixoPct.toFixed(1)}% da receita. Alta alavancagem operacional — qualquer queda de faturamento gera prejuízo rápido.` });

  if (ind.margemBruta < 25) out.push({ level: "danger", title: "Margem bruta baixa", message: `Margem bruta de ${ind.margemBruta.toFixed(1)}%. Custo de produto/serviço vendido alto — reveja precificação e custos diretos.` });
  if (ind.margemLiquida < 5) out.push({ level: ind.margemLiquida < 0 ? "danger" : "warn", title: "Margem líquida insuficiente", message: `Margem líquida em ${ind.margemLiquida.toFixed(1)}%. Saudável para PME costuma ficar acima de 8–10%.` });

  if (ind.coberturaJuros < 2 && Number.isFinite(ind.coberturaJuros)) out.push({ level: "danger", title: "Cobertura de juros perigosa", message: `EBIT cobre apenas ${ind.coberturaJuros.toFixed(1)}× os juros. Risco de inadimplência financeira.` });
  if (ind.dividaLiqEbitda > 3 && Number.isFinite(ind.dividaLiqEbitda)) out.push({ level: "warn", title: "Alavancagem elevada", message: `Dívida Líquida / EBITDA = ${ind.dividaLiqEbitda.toFixed(1)}×. Renegocie prazos e custo da dívida.` });

  if (ind.gapCapitalGiro > 0) out.push({ level: "warn", title: "Necessidade de capital de giro não coberta", message: `Faltam ${ind.gapCapitalGiro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para sustentar o ciclo operacional. Reduza PMR ou negocie PMP maior.` });

  if (ind.roic < ind.wacc) out.push({ level: "danger", title: "Empresa está destruindo valor", message: `ROIC (${ind.roic.toFixed(1)}%) abaixo do WACC (${ind.wacc.toFixed(1)}%). O retorno do capital investido não cobre o custo do capital.` });
  else out.push({ level: "ok", title: "Empresa cria valor econômico", message: `ROIC (${ind.roic.toFixed(1)}%) acima do WACC (${ind.wacc.toFixed(1)}%). Bom sinal de geração de valor.` });

  if (ind.liquidezCorrente < 1) out.push({ level: "danger", title: "Liquidez corrente crítica", message: `Liquidez corrente ${ind.liquidezCorrente.toFixed(2)} — ativo circulante não cobre o passivo de curto prazo.` });

  return out;
}

export function compareRegimes(state: AppState) {
  const baseLair = buildDRE(state, "presumido").dre.lair;
  return {
    simples: calcSimples(state),
    presumido: calcPresumido(state),
    real: calcReal(state, baseLair),
  };
}
