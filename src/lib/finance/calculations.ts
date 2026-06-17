import { AppState, SimplesAnexo, TaxRegime, BusinessType, CostLine, DEFAULT_ENCARGOS_PCT, TaxEra, TaxConfig } from "./types";
import {
  getIrpjPct, getIrpjAdicionalPct, getIrpjAdicionalGatilhoTri, getCsllPct,
  getPisCumPct, getCofinsCumPct, getPisNaoCumPct, getCofinsNaoCumPct,
  getSimplesLimite, getFatorRMinimoPct,
  getSimplesTable, getPresumidoBases,
  getReformaTransicaoIbsMult, getReformaTransicaoIcmsIssMult,
  DEFAULT_ENCARGOS_PCT_SIMPLES,
} from "./taxDefaults";
import { sum, zeros12, fill12 } from "./format";
import { safeDivide, safePct, safeNumber } from "./safeMath";

/**
 * SSOT-1 — Dívida Líquida canônica usada por Valuation e Indicadores.
 * Prefere caixa ocioso (excedente não-operacional). Fallback para
 * disponibilidades totais para compatibilidade com balanços antigos.
 * Retorna valor RAW (pode ser negativo quando caixa > dívida).
 */
export function computeNetDebt(state: AppState): number {
  const D = Math.max(0, state.capital.dividaOnerosa ?? 0);
  const cash = Math.max(
    0,
    state.capital.caixaOcioso ?? state.capital.disponibilidades ?? 0,
  );
  return D - cash;
}

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

// ---------------------------------------------------------------------
// Cronograma ano-a-ano da Reforma — LC 214/2025 + EC 132/2023
// ---------------------------------------------------------------------
/** Fração do IBS pleno cobrada no ano (0..1). Cronograma oficial:
 *  - 2026–2028: 0,1% absoluto (fase de teste) → fração ≈ 0,1/ibsPleno.
 *  - 2029=10%, 2030=20%, 2031=30%, 2032=40%, 2033+=100%. */
export function getIbsFractionForYear(year: number, ibsFull: number): number {
  if (year < 2026) return 0;
  if (year <= 2028) return ibsFull > 0 ? 0.1 / ibsFull : 0;
  if (year === 2029) return 0.10;
  if (year === 2030) return 0.20;
  if (year === 2031) return 0.30;
  if (year === 2032) return 0.40;
  return 1;
}

/** Fração de ICMS/ISS antigos ainda cobrada no ano:
 *  2026–2028=100%; 2029=90%; 2030=80%; 2031=70%; 2032=60%; 2033+=0%. */
export function getIcmsIssFractionForYear(year: number): number {
  if (year < 2026) return 1;
  if (year <= 2028) return 1;
  if (year === 2029) return 0.90;
  if (year === 2030) return 0.80;
  if (year === 2031) return 0.70;
  if (year === 2032) return 0.60;
  return 0;
}

/** Fração de PIS/COFINS antigos: 2026=100% (CBS 0,9% compensável); 2027+=0%. */
export function getPisCofinsFractionForYear(year: number): number {
  if (year < 2026) return 1;
  if (year === 2026) return 1;
  return 0;
}

/** CBS absoluta (%) no ano: 2026=0,9% (teste); 2027+ = alíquota plena configurada. */
export function getCbsPctForYear(year: number, cbsFull: number): number {
  if (year < 2026) return 0;
  if (year === 2026) return 0.9;
  return cbsFull;
}

/** Versão ano-a-ano de `getReformaRates`, honrando o cronograma da LC 214/2025.
 *  Use para simulações longitudinais 2026–2033 em vez do agrupamento triplo. */
export function getReformaRatesForYear(year: number, cfg: TaxConfig): ReformaRates {
  const cbsFull = cfg.cbsAliquota ?? 8.8;
  const ibsFull = cfg.ibsAliquotaRef ?? 17.7;
  if (year < 2026) return { cbsPct: 0, ibsPct: 0, pisCofinsMult: 1, icmsIssMult: 1 };
  return {
    cbsPct: getCbsPctForYear(year, cbsFull),
    ibsPct: ibsFull * getIbsFractionForYear(year, ibsFull),
    pisCofinsMult: getPisCofinsFractionForYear(year),
    icmsIssMult: getIcmsIssFractionForYear(year),
  };
}

/** Mapeia o ano para a `TaxEra` discreta correspondente — usado para reaproveitar
 *  o engine atual sem reescrever buildDRE/calcReal. */
export function eraForYear(year: number): TaxEra {
  if (year < 2026) return "atual";
  if (year >= 2033) return "pleno";
  return "transicao";
}

/** Projeção da carga efetiva ano-a-ano para um regime, aplicando o cronograma
 *  oficial. Reaproveita o engine existente sobrescrevendo os multiplicadores de
 *  transição via `ratesOverride`. Para 2026 força CBS=0,9% (teste). */
