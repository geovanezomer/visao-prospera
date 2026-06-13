import { AppState, SimplesAnexo, TaxRegime, BusinessType, CostLine, DEFAULT_ENCARGOS_PCT, TaxEra, TaxConfig } from "./types";
import {
  getIrpjPct, getIrpjAdicionalPct, getIrpjAdicionalGatilhoTri, getCsllPct,
  getPisCumPct, getCofinsCumPct, getPisNaoCumPct, getCofinsNaoCumPct,
  getSimplesLimite, getFatorRMinimoPct,
  getSimplesTable, getPresumidoBases,
  getReformaTransicaoIbsMult, getReformaTransicaoIcmsIssMult,
} from "./taxDefaults";
import { sum, zeros12, fill12 } from "./format";

/** 
 * Soma mensal das linhas livres de dedução da Receita (devoluções, perdas, descontos, etc.). 
 * @formula Σ (Revenue.deducoes.valores)
 */
export function outrasDeducoesMensal(state: AppState): number[] {
  const out = zeros12();
  const deds = state.revenue.deducoes ?? [];
  for (const d of deds) {
    if (!Array.isArray(d.valores)) continue;
    for (let i = 0; i < 12; i++) out[i] += Math.max(0, d.valores[i] || 0);
  }
  return out;
}

/** 
 * Receita Bruta menos outras deduções — base usada para impostos sobre venda. 
 * @formula Receita Bruta − Outras Deduções
 */
function receitaTributavel(state: AppState): number[] {
  const out = outrasDeducoesMensal(state);
  return state.revenue.bruta.map((b, i) => Math.max(0, (b || 0) - out[i]));
}

// =====================================================================
// REFORMA TRIBUTÁRIA — CBS/IBS (EC 132/2023 + LC 214/2025)
// =====================================================================
/** Parâmetros vigentes da reforma para uma dada era.
 *  - cbsPct, ibsPct: alíquotas de débito sobre a receita bruta (%).
 *  - pisCofinsMult, icmsIssMult: multiplicador (0..1) sobre o que seria devido no sistema antigo.
 *  Cronograma oficial: 2026 teste (CBS 0.9% compensável c/ PIS/COFINS, IBS 0.1%);
 *  2027 CBS pleno e PIS/COFINS extintos; IBS faseado 20/40/60/80% em 2029–2032;
 *  ICMS/ISS reduzido 10pp/ano de 2029 a 2032 até extinção em 2033. */
export interface ReformaRates {
  cbsPct: number;
  ibsPct: number;
  pisCofinsMult: number;
  icmsIssMult: number;
}

export function getReformaRates(era: TaxEra | undefined, cfg: TaxConfig): ReformaRates {
  const cbsFull = cfg.cbsAliquota ?? 8.8;
  const ibsFull = cfg.ibsAliquotaRef ?? 17.7;
  const ibsMult = getReformaTransicaoIbsMult(cfg);
  const icmsIssMult = getReformaTransicaoIcmsIssMult(cfg);
  switch (era ?? "atual") {
    case "atual":
      return { cbsPct: 0, ibsPct: 0, pisCofinsMult: 1, icmsIssMult: 1 };
    // Transição 2027–2032 (ponto médio): CBS pleno, PIS/COFINS extintos,
    // IBS na fração configurada (default 50%), ICMS/ISS na fração configurada (default 50%).
    case "transicao":
      return { cbsPct: cbsFull, ibsPct: ibsFull * ibsMult, pisCofinsMult: 0, icmsIssMult };
    case "pleno":
      return { cbsPct: cbsFull, ibsPct: ibsFull, pisCofinsMult: 0, icmsIssMult: 0 };
  }
}

// =====================================================================
// SIMPLES NACIONAL — tabelas vivem em taxDefaults.ts (editáveis via painel)
// =====================================================================
export function simplesAliquotaEfetiva(rbt12: number, anexo: SimplesAnexo, tax: TaxConfig): number {
  const table = getSimplesTable(tax, anexo);
  for (const [teto, aliq, deduz] of table) {
    if (rbt12 <= teto) {
      if (rbt12 === 0) return 0;
      return Math.max(0, (rbt12 * (aliq / 100) - deduz) / rbt12) * 100;
    }
  }
  return 33;
}

/** @deprecated Use getPresumidoBases(tax, business) de taxDefaults.ts. Mantido para retro-compat. */
export function presumidoBases(business: BusinessType): { irpj: number; csll: number } {
  return getPresumidoBases({ ratesOverride: undefined } as TaxConfig, business);
}

// =====================================================================
// Encargos automáticos sobre folha CLT
// =====================================================================
export function fixedCostBase(values: number[]): number {
  const normalized = values.length === 12 ? values : fill12(values[0] || 0);
  const first = normalized[0] || 0;
  // Se todos os meses são iguais, retorna o valor.
  if (normalized.every((v) => v === first)) return first;
  // Caso contrário (estado inconsistente para um custo marcado fixo),
  // adota a edição mais recente — varre do mês 12 para trás procurando
  // o último valor distinto do anterior. Generaliza o antigo heurístico
  // que só detectava alteração no mês 12.
  for (let i = normalized.length - 1; i > 0; i--) {
    if (normalized[i] !== normalized[i - 1]) return normalized[i] || 0;
  }
  return normalized[normalized.length - 1] || first;
}

