import { AppState, SimplesAnexo, TaxRegime, BusinessType, CostLine, DEFAULT_ENCARGOS_PCT } from "./types";
import { sum, zeros12, fill12 } from "./format";

// =====================================================================
// SIMPLES NACIONAL 2024
// =====================================================================
type Faixa = [number, number, number];
const SIMPLES_TABLES: Record<SimplesAnexo, Faixa[]> = {
  I:   [[180000,4.0,0],[360000,7.3,5940],[720000,9.5,13860],[1800000,10.7,22500],[3600000,14.3,87300],[4800000,19.0,378000]],
  II:  [[180000,4.5,0],[360000,7.8,5940],[720000,10.0,13860],[1800000,11.2,22500],[3600000,14.7,85500],[4800000,30.0,720000]],
  III: [[180000,6.0,0],[360000,11.2,9360],[720000,13.5,17640],[1800000,16.0,35640],[3600000,21.0,125640],[4800000,33.0,648000]],
  IV:  [[180000,4.5,0],[360000,9.0,8100],[720000,10.2,12420],[1800000,14.0,39780],[3600000,22.0,183780],[4800000,33.0,828000]],
  V:   [[180000,15.5,0],[360000,18.0,4500],[720000,19.5,9900],[1800000,20.5,17100],[3600000,23.0,62100],[4800000,30.5,540000]],
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

// =====================================================================
// Encargos automáticos sobre folha CLT
// =====================================================================
export function effectiveMonthValues(c: CostLine): number[] {
  const raw = c.fixed ? fill12(c.values[0] || 0) : c.values.slice();
  if (c.encargosAuto) {
    const factor = 1 + (c.encargosPct ?? DEFAULT_ENCARGOS_PCT) / 100;
    return raw.map((v) => v * factor);
  }
  return raw;
}

/** Mantido para retro-compatibilidade — agora aplica encargos. */
export function monthValues(c: CostLine): number[] {
  return effectiveMonthValues(c);
}

// =====================================================================
// Fator R automático: Anexo V vira III se folha/RBT12 ≥ 28%
// =====================================================================
const LABOR_KEYWORDS = /sal[áa]rio|folha|prolabore|pró-labore|mod|mão de obra|m\.o\.|clt/i;

function folhaAnual(state: AppState): number {
  return state.costs
    .filter((c) => c.category !== "financeiro" && (c.encargosAuto || LABOR_KEYWORDS.test(c.label)))
    .reduce((acc, c) => acc + sum(effectiveMonthValues(c)), 0);
}

export function resolveSimplesAnexo(state: AppState): SimplesAnexo {
  const anexo = state.tax.simplesAnexo;
  if (!state.tax.fatorRAuto || anexo !== "V") return anexo;
  const rbt12 = sum(state.revenue.bruta);
  if (rbt12 <= 0) return anexo;
  const fatorR = folhaAnual(state) / rbt12;
  return fatorR >= 0.28 ? "III" : "V";
}

// =====================================================================
// IMPOSTOS
// =====================================================================
export interface MonthlyTax {
  monthly: number[];
  annual: number;
  effective: number;
  detail: Record<string, number>;
}

/** Adicional IRPJ trimestral: 10% sobre lucro trimestral acima de R$60k (R$20k × 3 meses). */
function adicionalIrpjTrimestral(baseMensal: number[]): number[] {
  const out = zeros12();
  for (let t = 0; t < 4; t++) {
    const m0 = t * 3;
    const baseTri = (baseMensal[m0] || 0) + (baseMensal[m0 + 1] || 0) + (baseMensal[m0 + 2] || 0);
    const excedente = Math.max(0, baseTri - 60000);
    const adic = excedente * 0.10;
    // distribui proporcionalmente entre os meses do trimestre
    const totalBase = baseTri > 0 ? baseTri : 1;
    for (let k = 0; k < 3; k++) {
      const i = m0 + k;
      out[i] = adic * ((baseMensal[i] || 0) / totalBase);
    }
  }
  return out;
}

export function calcSimples(state: AppState): MonthlyTax {
  const { revenue } = state;
  const anexo = resolveSimplesAnexo(state);
  const rbAnual = sum(revenue.bruta);
  const aliq = simplesAliquotaEfetiva(rbAnual, anexo) / 100;
  const monthly = revenue.bruta.map((r) => r * aliq);
  const annual = sum(monthly);
  return {
    monthly,
    annual,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail: { [`DAS Simples (Anexo ${anexo})`]: annual },
  };
}

export function calcPresumido(state: AppState): MonthlyTax {
  const { revenue, tax, businessType } = state;
  const bases = presumidoBases(businessType);
  const baseIRPJ = (tax.presumidoBaseIRPJ || bases.irpj) / 100;
  const baseCSLL = (tax.presumidoBaseCSLL || bases.csll) / 100;
  const iss = tax.issIcms / 100;
  const issDed = (tax.issDeducoes ?? 0) / 12;
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;

  // CPV mensal para crédito de ICMS
  const cpvMonthly = zeros12();
  if (icmsCredAliq > 0) {
    for (const c of state.costs) {
      if (c.category !== "custo_vendas") continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }

  const baseIRPJMensal = revenue.bruta.map((r) => r * baseIRPJ);
  const baseCSLLMensal = revenue.bruta.map((r) => r * baseCSLL);
  const adicionalMensal = adicionalIrpjTrimestral(baseIRPJMensal);

  let irpjTotal = 0, csllTotal = 0, pisTotal = 0, cofinsTotal = 0, issTotal = 0;
  const monthly = revenue.bruta.map((r, i) => {
    const irpj = baseIRPJMensal[i] * 0.15;
    const adicional = adicionalMensal[i];
    const csll = baseCSLLMensal[i] * 0.09;
    const pis = r * 0.0065;
    const cofins = r * 0.03;
    const issBase = Math.max(0, r - issDed);
    const debito = issBase * iss;
    const credito = cpvMonthly[i] * icmsCredAliq;
    const issv = Math.max(0, debito - credito);
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
      "IRPJ": irpjTotal - sum(adicionalMensal),
      "Adicional IRPJ (10%)": sum(adicionalMensal),
      CSLL: csllTotal,
      PIS: pisTotal,
      COFINS: cofinsTotal,
      [isMercadoria ? "ICMS (líquido)" : "ISS"]: issTotal,
    },
  };
}

export function calcReal(state: AppState, baseLairMonthly: number[]): MonthlyTax {
  const { revenue, tax, businessType } = state;
  const iss = tax.issIcms / 100;
  const issDed = (tax.issDeducoes ?? 0) / 12;
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;

  const cpvMonthly = zeros12();
  if (icmsCredAliq > 0) {
    for (const c of state.costs) {
      if (c.category !== "custo_vendas") continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }

  const baseIRPJMensal = baseLairMonthly.map((l) => Math.max(0, l));
  const adicionalMensal = adicionalIrpjTrimestral(baseIRPJMensal);

  let irpjTotal = 0, csllTotal = 0, pisTotal = 0, cofinsTotal = 0, issTotal = 0;
  const monthly = revenue.bruta.map((r, i) => {
    const lair = baseIRPJMensal[i];
    const irpj = lair * 0.15;
    const adicional = adicionalMensal[i];
    const csll = lair * 0.09;
    const pis = Math.max(0, r * 0.0165 - tax.pisCreditos);
    const cofins = Math.max(0, r * 0.076 - tax.cofinsCreditos);
    const issBase = Math.max(0, r - issDed);
    const debito = issBase * iss;
    const credito = cpvMonthly[i] * icmsCredAliq;
    const issv = Math.max(0, debito - credito);
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
      "IRPJ": irpjTotal - sum(adicionalMensal),
      "Adicional IRPJ (10%)": sum(adicionalMensal),
      CSLL: csllTotal,
      "PIS (não-cum.)": pisTotal,
      "COFINS (não-cum.)": cofinsTotal,
      [isMercadoria ? "ICMS (líquido)" : "ISS"]: issTotal,
    },
  };
}

// =====================================================================
// DRE
// =====================================================================
export interface DRE {
  receitaBruta: number[];
  deducoesInadimplencia: number[]; // 0 se inadimplenciaComoPDD
  pdd: number[];                    // 0 se !inadimplenciaComoPDD
  receitaLiquida: number[];
  cpv: number[];
  lucroBruto: number[];
  despesasOperacionais: number[];
  ebitda: number[];
  depreciacao: number[];
  ebit: number[];
  resultadoFinanceiro: number[];
  lair: number[];
  impostos: number[];
  lucroLiquido: number[];
  despesasPorCategoria: Record<string, number[]>;
  custosFinanceirosTotal: number[];
  custosOperacionaisTotal: number[];
  custosFixos: number[];
  custosVariaveis: number[];
  folhaCltAnual: number;
}

export function buildDRE(state: AppState, regime: TaxRegime): { dre: DRE; tax: MonthlyTax } {
  const { revenue, costs, capital } = state;
  const usaPDD = !!revenue.inadimplenciaComoPDD;

  const receitaBruta = revenue.bruta.slice();
  const inadimp = revenue.bruta.map((r, i) => r * (revenue.inadimplencia[i] / 100));
  const deducoesInadimplencia = usaPDD ? zeros12() : inadimp.slice();
  const pdd = usaPDD ? inadimp.slice() : zeros12();
  const receitaLiquida = receitaBruta.map((r, i) => r - deducoesInadimplencia[i]);

  const cpv = zeros12();
  const despOp = zeros12();
  const custosFixos = zeros12();
  const custosVariaveis = zeros12();
  const despesasPorCategoria: Record<string, number[]> = {};

  for (const c of costs) {
    if (c.category === "financeiro") continue;
    const v = effectiveMonthValues(c);
    despesasPorCategoria[c.label] = v;
    for (let i = 0; i < 12; i++) {
      if (c.category === "custo_vendas") { cpv[i] += v[i]; custosVariaveis[i] += v[i]; }
      else if (c.category === "variavel") { despOp[i] += v[i]; custosVariaveis[i] += v[i]; }
      else { despOp[i] += v[i]; custosFixos[i] += v[i]; }
    }
  }

  // PDD entra como despesa operacional fixa
  if (usaPDD) {
    for (let i = 0; i < 12; i++) {
      despOp[i] += pdd[i];
      custosFixos[i] += pdd[i];
    }
    despesasPorCategoria["PDD — Perdas por inadimplência"] = pdd.slice();
  }

  const custosFinanceirosTotal = zeros12();
  for (const c of costs.filter((x) => x.category === "financeiro")) {
    const v = effectiveMonthValues(c);
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
      receitaBruta, deducoesInadimplencia, pdd, receitaLiquida,
      cpv, lucroBruto, despesasOperacionais: despOp,
      ebitda, depreciacao, ebit, resultadoFinanceiro, lair,
      impostos: tax.monthly, lucroLiquido,
      despesasPorCategoria, custosFinanceirosTotal, custosOperacionaisTotal,
      custosFixos, custosVariaveis,
      folhaCltAnual: folhaAnual(state),
    },
    tax,
  };
}

// =====================================================================
// INDICADORES
// =====================================================================
export interface Indicators {
  margemBruta: number;
  margemEbitda: number;
  margemEbit: number;
  margemLiquida: number;
  margemContribuicao: number;
  pontoEquilibrio: number;
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
  // novos
  dividaOnerosa: number;
  passivoCirculante: number;
  ativoCirculante: number;
}

/** Shield fiscal aproximado por regime (juros deduzem só em Lucro Real). */
export function irShieldForRegime(regime: TaxRegime): number {
  if (regime === "real") return 0.34;
  if (regime === "presumido") return 0.10; // shield indireto pequeno
  return 0; // Simples — juros não geram dedução
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
  const pontoEquilibrioFinanceiro = margemContribuicao > 0
    ? (custosFixosAnual - sum(dre.depreciacao)) / (margemContribuicao / 100)
    : 0;

  // ---- Estrutura de capital baseada em campos REAIS ----
  const PL = Math.max(0, capital.patrimonioLiquido);
  const D  = Math.max(0, capital.dividaOnerosa);
  const V  = PL + D;
  const wE = V > 0 ? PL / V : capital.proprio / 100;
  const wD = V > 0 ? D / V : 1 - capital.proprio / 100;

  const irShield = irShieldForRegime(state.tax.regime);
  const wacc = wE * capital.ke + wD * capital.kd * (1 - irShield);

  // ---- ROIC com capital investido correto ----
  const capitalInvestido = PL + D;
  const nopat = ebitAnual * (1 - irShield);
  const roic = capitalInvestido > 0 ? (nopat / capitalInvestido) * 100 : 0;
  const roe = PL > 0 ? (llAnual / PL) * 100 : 0;
  const roa = capital.ativoTotal > 0 ? (llAnual / capital.ativoTotal) * 100 : 0;

  // ---- Ciclo / NCG / Gap ----
  const cicloFinanceiro = revenue.pmr - revenue.pmp;
  // NCG: usa CR + Estoque − Fornecedores; fallback estimado se zerado
  const crEstimado = capital.contasReceber > 0 ? capital.contasReceber : (receitaBrutaAnual / 360) * revenue.pmr;
  const custoMedioMensal = (custosFixosAnual + custosVarAnual) / 12;
  const fornecEstimado = capital.fornecedores > 0
    ? capital.fornecedores
    : (sum(dre.cpv) / 360) * revenue.pmp;
  const ncg = crEstimado + capital.estoques - fornecEstimado;
  // Gap pode ser negativo (libera caixa) — ciclo negativo gera caixa
  const gapCapitalGiro = ncg - capital.capitalGiroDisponivel;

  // ---- Liquidez com AC/PC reais ----
  const ativoCirculante = capital.ativoCirculante > 0
    ? capital.ativoCirculante
    : capital.disponibilidades + crEstimado + capital.estoques;
  const passivoCirculante = capital.passivoCirculante > 0
    ? capital.passivoCirculante
    : Math.max(1, fornecEstimado + D * 0.3); // estimativa: 30% da dívida vence em CP

  const liquidezCorrente = ativoCirculante / passivoCirculante;
  const liquidezSeca = (ativoCirculante - capital.estoques) / passivoCirculante;
  const liquidezImediata = capital.disponibilidades / passivoCirculante;

  // ---- Endividamento (apenas dívida onerosa para alavancagem) ----
  const passivoTotalEstim = capital.ativoTotal - PL;
  const endividamentoGeral = capital.ativoTotal > 0 ? (passivoTotalEstim / capital.ativoTotal) * 100 : 0;
  const grauEndividamento = PL > 0 ? (D / PL) * 100 : 0;
  const coberturaJuros = jurosAnual > 0 ? ebitAnual / jurosAnual : Infinity;
  const giroAtivo = capital.ativoTotal > 0 ? receitaLiqAnual / capital.ativoTotal : 0;
  const dividaLiq = D - capital.disponibilidades;
  const dividaLiqEbitda = ebitdaAnual > 0 ? dividaLiq / ebitdaAnual : (dividaLiq <= 0 ? 0 : Infinity);
  const payback = llAnual > 0 ? PL / llAnual : Infinity;
  const fcf = ebitdaAnual - impostosAnual - Math.max(0, ncg - capital.capitalGiroDisponivel);

  return {
    margemBruta: receitaLiqAnual > 0 ? (lucroBrutoAnual / receitaLiqAnual) * 100 : 0,
    margemEbitda: receitaLiqAnual > 0 ? (ebitdaAnual / receitaLiqAnual) * 100 : 0,
    margemEbit: receitaLiqAnual > 0 ? (ebitAnual / receitaLiqAnual) * 100 : 0,
    margemLiquida: receitaLiqAnual > 0 ? (llAnual / receitaLiqAnual) * 100 : 0,
    margemContribuicao, pontoEquilibrio, pontoEquilibrioFinanceiro,
    roe, roa, roic, wacc,
    cicloFinanceiro, ncg, gapCapitalGiro,
    liquidezCorrente, liquidezSeca, liquidezImediata,
    endividamentoGeral, grauEndividamento, coberturaJuros, giroAtivo,
    dividaLiqEbitda, payback, fcf,
    dividaOnerosa: D, passivoCirculante, ativoCirculante,
  };
}

// =====================================================================
// DIAGNÓSTICO (mantido)
// =====================================================================
export interface Diagnostic { level: "ok" | "warn" | "danger"; title: string; message: string; }

export function diagnose(state: AppState, dre: DRE, ind: Indicators): Diagnostic[] {
  const out: Diagnostic[] = [];
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const folha = dre.folhaCltAnual;
  const folhaPct = receitaLiqAnual > 0 ? (folha / receitaLiqAnual) * 100 : 0;
  if (folhaPct > 35) out.push({ level: "danger", title: "Custo de mão de obra elevado", message: `Folha (com encargos) ${folhaPct.toFixed(1)}% da receita líquida.` });
  else if (folhaPct > 25) out.push({ level: "warn", title: "Folha em zona de atenção", message: `Folha em ${folhaPct.toFixed(1)}% da receita.` });

  const fixoPct = receitaLiqAnual > 0 ? (sum(dre.custosFixos) / receitaLiqAnual) * 100 : 0;
  if (fixoPct > 50) out.push({ level: "danger", title: "Custos fixos altos demais", message: `Custos fixos somam ${fixoPct.toFixed(1)}% da receita.` });

  if (ind.margemBruta < 25) out.push({ level: "danger", title: "Margem bruta baixa", message: `Margem bruta de ${ind.margemBruta.toFixed(1)}%.` });
  if (ind.margemLiquida < 5) out.push({ level: ind.margemLiquida < 0 ? "danger" : "warn", title: "Margem líquida insuficiente", message: `Margem líquida em ${ind.margemLiquida.toFixed(1)}%.` });

  if (ind.coberturaJuros < 2 && Number.isFinite(ind.coberturaJuros)) out.push({ level: "danger", title: "Cobertura de juros perigosa", message: `EBIT cobre apenas ${ind.coberturaJuros.toFixed(1)}× os juros.` });
  if (ind.dividaLiqEbitda > 3 && Number.isFinite(ind.dividaLiqEbitda)) out.push({ level: "warn", title: "Alavancagem elevada", message: `Dívida Líq./EBITDA = ${ind.dividaLiqEbitda.toFixed(1)}×.` });

  if (ind.gapCapitalGiro > 0) out.push({ level: "warn", title: "Necessidade de Capital de Giro não coberta", message: `Falta ${ind.gapCapitalGiro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para o ciclo operacional.` });
  else if (ind.gapCapitalGiro < 0 && ind.ncg < 0) out.push({ level: "ok", title: "Ciclo financeiro libera caixa", message: `Empresa com ciclo negativo (PMP > PMR) — recebe antes de pagar.` });

  if (ind.roic < ind.wacc) out.push({ level: "danger", title: "Empresa destrói valor", message: `ROIC ${ind.roic.toFixed(1)}% < WACC ${ind.wacc.toFixed(1)}%.` });
  else out.push({ level: "ok", title: "Empresa cria valor econômico", message: `ROIC ${ind.roic.toFixed(1)}% ≥ WACC ${ind.wacc.toFixed(1)}%.` });

  if (ind.liquidezCorrente < 1) out.push({ level: "danger", title: "Liquidez corrente crítica", message: `Liquidez corrente ${ind.liquidezCorrente.toFixed(2)}.` });

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
