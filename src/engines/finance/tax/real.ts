// =====================================================================
// LUCRO REAL — IRPJ/CSLL sobre o LAIR (lucro real), PIS/COFINS
// não-cumulativos com créditos, ISS/ICMS conforme atividade.
// [CBS/IBS] CBS/IBS são não-cumulativos plenos (créditos amplos).
// PIS/COFINS sobre receitas financeiras seguem Decreto 8.426/2015
// (0,65% + 4%) — extintos quando pisCofinsMult=0.
// Extraído de calculations.ts (Fase 2) — comportamento idêntico.
// =====================================================================

import { AppState, TaxRegime } from "../types";
import { sum, zeros12 } from "../format";
import {
  getIrpjPct, getCsllPct,
  getPisNaoCumPct, getCofinsNaoCumPct,
} from "../taxDefaults";
import { receitaTributavel, splitReceitasFinanceiras } from "../shared";
import { isCpvCost, effectiveMonthValues } from "../costs";
import { getReformaRates } from "./reforma";
import { adicionalIrpjTrimestral, type MonthlyTax } from "./shared";

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

/**
 * Escudo fiscal de juros (1 − alíquota marginal de IRPJ+CSLL) usado em WACC.
 * Apenas o Lucro Real captura o escudo. Simples/Presumido = 0.
 * Auditoria bug #2: o adicional de 10% do IRPJ só incide quando o lucro anual
 * ultrapassa R$240k (4 × R$60k/trimestre). Abaixo disso, a alíquota marginal
 * efetiva é 24% (15% IRPJ + 9% CSLL), não 34%.
 */
export function irShieldForRegime(regime: TaxRegime, lairAnual: number = Infinity): number {
  if (regime !== "real") return 0; // presumido / simples
  return lairAnual > 240_000 ? 0.34 : 0.24;
}