export function effectiveMonthValues(c: CostLine, regime?: TaxRegime): number[] {
  const raw = c.fixed ? fill12(fixedCostBase(c.values)) : c.values.slice();
  if (c.encargosAuto) {
    // Auditoria: Se regime for Simples Nacional, os encargos patronais (CPP) já estão no DAS.
    // Reduzimos o multiplicador padrão para evitar bitributação, mantendo apenas FGTS/Férias/13º (~25-30%).
    const isSimples = regime === "simples";
    const defaultRate = isSimples ? 30 : DEFAULT_ENCARGOS_PCT;
    const factor = 1 + (c.encargosPct ?? defaultRate) / 100;
    return raw.map((v) => v * factor);
  }
  return raw;
}

/** Mantido para retro-compatibilidade — agora aplica encargos. */
export function monthValues(c: CostLine, regime?: TaxRegime): number[] {
  return effectiveMonthValues(c, regime);
}

// =====================================================================
// Fator R automático: Anexo V vira III se folha/RBT12 ≥ 28%
// =====================================================================
const LABOR_KEYWORDS = /sal[áa]rio|folha|prolabore|pró-labore|mod|mão de obra|m\.o\.|clt/i;

function folhaAnual(state: AppState): number {
  const laborCosts = state.costs
    .filter((c) => c.category !== "financeiro" && (c.encargosAuto || LABOR_KEYWORDS.test(c.label)));
  return laborCosts.reduce((acc, c) => acc + sum(effectiveMonthValues(c, state.tax.regime)), 0);
}

/** Limite anual de receita bruta para permanência no Simples Nacional (LC 123/06).
 *  @deprecated Use getSimplesLimite(tax) de taxDefaults.ts. */
export const LIMITE_SIMPLES = 4_800_000;

export function resolveSimplesAnexo(state: AppState): SimplesAnexo {
  const anexo = state.tax.simplesAnexo;
  if (!state.tax.fatorRAuto || anexo !== "V") return anexo;
  const rbt12 = sum(state.revenue.bruta);
  if (rbt12 <= 0 || rbt12 > getSimplesLimite(state.tax)) return anexo;
  const fatorR = folhaAnual(state) / rbt12;
  const minPct = getFatorRMinimoPct(state.tax);
  return fatorR >= (minPct / 100) ? "III" : "V";
}

/** Retorna true se RBT12 ultrapassa o limite do Simples Nacional (desenquadramento obrigatório). */
export function simplesExcedeLimite(state: AppState): boolean {
  return sum(state.revenue.bruta) > getSimplesLimite(state.tax);
}

// =====================================================================
// IMPOSTOS
// =====================================================================
export interface MonthlyTax {
  /** Total mensal (vendas + lucro). Retro-compat. */
  monthly: number[];
  /** Impostos sobre venda — PIS/COFINS/ICMS/ISS/CBS/IBS (+ DAS no Simples). Deduzidos antes da Receita Líquida. */
  monthlyVendas: number[];
  /** Impostos sobre lucro — IRPJ + Adicional + CSLL. Deduzidos do LAIR. */
  monthlyLucro: number[];
  annual: number;
  annualVendas: number;
  annualLucro: number;
  effective: number;
  detail: Record<string, number>;
}

/** Adicional IRPJ trimestral: % sobre lucro trimestral acima do gatilho (R$20k × 3 meses por padrão). */
function adicionalIrpjTrimestral(baseMensal: number[], tax: TaxConfig): number[] {
  const out = zeros12();
  const aliq = getIrpjAdicionalPct(tax) / 100;
  const gatilho = getIrpjAdicionalGatilhoTri(tax);
  for (let t = 0; t < 4; t++) {
    const m0 = t * 3;
    const baseTri = Math.max(0, (baseMensal[m0] || 0) + (baseMensal[m0 + 1] || 0) + (baseMensal[m0 + 2] || 0));
    const excedente = Math.max(0, baseTri - gatilho);
    const adic = excedente * aliq;
    const totalBase = baseTri > 0 ? baseTri : 1;
    for (let k = 0; k < 3; k++) {
      const i = m0 + k;
      out[i] = adic * ((baseMensal[i] || 0) / totalBase);
    }
  }
  return out;
}