export function compareYearsForRegime(
  state: AppState,
  regime: TaxRegime,
  years: number[],
): { year: number; era: TaxEra; effective: number; annual: number; rates: ReformaRates }[] {
  const ibsFull = state.tax.ibsAliquotaRef ?? 17.7;
  return years.map((year) => {
    const rates = getReformaRatesForYear(year, state.tax);
    const ibsFrac = ibsFull > 0 ? rates.ibsPct / ibsFull : 0;
    const era = eraForYear(year);
    const s: AppState = {
      ...state,
      tax: {
        ...state.tax,
        era,
        cbsAliquota: era === "transicao" && year === 2026 ? 0.9 : (state.tax.cbsAliquota ?? 8.8),
        ratesOverride: {
          ...(state.tax.ratesOverride ?? {}),
          reformaTransicaoIbsMult: ibsFrac,
          reformaTransicaoIcmsIssMult: rates.icmsIssMult,
        },
      },
    };
    let tax: MonthlyTax;
    if (regime === "simples") tax = calcSimples(s);
    else if (regime === "presumido") tax = calcPresumido(s);
    else {
      const baseLair = buildDRE(s, "real").dre.lair;
      tax = calcReal(s, baseLair);
    }
    return { year, era, effective: tax.effective, annual: tax.annual, rates };
  });
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
/** Classificação canônica: linhas que compõem o CPV/CMV/CSP (geram crédito tributário
 *  e escalam com receita no forecast). Usado em buildDRE, calcReal e forecast. */
export function isCpvCost(c: CostLine): boolean {
  return c.category === "custo_vendas" || c.category === "direto_venda";
}

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
    // SSOT-12: encargos reduzidos no Simples (CPP já no DAS).
    const isSimples = regime === "simples";
    const defaultRate = isSimples ? DEFAULT_ENCARGOS_PCT_SIMPLES : DEFAULT_ENCARGOS_PCT;
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

export function folhaAnual(state: AppState): number {
  // SSOT: regime EFETIVO. Encargos do Simples são reduzidos automaticamente
  // dentro de effectiveMonthValues quando aplicável.
  const regime = resolveEffectiveRegime(state);
  const laborCosts = state.costs
    .filter((c) => c.category !== "financeiro" && (c.encargosAuto || LABOR_KEYWORDS.test(c.label)));
  return laborCosts.reduce((acc, c) => acc + sum(effectiveMonthValues(c, regime)), 0);
}

// SSOT-10: LIMITE_SIMPLES removido — use SIMPLES_LIMITE / getSimplesLimite(tax) de taxDefaults.ts.

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

/**
 * Resolve o regime tributário EFETIVO considerando desenquadramento do Simples.
 * Se o usuário escolheu Simples mas a RBT12 estourou o limite, força Presumido.
 * Esta é a VERDADE ABSOLUTA usada por todas as abas (Indicadores, Saúde, Forecast, etc.).
 */
export function resolveEffectiveRegime(state: AppState): TaxRegime {
  if (state.tax.regime === "simples" && simplesExcedeLimite(state)) {
    return "presumido";
  }
  return state.tax.regime;
}

/**
 * CAGR (Taxa de Crescimento Anual Composta) sobre uma série mensal.
 * Usa o 1º e o último mês com valor > 0, preservando a distância real em meses
 * (evita inflar o expoente quando há meses zerados no meio da série).
 * Retorna NaN quando indeterminado.
 */
export function cagr12m(serie: number[]): number {
  if (!serie || serie.length < 2) return NaN;
  const firstIdx = serie.findIndex((v) => v > 0);
  let lastIdx = -1;
  for (let i = serie.length - 1; i >= 0; i--) {
    if (serie[i] > 0) { lastIdx = i; break; }
  }
  if (firstIdx < 0 || lastIdx <= firstIdx) return NaN;
  const periodos = lastIdx - firstIdx; // distância real (meses)
  return Math.pow(serie[lastIdx] / serie[firstIdx], 12 / periodos) - 1;
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
      if (!isCpvCost(c)) continue;
      if (c.semCredito) continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }


  // [Receitas Financeiras] No Presumido, rendimentos de aplicações entram INTEGRAIS
  // na base de IRPJ/CSLL (sem o redutor de 8/32%). Aluguéis/venda de ativos vão
  // como "operacionais" (já tratados na DRE) e não somam aqui. Rendimentos com
  // tributação EXCLUSIVA na fonte (IRRF definitivo) são excluídos da base.
  const { financeirasIrpjBase: rendFinTrib } = splitReceitasFinanceiras(state);
  const baseIRPJMensal = trib.map((r, i) => r * baseIRPJ + (rendFinTrib[i] || 0));
  const baseCSLLMensal = trib.map((r, i) => r * baseCSLL + (rendFinTrib[i] || 0));
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
      if (!isCpvCost(c)) continue;
      if (c.semCredito) continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }


  // [Receitas Financeiras] Rendimentos com tributação EXCLUSIVA na fonte (IRRF definitivo)
  // não compõem o lucro tributável: subtraímos do LAIR antes de calcular IRPJ/CSLL.
  // PIS/COFINS sobre receitas financeiras (Decreto 8.426/2015) continua incidindo sobre o
  // total — a regra de exclusão é específica de IRPJ/CSLL.
  const { financeiras: rendFin, financeirasIrpjBase: rendFinTrib } = splitReceitasFinanceiras(state);
  const rendFinExclusivo = rendFin.map((v, i) => v - (rendFinTrib[i] || 0));
  const baseIRPJMensal = baseLairMonthly.map((l, i) => Math.max(0, l - (rendFinExclusivo[i] || 0)));
  const adicionalMensal = adicionalIrpjTrimestral(baseIRPJMensal, tax);

  // Auditoria Jun/2026: ratear créditos anuais por mês
  const pisCreditoMensal = Math.max(0, (tax.pisCreditos || 0) / 12);
  const cofinsCreditoMensal = Math.max(0, (tax.cofinsCreditos || 0) / 12);
  // Alíquotas dinâmicas
  const irpjAliq = getIrpjPct(tax) / 100;
  const csllAliq = getCsllPct(tax) / 100;
  const pisAliq = getPisNaoCumPct(tax) / 100;
  const cofinsAliq = getCofinsNaoCumPct(tax) / 100;
  // PIS/COFINS sobre receitas financeiras é fixo: 0,65% + 4% (Decreto 8.426/2015).
  // Sob a reforma plena, PIS/COFINS são extintos (pisCofinsMult=0) e zera automaticamente.
  const PIS_RF = 0.0065;
  const COFINS_RF = 0.04;
  

  let irpjTotal = 0, csllTotal = 0, pisTotal = 0, cofinsTotal = 0, issTotal = 0, cbsTotal = 0, ibsTotal = 0;
  let saldoCredorICMS = 0, saldoCBS = 0, saldoIBS = 0;
  const monthlyVendas = zeros12();
  const monthlyLucro = zeros12();
  const monthly = trib.map((r, i) => {
    const lair = baseIRPJMensal[i];
    const irpj = lair * irpjAliq;
    const adicional = adicionalMensal[i];
    const csll = lair * csllAliq;
    const pisVenda = Math.max(0, r * pisAliq - pisCreditoMensal);
    const cofinsVenda = Math.max(0, r * cofinsAliq - cofinsCreditoMensal);
    const pisRF = (rendFin[i] || 0) * PIS_RF;
    const cofinsRF = (rendFin[i] || 0) * COFINS_RF;
    const pis = (pisVenda + pisRF) * reforma.pisCofinsMult;
    const cofins = (cofinsVenda + cofinsRF) * reforma.pisCofinsMult;
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
  /** Outras receitas operacionais (aluguéis recebidos, venda de ativos etc.) — somadas no EBITDA. */
  outrasReceitasOperacionais: number[];
  ebitda: number[];
  depreciacao: number[];
  ebit: number[];
  resultadoFinanceiro: number[];
  lair: number[];
  /** Impostos sobre lucro (IRPJ + Adicional + CSLL). Zero no Simples. */
  impostos: number[];
  /**
   * Base efetivamente usada para calcular `impostos` (IRPJ/CSLL).
   * - "lair": Lucro Real — base é o LAIR (Lucro Antes do IR).
   * - "receita_presumida": Presumido — base é receita × % de presunção (não o LAIR exibido).
   * - "nao_aplica": Simples Nacional — IRPJ/CSLL já estão dentro do DAS (impostosVendas).
   * Usado pela UI para sinalizar ao consultor a origem do valor deduzido do LAIR.
   */
  impostosLucroBase: "lair" | "receita_presumida" | "nao_aplica";
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

/**
 * Classifica as linhas de `revenue.receitasFinanceiras` por natureza contábil:
 * - `financeiras`: rendimento de aplicações e ids customizados → entram no Resultado Financeiro.
 * - `operacionais`: aluguéis recebidos e venda de ativos → entram acima do EBITDA.
 * - `financeirasIrpjBase`: subconjunto de `financeiras` que entra na base de IRPJ/CSLL —
 *   EXCLUI linhas marcadas com `tributacaoExclusivaFonte` (IRRF definitivo em aplicações
 *   financeiras; gross-up não compõe o lucro tributável conforme RIR/1999).
 *
 * Critério por id (default p/ retrocompat: financeira).
 */
export function splitReceitasFinanceiras(state: AppState): {
  financeiras: number[];
  operacionais: number[];
  financeirasIrpjBase: number[];
} {
  const financeiras = zeros12();
  const operacionais = zeros12();
  const financeirasIrpjBase = zeros12();
  const OPERACIONAIS_IDS = new Set(["alugueis", "venda_ativos"]);
  for (const rf of state.revenue.receitasFinanceiras ?? []) {
    const vals = rf.valores ?? [];
    const isOperacional = OPERACIONAIS_IDS.has(rf.id);
    const exclusivaFonte = !!rf.tributacaoExclusivaFonte;
    for (let i = 0; i < 12; i++) {
      const v = Number(vals[i]) || 0;
      if (isOperacional) operacionais[i] += v;
      else {
        financeiras[i] += v;
        if (!exclusivaFonte) financeirasIrpjBase[i] += v;
      }
    }
  }
  return { financeiras, operacionais, financeirasIrpjBase };
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
    const isCpv = c.category === "custo_vendas" || c.category === "direto_venda";
    const isOpVar = c.category === "variavel";
    // Comportamento (fixo/variável) para MC/PE. Default deriva da category;
    // override manual via `comportamento` cobre casos como folha CLT no CPV (variável
    // contábil, mas fixo no curto prazo — distorce MC/PE se não for sinalizado).
    const comportamento: "fixo" | "variavel" =
      c.comportamento ?? ((isCpv || isOpVar) ? "variavel" : "fixo");
    for (let i = 0; i < 12; i++) {
      if (isCpv) cpv[i] += v[i];          // CPV contábil preserva a natureza (não muda com override).
      else despOp[i] += v[i];
      if (comportamento === "variavel") custosVariaveis[i] += v[i];
      else custosFixos[i] += v[i];
    }
  }

  if (usaPDD) {
    const revArray = revenue.pddReversaoMensal || zeros12();
    for (let i = 0; i < 12; i++) {
      const pddLiq = Math.max(0, pdd[i] - (revArray[i] || 0));
      pdd[i] = pddLiq;
      despOp[i] += pddLiq;
      // PDD escala com a receita (% da inadimplência sobre a receita bruta) — é custo VARIÁVEL,
      // não fixo. Classificar como fixo superestima o Ponto de Equilíbrio e distorce a Margem
      // de Contribuição.
      custosVariaveis[i] += pddLiq;
    }
    despesasPorCategoria["PDD — Perdas por inadimplência (líq. recup.)"] = pdd.slice();
  }

  const custosFinanceirosTotal = zeros12();
  for (const c of costs.filter((x) => x.category === "financeiro")) {
    const v = effectiveMonthValues(c, regime);
    for (let i = 0; i < 12; i++) custosFinanceirosTotal[i] += v[i];
  }

  const lucroBruto = receitaLiquida.map((r, i) => r - cpv[i]);
  // Outras Receitas Operacionais (aluguéis, venda de ativos) — entram acima do EBITDA.
  const { financeiras: rendimentosFinanceiros, operacionais: outrasReceitasOperacionais } = splitReceitasFinanceiras(state);
  const ebitda = lucroBruto.map((g, i) => g - despOp[i] + outrasReceitasOperacionais[i]);

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
  // Resultado Financeiro = Rendimentos Financeiros (rend_aplic etc.) − Custos Financeiros.
  // Aluguéis e venda de ativos NÃO entram aqui (são operacionais, já no EBITDA).
  const resultadoFinanceiro = ebit.map((_, i) => rendimentosFinanceiros[i] - custosFinanceirosTotal[i]);
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

  // Base contábil dos impostos sobre lucro — informativo para a UI.
  // No Presumido a base é receita × % de presunção (não o LAIR exibido na DRE);
  // sinalizamos isso para que o consultor saiba que IRPJ/CSLL na linha abaixo do LAIR
  // não foi calculado sobre o LAIR real, evitando leitura distorcida.
  const impostosLucroBase: DRE["impostosLucroBase"] =
    regime === "simples" ? "nao_aplica" : regime === "presumido" ? "receita_presumida" : "lair";

  return {
    dre: {
      receitaBruta, deducoesInadimplencia, outrasDeducoes, impostosVendas, pdd, receitaLiquida,
      cpv, lucroBruto, despesasOperacionais: despOp,
      outrasReceitasOperacionais,
      ebitda, depreciacao, ebit, resultadoFinanceiro, lair,
      impostos: impostosLucro, impostosLucroBase, impostosTotal, lucroLiquido,
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
  /**
   * PE TOTAL (cobertura financeira completa): (Custos Fixos + Depreciação + Juros) ÷ MC.
   * Inclui juros porque, para a PME, juros são custo fixo financeiro recorrente.
   */
  pontoEquilibrio: number;
  /**
   * PE OPERACIONAL CLÁSSICO (Garrison/Horngren): Custos Fixos Operacionais (com depreciação,
   * SEM juros) ÷ MC. Juros e impostos ficam abaixo do EBIT — não pertencem ao PE contábil.
   */
  pontoEquilibrioOperacional: number;
  /**
   * PE FINANCEIRO clássico (caixa): Custos Fixos Operacionais SEM depreciação e SEM juros ÷ MC.
   * Receita mínima para cobrir os desembolsos OPERACIONAIS.
   */
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
  /** Passivo Total ÷ Ativo Total × 100. Quando `endividamentoGeralDadosCompletos=false`, é estimativa de fallback. */
  endividamentoGeral: number;
  /**
   * true quando Ativo Total foi informado pelo consultor — `endividamentoGeral` é valor real.
   * false quando faltou Ativo Total: a engine usa fallback (Dívida Onerosa + PNO) ÷ proxy de
   * Ativo (PL + D + PNO), evitando exibir "0%" silenciosamente como se fosse "sem dívida".
   */
  endividamentoGeralDadosCompletos: boolean;
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
  /**
   * Tempo (em anos) para o Lucro Líquido acumulado recuperar o Patrimônio Líquido.
   * NÃO é o payback clássico (CAPEX ÷ FCF) — é o período de amortização do PL pelo lucro
   * contábil. Mantido por compatibilidade. Para o payback clássico use `paybackCapex`.
   */
  amortizacaoPlPorLucro: number;
  /**
   * Payback clássico (anos): CAPEX inicial ÷ FCF anual. Mede tempo para o investimento
   * inicial ser recuperado pela geração de caixa. `Infinity` quando FCF ≤ 0 ou CAPEX inicial = 0.
   */
  paybackCapex: number;
  /** @deprecated Use `amortizacaoPlPorLucro` (mesma fórmula). Mantido para retrocompat. */
  payback: number;
  /** EBITDA − Impostos − Δ NCG */
  fcf: number;
  /** FCF ÷ EBITDA × 100 */
  conversaoEbitdaCaixa: number;
  /** Margem de Contribuição (R$) ÷ EBIT — elasticidade do lucro à receita. */
  gao: number;
  /** FCF ÷ Lucro Líquido — quanto do lucro contábil vira caixa. */
  qualidadeLucro: number;
  /** Receita Líquida Anual ÷ nº de colaboradores. */
  receitaPorColaborador: number;
  /** Receita BRUTA Anual ÷ nº de colaboradores — métrica clássica de benchmarking ("Faturamento/Colab"). */
  faturamentoPorColaborador: number;
  /** EBITDA Anual ÷ nº de colaboradores. */
  ebitdaPorColaborador: number;
  /** Lucro Líquido Anual ÷ nº de colaboradores. */
  lucroPorColaborador: number;
  /** Folha total anual (com encargos) ÷ Receita Líquida × 100. */
  custoPessoalSobreReceita: number;
  /** (Receita − Ponto de Equilíbrio) ÷ Receita × 100 — folga de receita antes do prejuízo. */
  margemSeguranca: number;
  /** EBITDA ÷ (Juros + Amortizações de Principal) — métrica bancária de cobertura do serviço da dívida. */
  dscr: number;
  /**
   * true quando `state.cashflow.amortizacoes` traz algum valor > 0 no ano.
   * Se false, o DSCR colapsa para a Cobertura de Juros (EBITDA ÷ Juros) — o consultor
   * precisa saber que o resultado pode estar superestimado por falta do cronograma.
   */
  dscrAmortizacoesInformadas: boolean;
  dividaOnerosa: number;
  passivoCirculante: number;
  ativoCirculante: number;
}

/**
 * Shield fiscal correto por regime (Auditoria Jun/2026).
 * Juros sobre empréstimos só são DEDUTÍVEIS da base do IRPJ/CSLL no Lucro Real.
 * Em Presumido a base é presumida sobre receita — juros não abatem.
 * Em Simples (DAS) também não há dedução.
 *
 * Auditoria bug #2: o adicional de 10% do IRPJ só incide quando o lucro anual
 * ultrapassa R$240k (4 × R$60k/trimestre). Abaixo disso, a alíquota marginal
 * efetiva é 24% (15% IRPJ + 9% CSLL), não 34%.
 */
export function irShieldForRegime(regime: TaxRegime, lairAnual: number = Infinity): number {
  if (regime !== "real") return 0; // presumido / simples
  return lairAnual > 240_000 ? 0.34 : 0.24;
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

  // SSOT: safeMath previne NaN/Infinity em qualquer divisão de indicador.
  // Três visões de Ponto de Equilíbrio (Garrison/Horngren + visão bancária):
  //  • PE OPERACIONAL (clássico contábil): custos fixos operacionais (com depreciação,
  //    SEM juros). Juros ficam abaixo do EBIT e não pertencem ao PE clássico.
  //  • PE FINANCEIRO (caixa, clássico): custos fixos operacionais SEM depreciação e SEM
  //    juros — receita mínima para cobrir desembolsos OPERACIONAIS.
  //  • PE TOTAL: inclui juros como custo fixo financeiro recorrente — cobertura completa
  //    (operação + serviço da dívida). Visão da PME para "não ter prejuízo".
  const depreciacaoAnual = sum(dre.depreciacao);
  const custosFixosOperacionaisSemDep = custosFixosAnual - depreciacaoAnual;
  const custosFixosComJuros = custosFixosAnual + jurosAnual;
  const margemContribuicao = safePct(receitaLiqAnual - custosVarAnual, receitaLiqAnual);
  const mcFrac = margemContribuicao / 100;
  const pontoEquilibrioOperacional = margemContribuicao > 0
    ? safeDivide(custosFixosAnual, mcFrac)
    : 0;
  const pontoEquilibrio = margemContribuicao > 0
    ? safeDivide(custosFixosComJuros, mcFrac)
    : 0;
  const pontoEquilibrioFinanceiro = margemContribuicao > 0
    ? safeDivide(custosFixosOperacionaisSemDep, mcFrac)
    : 0;

  // ---- Estrutura de capital baseada em campos REAIS ----
  const PL = Math.max(0, capital.patrimonioLiquido);
  const D  = Math.max(0, capital.dividaOnerosa);
  const V  = PL + D;
  const wE = V > 0 ? PL / V : capital.proprio / 100;
  const wD = V > 0 ? D / V : 1 - capital.proprio / 100;

  // SSOT: WACC usa shield do regime EFETIVO (Simples acima do limite vira Presumido sem shield).
  // Auditoria bug #2: shield agora respeita o adicional 10% IRPJ (só > R$240k de LAIR anual).
  // Auditoria #4: Ke ≤ 0 é financeiramente impossível (custo do capital próprio mínimo ≥ taxa livre de risco).
  // Fallback: piso de 8% a.a. (≈ Selic neutra) — evita WACC artificialmente baixo que infla VPL/ROIC vs WACC.
  const irShield = irShieldForRegime(resolveEffectiveRegime(state), lairAnual);
  // Auditoria #4 (unidades): Ke é armazenado em % (ex.: 15 = 15% a.a.). O piso de 8% a.a.
  // deve ser 8 — não 0.08 — senão o WACC sai 100× menor quando Ke ≤ 0.
  const keSeguro = capital.ke > 0 ? capital.ke : 8;
  const wacc = wE * keSeguro + wD * capital.kd * (1 - irShield);

  // ---- NOPAT e ROIC (Auditoria — metodologia consistente) ----
  // NOPAT = EBIT × (1 − t_marginal). Usar alíquota MARGINAL do regime (irShield) em vez de
  // efetiva (impostos/LAIR) evita contaminar o NOPAT com a estrutura de capital: a alíquota
  // efetiva inclui o benefício fiscal dos juros, fazendo o ROIC variar com endividamento
  // mesmo sem mudança operacional. Damodaran/Koller usam alíquota marginal.
  const tcMarginal = Math.max(0, Math.min(0.5, irShield));
  const nopat = Math.max(0, ebitAnual * (1 - tcMarginal));

  // Capital Investido — duas vias da identidade contábil A = P + PL:
  //   • Lado ativo:      CI = (Ativo Total − Caixa Ocioso) − Passivos Não-Onerosos
  //   • Lado financiamento: CI = PL + Dívida Onerosa − Caixa Ocioso
  // Em balanços reais de PME, Ativo Total ≠ PL + D + PNO (há outros passivos: salários,
  // tributos a pagar, adiantamentos), então as duas vias divergem. Damos preferência ao
  // LADO FINANCIAMENTO (PL + D) quando ambos PL e D estão preenchidos — é o capital
  // efetivamente remunerado por sócios e credores, base correta do ROIC.
  const pno = Math.max(0, capital.passivosNaoOnerosos ?? capital.fornecedores ?? 0);
  const caixaOcioso = Math.max(0, capital.caixaOcioso ?? 0);
  const ciFinanciamento = PL + D;
  const ciAtivo = capital.ativoTotal > 0 ? capital.ativoTotal - pno : 0;
  // Prioridade: financiamento (mais confiável p/ ROIC) → ativo (fallback) → identidade contábil
  const ciBase = ciFinanciamento > 0
    ? ciFinanciamento
    : (ciAtivo > 0 ? ciAtivo : (PL + D + pno) - pno);
  const capitalInvestido = Math.max(1, ciBase - caixaOcioso);
  const roic = safePct(nopat, capitalInvestido);
  // ROE com PL MÉDIO (CFA/Damodaran) quando abertura informada — corrige viés em
  // empresas em crescimento (PL final > inicial subestima ROE) ou com prejuízo
  // acumulado (PL final < inicial superestima ROE). Fallback: PL fim de período.
  const plAbertura = Math.max(0, capital.patrimonioLiquidoAbertura ?? 0);
  const plMedio = plAbertura > 0 ? (plAbertura + PL) / 2 : PL;
  const roe = plMedio > 0 ? safePct(llAnual, plMedio) : 0;
  const roa = capital.ativoTotal > 0 ? safePct(llAnual, capital.ativoTotal) : 0;

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
  // NCG: usa CR + Estoque − Fornecedores; fallback estimado se zerado.
  // Auditoria: usar RECEITA LÍQUIDA (após deduções comerciais e impostos sobre venda)
  // em vez de receita bruta evita superestimar o CR em 8–15% para regimes com carga
  // tributária alta (ex.: Presumido com ISS 5% + PIS/COFINS). O cliente deve o preço
  // líquido de devoluções/descontos incondicionais, não o faturamento bruto contábil.
  const crEstimado = capital.contasReceber > 0
    ? capital.contasReceber
    : (receitaLiqAnual / 360) * revenue.pmr;
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
  // Quando Ativo Total não foi informado, usamos fallback: passivo conhecido
  // (Dívida Onerosa + PNO) ÷ proxy de Ativo (PL + D + PNO). Evita exibir "0%"
  // silenciosamente como se fosse "sem dívida" — flag sinaliza estimativa à UI.
  const endividamentoGeralDadosCompletos = capital.ativoTotal > 0;
  let endividamentoGeral = 0;
  if (endividamentoGeralDadosCompletos) {
    const passivoTotalEstim = Math.max(0, capital.ativoTotal - PL);
    endividamentoGeral = (passivoTotalEstim / capital.ativoTotal) * 100;
  } else {
    const passivoConhecido = D + pno;
    const ativoProxy = PL + D + pno;
    endividamentoGeral = ativoProxy > 0 ? (passivoConhecido / ativoProxy) * 100 : 0;
  }
  const grauEndividamento = PL > 0 ? (D / PL) * 100 : 0;
  // Caps neutros para evitar Infinity/NaN propagando em métricas compostas.
  const CAP_COB = 999;       // cobertura de juros máx exibível
  const CAP_DL_EBITDA = 99;  // dívida líq / EBITDA máx
  const CAP_PAYBACK = 99;    // payback em anos máx
  const coberturaJuros = jurosAnual > 1 ? Math.min(CAP_COB, safeDivide(ebitAnual, jurosAnual, CAP_COB)) : CAP_COB;
  const giroAtivo = capital.ativoTotal > 0 ? safeDivide(receitaLiqAnual, capital.ativoTotal) : 0;
  const dividaLiq = computeNetDebt(state); // SSOT-1: helper único usado por Valuation também
  const dividaLiqEbitda = ebitdaAnual > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitdaAnual))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const dividaLiqEbit = ebitAnual > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / ebitAnual))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  const dividaLiqPl = PL > 1
    ? Math.max(-CAP_DL_EBITDA, Math.min(CAP_DL_EBITDA, dividaLiq / PL))
    : (dividaLiq <= 0 ? 0 : CAP_DL_EBITDA);
  // Amortização do PL pelo Lucro Contábil (período em anos) — NÃO é payback clássico.
  const amortizacaoPlPorLucro = llAnual > 1 ? Math.min(CAP_PAYBACK, PL / llAnual) : (PL <= 0 ? 0 : CAP_PAYBACK);
  const payback = amortizacaoPlPorLucro; // @deprecated alias para retrocompat
  // FCF OPERACIONAL (antes do CAPEX): EBITDA − Impostos − ΔNCG.
  // Equivale ao CFO (Cash Flow from Operations) — usado no payback clássico (capacidade
  // de geração de caixa pelo qual o CAPEX inicial é amortizado).
  const fcf = ebitdaAnual - impostosAnual - Math.max(0, ncg - capital.capitalGiroDisponivel);
  // CAPEX anual TOTAL: plano de CAPEX mensal + ativações do ano (todas, não só mês 1).
  const capexAnual = sum(state.cashflow.capex ?? [])
    + (capital.capexAtivacao ?? []).reduce((acc, ca) => acc + ((ca && (ca.valor || 0) > 0) ? (ca.valor || 0) : 0), 0);
  // FCF APÓS CAPEX (≈ FCFF/Free Cash Flow to Firm): CFO − CAPEX. Mede caixa que
  // sobra para credores e acionistas DEPOIS dos investimentos em ativo fixo.
  // É a métrica correta para "Qualidade do Lucro" — empresa com EBITDA alto mas
  // CAPEX pesado pode ter FCFF negativo apesar do lucro contábil positivo.
  const fcfAposCapex = fcf - capexAnual;
  // Payback CLÁSSICO: CAPEX inicial ÷ CFO anual. CAPEX inicial = mês 1 do plano de CAPEX
  // + ativações marcadas no mês 1. Usa o CFO (antes do CAPEX recorrente) porque o
  // próprio CAPEX inicial é o que está sendo amortizado — descontar CAPEX do denominador
  // seria dupla contagem.
  const capexMes1 = (state.cashflow.capex?.[0] ?? 0)
    + (capital.capexAtivacao ?? []).reduce((acc, ca) => acc + (ca && ca.mes === 1 ? (ca.valor || 0) : 0), 0);
  const paybackCapex = capexMes1 > 0 && fcf > 1
    ? Math.min(CAP_PAYBACK, capexMes1 / fcf)
    : (capexMes1 <= 0 ? 0 : CAP_PAYBACK);

  // GAO = MC ($) ÷ EBIT. Mede elasticidade do EBIT a variações na receita.
  // (I4) Aceita EBIT negativo — GAO negativo é informação real ("alavancagem reversa").
  // PRECISÃO ECONÔMICA: a MC aqui usa `custosVariaveis` (engine respeita o override
  // `CostLine.comportamento`). Linhas de CPV que são fixas em essência (ex.: folha CLT
  // direta de prestadora de serviços) devem ser marcadas como `comportamento: "fixo"` para
  // não inflar a MC e distorcer o GAO — sem o override, o GAO superestima a alavancagem.
  const mcReais = receitaLiqAnual - custosVarAnual;
  const gao = Math.abs(ebitAnual) > 1 ? Math.max(-99, Math.min(99, mcReais / ebitAnual)) : 0;
  // Qualidade do Lucro = FCF APÓS CAPEX ÷ LL. Usa FCFF (não CFO) — uma empresa só converte
  // lucro contábil em caixa LIVRE depois de financiar o CAPEX de manutenção/expansão.
  // Negativo expõe "lucro de papel" (lucro contábil que não sobra como caixa livre).
  const qualidadeLucro = Math.abs(llAnual) > 1 ? Math.max(-9, Math.min(9, fcfAposCapex / llAnual)) : 0;

  // Indicadores de produtividade por colaborador (headcount em Configurações Rápidas).
  const headcount = Math.max(0, state.numColaboradores ?? 0);
  const receitaPorColaborador = headcount > 0 ? receitaLiqAnual / headcount : 0;
  // (I10) Faturamento = Receita BRUTA (padrão de benchmarking de mercado).
  const faturamentoPorColaborador = headcount > 0 ? receitaBrutaAnual / headcount : 0;
  const ebitdaPorColaborador = headcount > 0 ? ebitdaAnual / headcount : 0;
  const lucroPorColaborador = headcount > 0 ? llAnual / headcount : 0;
  // Folha (CLT + pró-labore + MOD) com encargos sobre Receita Líquida.
  const folha = folhaAnual(state);
  const custoPessoalSobreReceita = receitaLiqAnual > 0 ? (folha / receitaLiqAnual) * 100 : 0;

  // Margem de Segurança Operacional: folga entre Receita e Ponto de Equilíbrio.
  // Acima de 25% é confortável; <10% é zona crítica. Capa em ±999 para evitar Infinity.
  const margemSeguranca = receitaLiqAnual > 0 && pontoEquilibrio > 0
    ? Math.max(-999, Math.min(999, ((receitaLiqAnual - pontoEquilibrio) / receitaLiqAnual) * 100))
    : 0;

  // DSCR — Debt Service Coverage Ratio: EBITDA ÷ (Juros + Amortizações de Principal).
  // Visão bancária do serviço da dívida (juros + principal). <1,25× trava renovação; >1,50× destrava.
  const amortizPrincipalAnual = sum(state.cashflow.amortizacoes);
  const dscrAmortizacoesInformadas = amortizPrincipalAnual > 0;
  const servicoDivida = jurosAnual + amortizPrincipalAnual;
  const CAP_DSCR = 99;
  const dscr = servicoDivida > 1
    ? Math.max(-CAP_DSCR, Math.min(CAP_DSCR, ebitdaAnual / servicoDivida))
    : (ebitdaAnual <= 0 ? 0 : CAP_DSCR);

  return {
    margemBruta: safePct(lucroBrutoAnual, receitaLiqAnual),
    margemEbitda: safePct(ebitdaAnual, receitaLiqAnual),
    margemEbit: safePct(ebitAnual, receitaLiqAnual),
    margemLiquida: safePct(llAnual, receitaLiqAnual),
    margemContribuicao, pontoEquilibrio, pontoEquilibrioOperacional, pontoEquilibrioFinanceiro,
    roe, roa, roic, wacc: safeNumber(wacc),
    cicloFinanceiro, ncg, gapCapitalGiro,
    liquidezCorrente, liquidezSeca, liquidezImediata,
    endividamentoGeral, endividamentoGeralDadosCompletos, grauEndividamento, coberturaJuros, giroAtivo,
    dividaLiqEbitda, dividaLiqEbit, dividaLiqPl, payback, amortizacaoPlPorLucro, paybackCapex, fcf: safeNumber(fcf),
    conversaoEbitdaCaixa: ebitdaAnual > 0 ? safePct(fcf, ebitdaAnual) : 0,
    gao, qualidadeLucro,
    receitaPorColaborador, faturamentoPorColaborador, ebitdaPorColaborador, lucroPorColaborador, custoPessoalSobreReceita,
    margemSeguranca, dscr, dscrAmortizacoesInformadas,
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

/**
 * SSOT-4: comparativo de regimes COM lucro líquido e regime ótimo embutidos.
 * Antes, TaxTab e compliance/tax.ts reimplementavam llBy/best/delta separadamente.
 */
export function compareRegimes(state: AppState, era?: TaxEra) {
  // Se uma era for passada, aplica override no state antes de rodar os engines —
  // garante que Simples/Presumido/Real sejam comparados sob o mesmo regime de Reforma.
  const s: AppState = era ? { ...state, tax: { ...state.tax, era } } : state;
  const baseLair = buildDRE(s, "presumido").dre.lair;
  const simples = calcSimples(s);
  const presumido = calcPresumido(s);
  const real = calcReal(s, baseLair);
  const llBy: Record<TaxRegime, number> = {
    simples: sum(buildDRE(s, "simples").dre.lucroLiquido),
    presumido: sum(buildDRE(s, "presumido").dre.lucroLiquido),
    real: sum(buildDRE(s, "real").dre.lucroLiquido),
  };
  const desenquadrado = simplesExcedeLimite(s);
  const candidates: TaxRegime[] = desenquadrado
    ? ["presumido", "real"]
    : ["simples", "presumido", "real"];
  const best = candidates.reduce((a, b) => (llBy[b] > llBy[a] ? b : a));
  return { simples, presumido, real, llBy, best, desenquadradoSimples: desenquadrado };
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