export function calcSimples(state: AppState): MonthlyTax {
  const { revenue, tax } = state;
  const trib = receitaTributavel(state);
  const anexo = resolveSimplesAnexo(state);
  const rbAnual = sum(trib);
  const aliq = simplesAliquotaEfetiva(rbAnual, anexo, tax) / 100;
  const monthly = trib.map((r) => r * aliq);
  const annual = sum(monthly);
  const rbBrutaAnual = sum(revenue.bruta);
  const limite = getSimplesLimite(tax);
  const excedeu = rbBrutaAnual > limite;
  const detail: Record<string, number> = { [`DAS Simples (Anexo ${anexo})`]: annual };
  if (excedeu) {
    const limMi = (limite / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    detail[`⚠ Excedeu limite Simples (R$ ${limMi}M) — desenquadramento obrigatório`] = 0;
  }
  return {
    monthly,
    monthlyVendas: monthly.slice(),
    monthlyLucro: zeros12(),
    annual,
    annualVendas: annual,
    annualLucro: 0,
    effective: rbBrutaAnual > 0 ? (annual / rbBrutaAnual) * 100 : 0,
    detail,
  };
}

export function calcPresumido(state: AppState): MonthlyTax {
  const { revenue, tax, businessType } = state;
  const trib = receitaTributavel(state);
  const bases = getPresumidoBases(tax, businessType);
  const baseIRPJ = (tax.presumidoBaseIRPJ || bases.irpj) / 100;
  const baseCSLL = (tax.presumidoBaseCSLL || bases.csll) / 100;
  const iss = tax.issIcms / 100;
  const issDed = (tax.issDeducoes ?? 0) / 12;
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;
  const reforma = getReformaRates(tax.era, tax);
  const usaReforma = reforma.cbsPct > 0 || reforma.ibsPct > 0 || reforma.pisCofinsMult < 1 || reforma.icmsIssMult < 1;
  const irpjAliq = getIrpjPct(tax) / 100;
  const csllAliq = getCsllPct(tax) / 100;
  const pisAliq = getPisCumPct(tax) / 100;
  const cofinsAliq = getCofinsCumPct(tax) / 100;

  // CPV mensal — base de crédito (ICMS antigo e também CBS/IBS amplo na reforma).
  // EXCLUI linhas marcadas semCredito (ICMS-ST etc.). Pós-2033 ICMS-ST deixa de existir,
  // mas o flag continua sinalizando "tributo embutido no preço, sem crédito" — respeitamos.
  const cpvMonthly = zeros12();
  const temCpvCredito = icmsCredAliq > 0 || usaReforma;
  if (temCpvCredito) {
    for (const c of state.costs) {
      if (c.category !== "custo_vendas") continue;
      if (c.semCredito) continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }

  const baseIRPJMensal = trib.map((r) => r * baseIRPJ);
  const baseCSLLMensal = trib.map((r) => r * baseCSLL);
  const adicionalMensal = adicionalIrpjTrimestral(baseIRPJMensal, tax);

  let irpjTotal = 0, csllTotal = 0, pisTotal = 0, cofinsTotal = 0, issTotal = 0, cbsTotal = 0, ibsTotal = 0;
  let saldoCredorICMS = 0, saldoCBS = 0, saldoIBS = 0;
  const monthlyVendas = zeros12();
  const monthlyLucro = zeros12();
  const monthly = trib.map((r, i) => {
    const irpj = baseIRPJMensal[i] * irpjAliq;
    const adicional = adicionalMensal[i];
    const csll = baseCSLLMensal[i] * csllAliq;
    const pis = r * pisAliq * reforma.pisCofinsMult;
    const cofins = r * cofinsAliq * reforma.pisCofinsMult;
    const issBase = Math.max(0, r - issDed);
    const debito = issBase * iss;
    const creditoMes = cpvMonthly[i] * icmsCredAliq + saldoCredorICMS;
    const issvBruto = Math.max(0, debito - creditoMes);
    const issv = issvBruto * reforma.icmsIssMult;
    saldoCredorICMS = Math.max(0, creditoMes - debito);
    let cbs = 0, ibs = 0;
    if (reforma.cbsPct > 0) {
      const dCbs = r * (reforma.cbsPct / 100);
      const cCbs = cpvMonthly[i] * (reforma.cbsPct / 100) + saldoCBS;
      cbs = Math.max(0, dCbs - cCbs);
      saldoCBS = Math.max(0, cCbs - dCbs);
    }
    if (reforma.ibsPct > 0) {
      const dIbs = r * (reforma.ibsPct / 100);
      const cIbs = cpvMonthly[i] * (reforma.ibsPct / 100) + saldoIBS;
      ibs = Math.max(0, dIbs - cIbs);
      saldoIBS = Math.max(0, cIbs - dIbs);
    }
    irpjTotal += irpj + adicional;
    csllTotal += csll;
    pisTotal += pis;
    cofinsTotal += cofins;
    issTotal += issv;
    cbsTotal += cbs;
    ibsTotal += ibs;
    const vendas = pis + cofins + issv + cbs + ibs;
    const lucro = irpj + adicional + csll;
    monthlyVendas[i] = vendas;
    monthlyLucro[i] = lucro;
    return vendas + lucro;
  });
  const annual = sum(monthly);
  const annualVendas = sum(monthlyVendas);
  const annualLucro = sum(monthlyLucro);
  const rbAnual = sum(revenue.bruta);
  const detail: Record<string, number> = {
    "IRPJ": irpjTotal - sum(adicionalMensal),
    "Adicional IRPJ (10%)": sum(adicionalMensal),
    CSLL: csllTotal,
  };
  if (reforma.pisCofinsMult > 0) {
    detail.PIS = pisTotal;
    detail.COFINS = cofinsTotal;
  }
  if (reforma.icmsIssMult > 0) {
    detail[isMercadoria ? "ICMS (líquido)" : "ISS"] = issTotal;
  }
  if (cbsTotal > 0) detail[`CBS (${reforma.cbsPct.toFixed(2)}%)`] = cbsTotal;
  if (ibsTotal > 0) detail[`IBS (${reforma.ibsPct.toFixed(2)}%)`] = ibsTotal;
  return {
    monthly,
    monthlyVendas,
    monthlyLucro,
    annual,
    annualVendas,
    annualLucro,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail,
  };
}

export function calcReal(state: AppState, baseLairMonthly: number[]): MonthlyTax {
  const { revenue, tax, businessType } = state;
  const trib = receitaTributavel(state);
  const iss = tax.issIcms / 100;
  const issDed = (tax.issDeducoes ?? 0) / 12;
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;
  const reforma = getReformaRates(tax.era, tax);
  const usaReforma = reforma.cbsPct > 0 || reforma.ibsPct > 0 || reforma.pisCofinsMult < 1 || reforma.icmsIssMult < 1;

  const cpvMonthly = zeros12();
  const temCpvCredito = icmsCredAliq > 0 || usaReforma;
  if (temCpvCredito) {
    for (const c of state.costs) {
      if (c.category !== "custo_vendas") continue;
      if (c.semCredito) continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }

  const baseIRPJMensal = baseLairMonthly.map((l) => Math.max(0, l));
  const adicionalMensal = adicionalIrpjTrimestral(baseIRPJMensal, tax);

  // Auditoria Jun/2026: ratear créditos anuais por mês
  const pisCreditoMensal = Math.max(0, (tax.pisCreditos || 0) / 12);
  const cofinsCreditoMensal = Math.max(0, (tax.cofinsCreditos || 0) / 12);
  // Alíquotas dinâmicas
  const irpjAliq = getIrpjPct(tax) / 100;
  const csllAliq = getCsllPct(tax) / 100;
  const pisAliq = getPisNaoCumPct(tax) / 100;
  const cofinsAliq = getCofinsNaoCumPct(tax) / 100;

  let irpjTotal = 0, csllTotal = 0, pisTotal = 0, cofinsTotal = 0, issTotal = 0, cbsTotal = 0, ibsTotal = 0;
  let saldoCredorICMS = 0, saldoCBS = 0, saldoIBS = 0;
  const monthlyVendas = zeros12();
  const monthlyLucro = zeros12();
  const monthly = trib.map((r, i) => {
    const lair = baseIRPJMensal[i];
    const irpj = lair * irpjAliq;
    const adicional = adicionalMensal[i];
    const csll = lair * csllAliq;
    const pis = Math.max(0, r * pisAliq - pisCreditoMensal) * reforma.pisCofinsMult;
    const cofins = Math.max(0, r * cofinsAliq - cofinsCreditoMensal) * reforma.pisCofinsMult;
    const issBase = Math.max(0, r - issDed);
    const debito = issBase * iss;
    const creditoMes = cpvMonthly[i] * icmsCredAliq + saldoCredorICMS;
    const issvBruto = Math.max(0, debito - creditoMes);
    const issv = issvBruto * reforma.icmsIssMult;
    saldoCredorICMS = Math.max(0, creditoMes - debito);
    let cbs = 0, ibs = 0;
    if (reforma.cbsPct > 0) {
      const dCbs = r * (reforma.cbsPct / 100);
      const cCbs = cpvMonthly[i] * (reforma.cbsPct / 100) + saldoCBS;
      cbs = Math.max(0, dCbs - cCbs);
      saldoCBS = Math.max(0, cCbs - dCbs);
    }
    if (reforma.ibsPct > 0) {
      const dIbs = r * (reforma.ibsPct / 100);
      const cIbs = cpvMonthly[i] * (reforma.ibsPct / 100) + saldoIBS;
      ibs = Math.max(0, dIbs - cIbs);
      saldoIBS = Math.max(0, cIbs - dIbs);
    }
    irpjTotal += irpj + adicional;
    csllTotal += csll;
    pisTotal += pis;
    cofinsTotal += cofins;
    issTotal += issv;
    cbsTotal += cbs;
    ibsTotal += ibs;
    const vendas = pis + cofins + issv + cbs + ibs;
    const lucro = irpj + adicional + csll;
    monthlyVendas[i] = vendas;
    monthlyLucro[i] = lucro;
    return vendas + lucro;
  });
  const annual = sum(monthly);
  const annualVendas = sum(monthlyVendas);
  const annualLucro = sum(monthlyLucro);
  const rbAnual = sum(revenue.bruta);
  const detail: Record<string, number> = {
    "IRPJ": irpjTotal - sum(adicionalMensal),
    "Adicional IRPJ (10%)": sum(adicionalMensal),
    CSLL: csllTotal,
  };
  if (reforma.pisCofinsMult > 0) {
    detail["PIS (não-cum.)"] = pisTotal;
    detail["COFINS (não-cum.)"] = cofinsTotal;
  }
  if (reforma.icmsIssMult > 0) {
    detail[isMercadoria ? "ICMS (líquido)" : "ISS"] = issTotal;
  }
  if (cbsTotal > 0) detail[`CBS (${reforma.cbsPct.toFixed(2)}%)`] = cbsTotal;
  if (ibsTotal > 0) detail[`IBS (${reforma.ibsPct.toFixed(2)}%)`] = ibsTotal;
  return {
    monthly,
    monthlyVendas,
    monthlyLucro,
    annual,
    annualVendas,
    annualLucro,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail,
  };
}

// =====================================================================
// DRE
// =====================================================================
export interface DRE {
  receitaBruta: number[];
  deducoesInadimplencia: number[]; // 0 se inadimplenciaComoPDD
  /** Outras deduções de receita (devoluções, perdas, descontos comerciais, etc.) — linhas livres definidas pelo usuário. */
  outrasDeducoes: number[];
  /** Tributos sobre venda (PIS/COFINS/ICMS/ISS/CBS/IBS, ou DAS no Simples) — deduzidos antes da Receita Líquida (CPC/IFRS 15). */
  impostosVendas: number[];
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
  /** Impostos sobre lucro (IRPJ + Adicional + CSLL). Zero no Simples. */
  impostos: number[];
  /** Total = impostosVendas + impostos (sobre lucro). Para cards de carga total. */
  impostosTotal: number[];
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

  // ---- Primeira passagem: descobrir impostos sobre venda (independem do LAIR) ----
  // Simples/Presumido: dependem só de receita; Real: PIS/COFINS/ICMS/CBS/IBS também
  // só dependem de receita+CPV, não de LAIR. Calculamos com LAIR=0 só para extrair vendas.
  let taxPre: MonthlyTax;
  if (regime === "simples") taxPre = calcSimples(state);
  else if (regime === "presumido") taxPre = calcPresumido(state);
  else taxPre = calcReal(state, zeros12());
  const impostosVendas = taxPre.monthlyVendas.slice();

  const outrasDeducoes = outrasDeducoesMensal(state);

  // Receita Líquida = Bruta − Inadimplência (se não-PDD) − Outras Deduções − Impostos sobre Venda (CPC/IFRS 15)
  const receitaLiquida = receitaBruta.map((r, i) => r - deducoesInadimplencia[i] - outrasDeducoes[i] - impostosVendas[i]);

  const cpv = zeros12();
  const despOp = zeros12();
  const custosFixos = zeros12();
  const custosVariaveis = zeros12();
  const despesasPorCategoria: Record<string, number[]> = {};

  for (const c of costs) {
    if (c.category === "financeiro") continue;
    const v = effectiveMonthValues(c, regime);
    despesasPorCategoria[c.label] = v;
    for (let i = 0; i < 12; i++) {
      if (c.category === "custo_vendas" || c.category === "direto_venda") { cpv[i] += v[i]; custosVariaveis[i] += v[i]; }
      else if (c.category === "variavel") { despOp[i] += v[i]; custosVariaveis[i] += v[i]; }
      else { despOp[i] += v[i]; custosFixos[i] += v[i]; }
    }
  }

  if (usaPDD) {
    const revArray = revenue.pddReversaoMensal || zeros12();
    for (let i = 0; i < 12; i++) {
      const pddLiq = Math.max(0, pdd[i] - (revArray[i] || 0));
      pdd[i] = pddLiq;
      despOp[i] += pddLiq;
      custosFixos[i] += pddLiq;
    }
    despesasPorCategoria["PDD — Perdas por inadimplência (líq. recup.)"] = pdd.slice();
  }

  const custosFinanceirosTotal = zeros12();
  for (const c of costs.filter((x) => x.category === "financeiro")) {
    const v = effectiveMonthValues(c, regime);
    for (let i = 0; i < 12; i++) custosFinanceirosTotal[i] += v[i];
  }

  const lucroBruto = receitaLiquida.map((r, i) => r - cpv[i]);
  const ebitda = lucroBruto.map((g, i) => g - despOp[i]);

  const depreciacao = fill12(capital.depreciacaoMensal);
  for (const c of costs) {
    if (!c.ativacao || c.ativacao.vidaUtilMeses <= 0 || c.ativacao.valor <= 0) continue;
    const startIdx = Math.max(0, Math.min(11, (c.ativacao.mes || 1) - 1));
    const depAdd = c.ativacao.valor / c.ativacao.vidaUtilMeses;
    for (let i = startIdx; i < 12; i++) depreciacao[i] += depAdd;
  }
  for (const ca of capital.capexAtivacao ?? []) {
    if (!ca || ca.vidaUtilMeses <= 0 || ca.valor <= 0) continue;
    const startIdx = Math.max(0, Math.min(11, (ca.mes || 1) - 1));
    const depAdd = ca.valor / ca.vidaUtilMeses;
    for (let i = startIdx; i < 12; i++) depreciacao[i] += depAdd;
  }
  const ebit = ebitda.map((e, i) => e - depreciacao[i]);
  // Receitas Financeiras vêm da aba Receitas (revenue.receitasFinanceiras) — soma por mês
  const receitasFinanceirasMensal = zeros12();
  for (const rf of state.revenue.receitasFinanceiras ?? []) {
    const vals = rf.valores ?? [];
    for (let i = 0; i < 12; i++) receitasFinanceirasMensal[i] += Number(vals[i]) || 0;
  }
  const resultadoFinanceiro = ebit.map((_, i) => receitasFinanceirasMensal[i] - custosFinanceirosTotal[i]);
  const lair = ebit.map((e, i) => e + resultadoFinanceiro[i]);

  // ---- Segunda passagem: impostos sobre LUCRO usando o LAIR já líquido de impostos sobre venda ----
  let tax: MonthlyTax;
  if (regime === "simples") tax = taxPre;                  // sem IRPJ/CSLL separados
  else if (regime === "presumido") tax = taxPre;           // IRPJ/CSLL com base presumida sobre receita (não muda)
  else tax = calcReal(state, lair);                        // recalcula com LAIR correto

  const impostosLucro = tax.monthlyLucro;
  const impostosTotal = impostosVendas.map((v, i) => v + impostosLucro[i]);
  const lucroLiquido = lair.map((l, i) => l - impostosLucro[i]);
  const custosOperacionaisTotal = cpv.map((c, i) => c + despOp[i]);

  return {
    dre: {
      receitaBruta, deducoesInadimplencia, outrasDeducoes, impostosVendas, pdd, receitaLiquida,
      cpv, lucroBruto, despesasOperacionais: despOp,
      ebitda, depreciacao, ebit, resultadoFinanceiro, lair,
      impostos: impostosLucro, impostosTotal, lucroLiquido,
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
  /** Lucro Bruto ÷ Receita Líquida × 100 */
  margemBruta: number;
  /** EBITDA ÷ Receita Líquida × 100 */
  margemEbitda: number;
  /** EBIT ÷ Receita Líquida × 100 */
  margemEbit: number;
  /** Lucro Líquido ÷ Receita Líquida × 100 */
  margemLiquida: number;
  /** (Receita Líquida − Custos Variáveis) ÷ Receita Líquida × 100 */
  margemContribuicao: number;
  /** Custos Fixos ÷ Margem de Contribuição */
  pontoEquilibrio: number;
  /** (Custos Fixos − Depreciação) ÷ Margem de Contribuição */
  pontoEquilibrioFinanceiro: number;
  /** Lucro Líquido ÷ Patrimônio Líquido × 100 */
  roe: number;
  /** Lucro Líquido ÷ Ativo Total × 100 */
  roa: number;
  /** NOPAT ÷ Capital Investido × 100 */
  roic: number;
  /** (Capital Próprio/V × Ke) + (Dívida/V × Kd × (1 − IR Shield)) */
  wacc: number;
  /** PMR + PME − PMP */
  cicloFinanceiro: number;
  /** Contas a Receber + Estoques − Fornecedores */
  ncg: number;
  /** NCG − Capital de Giro Disponível */
  gapCapitalGiro: number;
  /** Ativo Circulante ÷ Passivo Circulante */
  liquidezCorrente: number;
  /** (Ativo Circulante − Estoques) ÷ Passivo Circulante */
  liquidezSeca: number;
  /** Disponibilidades ÷ Passivo Circulante */
  liquidezImediata: number;
  /** Passivo Total ÷ Ativo Total × 100 */
  endividamentoGeral: number;
  /** Dívida Onerosa ÷ Patrimônio Líquido × 100 */
  grauEndividamento: number;
  /** EBIT ÷ Despesas Financeiras */
  coberturaJuros: number;
  /** Receita Líquida ÷ Ativo Total */
  giroAtivo: number;
  /** (Dívida Total − Caixa) ÷ EBITDA */
  dividaLiqEbitda: number;
  /** (Dívida Total − Caixa) ÷ EBIT */
  dividaLiqEbit: number;
  /** (Dívida Total − Caixa) ÷ Patrimônio Líquido */
  dividaLiqPl: number;
  /** Patrimônio Líquido ÷ Lucro Líquido Anual */
  payback: number;
  /** EBITDA − Impostos − Δ NCG */
  fcf: number;
  /** FCF ÷ EBITDA × 100 */
  conversaoEbitdaCaixa: number;
  dividaOnerosa: number;
  passivoCirculante: number;
  ativoCirculante: number;
}

/**
 * Shield fiscal correto por regime (Auditoria Jun/2026).
 * Juros sobre empréstimos só são DEDUTÍVEIS da base do IRPJ/CSLL no Lucro Real.
 * Em Presumido a base é presumida sobre receita — juros não abatem.
 * Em Simples (DAS) também não há dedução.
 */
export function irShieldForRegime(regime: TaxRegime): number {
  if (regime === "real") return 0.34; // IRPJ 15% + Adic 10% + CSLL 9%
  return 0;                            // presumido / simples
}

export function calcIndicators(state: AppState, dre: DRE): Indicators {
  const { capital, revenue } = state;
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const receitaBrutaAnual = sum(dre.receitaBruta);
  const lucroBrutoAnual = sum(dre.lucroBruto);
  const ebitdaAnual = sum(dre.ebitda);
  const ebitAnual = sum(dre.ebit);
  const lairAnual = sum(dre.lair);
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

  // ---- NOPAT e ROIC corretos (Auditoria) ----
  // NOPAT = EBIT − impostos operacionais. Quando lair anual <= 0, usamos fallback EBIT × (1 − shield).
  const tcEfetiva = lairAnual > 0 ? Math.min(0.5, impostosAnual / lairAnual) : irShield;
  const nopat = lairAnual > 0
    ? Math.max(0, ebitAnual - ebitAnual * tcEfetiva)
    : Math.max(0, ebitAnual * (1 - irShield));

  // Capital Investido (Auditoria): (Ativo Total − Caixa Ocioso) − Passivos não-onerosos.
  // Se Ativo Total omitido, reconstrói via PL + D + PNO.
  const pno = Math.max(0, capital.passivosNaoOnerosos ?? capital.fornecedores ?? 0);
  const caixaOcioso = Math.max(0, capital.caixaOcioso ?? 0);
  const ciBase = capital.ativoTotal > 0 ? capital.ativoTotal : (PL + D + pno);
  const capitalInvestido = Math.max(1, ciBase - caixaOcioso - pno);
  const roic = capitalInvestido > 0 ? (nopat / capitalInvestido) * 100 : 0;
  const roe = PL > 0 ? (llAnual / PL) * 100 : 0;
  const roa = capital.ativoTotal > 0 ? (llAnual / capital.ativoTotal) * 100 : 0;

  // ---- Ciclo / NCG / Gap ----
  // PME = Estoque MÉDIO ÷ CPV diário (Auditoria). Usa (inicial+final)/2 quando ambos informados.
  const ei = Math.max(0, capital.estoqueInicial ?? 0);
  const ef = Math.max(0, capital.estoqueFinal ?? 0);
  const estoqueMedio = ei > 0 && ef > 0
    ? (ei + ef) / 2
    : (ef > 0 ? ef : capital.estoques);
  const cpvDiario = sum(dre.cpv) / 360;
  const pme = estoqueMedio > 0 && cpvDiario > 0 ? estoqueMedio / cpvDiario : 0;
  const cicloFinanceiro = revenue.pmr + pme - revenue.pmp;
  // NCG: usa CR + Estoque − Fornecedores; fallback estimado se zerado
  const crEstimado = capital.contasReceber > 0 ? capital.contasReceber : (receitaBrutaAnual / 360) * revenue.pmr;
  const fornecEstimado = capital.fornecedores > 0
    ? capital.fornecedores
    : (sum(dre.cpv) / 360) * revenue.pmp;
  const ncg = crEstimado + estoqueMedio - fornecEstimado;
  const gapCapitalGiro = ncg - capital.capitalGiroDisponivel;

  // ---- Liquidez com AC/PC reais ----
  const ativoCirculante = capital.ativoCirculante > 0
    ? capital.ativoCirculante
    : capital.disponibilidades + crEstimado + capital.estoques;
  const passivoCirculante = capital.passivoCirculante > 0
    ? capital.passivoCirculante
    : Math.max(0, fornecEstimado + D * 0.3); // estimativa: 30% da dívida vence em CP

  // Caps neutros (Auditoria — evita Infinity propagando para outras métricas).
  const CAP_LIQ = 99;
  const liquidezCorrente = passivoCirculante > 1 ? Math.min(CAP_LIQ, ativoCirculante / passivoCirculante) : CAP_LIQ;
  const liquidezSeca = passivoCirculante > 1 ? Math.min(CAP_LIQ, (ativoCirculante - estoqueMedio) / passivoCirculante) : CAP_LIQ;
  const liquidezImediata = passivoCirculante > 1 ? Math.min(CAP_LIQ, capital.disponibilidades / passivoCirculante) : CAP_LIQ;

  // ---- Endividamento (apenas dívida onerosa para alavancagem) ----
  const passivoTotalEstim = capital.ativoTotal - PL;
  const endividamentoGeral = capital.ativoTotal > 0 ? (passivoTotalEstim / capital.ativoTotal) * 100 : 0;
  const grauEndividamento = PL > 0 ? (D / PL) * 100 : 0;
  // Caps neutros para evitar Infinity/NaN propagando em métricas compostas.
  const CAP_COB = 999;       // cobertura de juros máx exibível
  const CAP_DL_EBITDA = 99;  // dívida líq / EBITDA máx
  const CAP_PAYBACK = 99;    // payback em anos máx
  const coberturaJuros = jurosAnual > 1 ? Math.min(CAP_COB, ebitAnual / jurosAnual) : CAP_COB;
  const giroAtivo = capital.ativoTotal > 0 ? receitaLiqAnual / capital.ativoTotal : 0;
  const dividaLiq = D - capital.disponibilidades;
  const dividaLiqEbitda = ebitdaAnual > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitdaAnual))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const dividaLiqEbit = ebitAnual > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitAnual))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const dividaLiqPl = PL > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / PL))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const payback = llAnual > 1 ? Math.min(CAP_PAYBACK, PL / llAnual) : (PL <= 0 ? 0 : CAP_PAYBACK);
  // FCF simplificado: EBITDA − Impostos − ΔNCG (Auditoria).
  // ΔNCG estimado como a diferença entre a NCG atual e o capital de giro disponível.
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
    conversaoEbitdaCaixa: ebitdaAnual > 0 ? (fcf / ebitdaAnual) * 100 : 0,
    dividaOnerosa: D, passivoCirculante, ativoCirculante,
  };
}

// =====================================================================
// DIAGNÓSTICO (mantido)
// =====================================================================
export interface Diagnostic { level: "ok" | "warn" | "danger"; title: string; message: string; }

export function diagnose(state: AppState, dre: DRE, ind: Indicators): Diagnostic[] {
  const out: Diagnostic[] = [];
  const fmtR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  
  const receitaBrutaAnual = sum(state.revenue.bruta);
  const receitaLiqAnual = sum(dre.receitaLiquida);
  const folha = dre.folhaCltAnual;
  const folhaPct = receitaLiqAnual > 0 ? (folha / receitaLiqAnual) * 100 : 0;
  const llAnual = sum(dre.lucroLiquido);
  const ebitdaAnual = sum(dre.ebitda);
  const fcfAnual = ind.fcf;

  // #0 Conversão de Lucro em Caixa (Auditoria CFO)
  if (llAnual > 1000) {
    const conversao = (fcfAnual / llAnual) * 100;
    if (conversao < 30 && conversao >= 0) {
      out.push({ level: "warn", title: "Baixa conversão de lucro em caixa", message: `Apenas ${conversao.toFixed(1)}% do lucro líquido vira caixa livre. O restante está ficando imobilizado em capital de giro ou pagando dívidas.` });
    } else if (conversao < 0) {
      out.push({ level: "danger", title: "Lucro que não vira caixa", message: `Empresa é lucrativa (${fmtR(llAnual)}), mas queima caixa livre (${fmtR(fcfAnual)}). Risco de crise de liquidez por excesso de NCG ou serviço de dívida.` });
    }
  }

  // #0.1 Divergência EBITDA x Caixa (Alerta imediato CFO)
  if (ebitdaAnual > 0 && fcfAnual < 0) {
    out.push({
      level: "danger",
      title: "Divergência: EBITDA (+) vs Caixa (−)",
      message: "Alerta CFO: A operação gera resultado operacional positivo, mas o caixa está caindo. Verifique se o crescimento está sendo financiado por excesso de prazo aos clientes ou estoques altos (NCG)."
    });
  }

  // ===== Edge cases (Auditoria) =====
  // #1 Empresa 100% (ou quase) inadimplente
  const inadMedia = state.revenue.inadimplencia.reduce((a, b) => a + b, 0) / 12;
  if (inadMedia >= 95) {
    out.push({ level: "danger", title: "Inadimplência crítica (~100%)", message: `Inadimplência média de ${inadMedia.toFixed(1)}% — receita líquida praticamente nula. Modelo de cobrança inviável; revise o crédito a clientes.` });
  } else if (inadMedia >= 30) {
    out.push({ level: "warn", title: "Inadimplência elevada", message: `Inadimplência média de ${inadMedia.toFixed(1)}% compromete o EBITDA e o caixa.` });
  }

  // #2 Custos negativos (erro de digitação ou reversão indevida)
  const linhasNegativas = state.costs.filter(c => c.values.some(v => v < 0));
  if (linhasNegativas.length > 0) {
    out.push({ level: "warn", title: "Linhas de custo com valores negativos", message: `${linhasNegativas.length} rubrica(s) com valor negativo (ex.: "${linhasNegativas[0].label}"). Margem bruta pode estar inflada artificialmente — use linhas dedicadas para recuperações/créditos.` });
  }

  // #3 Receita zero (bruta) com custos fixos → empresa não viável no horizonte
  const custosFixosAnual = sum(dre.custosFixos);
  if (receitaBrutaAnual <= 0 && custosFixosAnual > 0) {
    out.push({ level: "danger", title: "Operação inviável: receita zero com custos fixos", message: `Sem receita projetada e ${fmtR(custosFixosAnual)} de custos fixos no ano. EBITDA projetado = ${fmtR(ebitdaAnual)}. Ponto de equilíbrio indefinido — preencha a aba Receita.` });
  } else if (receitaBrutaAnual > 0 && receitaLiqAnual <= 0) {
    // Edge: receita bruta existe mas líquida zerou (inadimplência ~100%, deduções/impostos consumindo tudo)
    out.push({
      level: "danger",
      title: "Receita líquida zerada",
      message: `Receita bruta de ${fmtR(receitaBrutaAnual)} foi totalmente consumida por deduções/inadimplência/impostos. Receita líquida = ${fmtR(receitaLiqAnual)}, EBITDA = ${fmtR(ebitdaAnual)}. Indicadores percentuais (margens, folha %, ROIC) ficam indefinidos — revise inadimplência e regime tributário.`,
    });
  }

  if (folhaPct > 35) out.push({ level: "danger", title: "Custo de mão de obra elevado", message: `Folha (com encargos) ${folhaPct.toFixed(1)}% da receita líquida (${fmtR(folha)} de ${fmtR(receitaLiqAnual)}).` });
  else if (folhaPct > 25) out.push({ level: "warn", title: "Folha em zona de atenção", message: `Folha em ${folhaPct.toFixed(1)}% da receita líquida (${fmtR(folha)}).` });

  const fixoPct = receitaLiqAnual > 0 ? (sum(dre.custosFixos) / receitaLiqAnual) * 100 : 0;
  if (receitaLiqAnual > 0 && fixoPct > 50) out.push({ level: "danger", title: "Custos fixos altos demais", message: `Custos fixos somam ${fixoPct.toFixed(1)}% da receita líquida (${fmtR(custosFixosAnual)}).` });

  if (receitaLiqAnual > 0 && ind.margemBruta < 25) out.push({ level: "danger", title: "Margem bruta baixa", message: `Margem bruta de ${ind.margemBruta.toFixed(1)}% — EBITDA ${fmtR(ebitdaAnual)} (margem EBITDA ${ind.margemEbitda.toFixed(1)}%).` });
  if (receitaLiqAnual > 0 && ind.margemLiquida < 5) out.push({ level: ind.margemLiquida < 0 ? "danger" : "warn", title: "Margem líquida insuficiente", message: `Margem líquida em ${ind.margemLiquida.toFixed(1)}% (EBITDA ${ind.margemEbitda.toFixed(1)}%).` });

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

/** Projeção da carga efetiva (%) por era para um dado regime, mantendo o resto do estado fixo. */
export function compareErasForRegime(state: AppState, regime: TaxRegime): { era: TaxEra; effective: number; annual: number }[] {
  const eras: TaxEra[] = ["atual", "transicao", "pleno"];
  return eras.map((era) => {
    const s: AppState = { ...state, tax: { ...state.tax, era } };
    let tax: MonthlyTax;
    if (regime === "simples") tax = calcSimples(s);
    else if (regime === "presumido") tax = calcPresumido(s);
    else {
      const baseLair = buildDRE(s, "real").dre.lair;
      tax = calcReal(s, baseLair);
    }
    return { era, effective: tax.effective, annual: tax.annual };
  });
}
