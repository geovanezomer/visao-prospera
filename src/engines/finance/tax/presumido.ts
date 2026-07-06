// =====================================================================
// LUCRO PRESUMIDO — IRPJ/CSLL sobre receita × % de presunção,
// PIS/COFINS cumulativos, ISS/ICMS conforme atividade.
// [CBS/IBS] CBS substitui PIS/COFINS e IBS substitui ICMS/ISS conforme
// cronograma (ver tax/reforma.ts). Créditos sobre CPV seguem a regra
// ampla (CBS/IBS são não-cumulativos full).
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// =====================================================================

import { AppState, BusinessType, TaxConfig } from "../types";
import { sum, zeros12 } from "../format";
import {
  getIrpjPct,
  getCsllPct,
  getPisCumPct,
  getCofinsCumPct,
  getPresumidoBases,
  getIrrfAplicacoesPct,
} from "../taxDefaults";
import { receitaTributavel, splitReceitasFinanceiras } from "../shared";
import { isCpvCost, isCreditoAmploCbsIbs, effectiveMonthValues } from "../costs";
import { getReformaRates, getCbsCredCpvPct, getIbsCredCpvPct } from "./reforma";
import { adicionalIrpjTrimestral, type MonthlyTax } from "./shared";
import { calcCbs, calcIbs } from "tributos-br";

// [CBS/IBS] Helpers: usam tributos-br (LC 214/2025) para garantir
// arredondamento HALF_UP (padrão SEFAZ) sobre cada multiplicação
// alíquota × base, evitando drift de centavos em apurações mensais.
const cbsValor = (base: number, pct: number): number =>
  pct > 0 && base > 0 ? Number(calcCbs({ base: base.toString(), aliquota: (pct / 100).toString() }).imposto) : 0;
const ibsValor = (base: number, pct: number): number =>
  pct > 0 && base > 0 ? Number(calcIbs({ base: base.toString(), aliquota: (pct / 100).toString() }).imposto) : 0;

/** @deprecated Use getPresumidoBases(tax, business) de taxDefaults.ts. Mantido para retro-compat. */
export function presumidoBases(business: BusinessType): { irpj: number; csll: number } {
  return getPresumidoBases({ ratesOverride: undefined } as TaxConfig, business);
}

export function calcPresumido(state: AppState): MonthlyTax {
  const { revenue, tax, businessType } = state;
  const trib = receitaTributavel(state);
  const bases = getPresumidoBases(tax, businessType);
  // Precedência: override em ratesOverride.presumidoBases[business] SEMPRE vence
  // (postura "consultor edita com responsabilidade" — MODO A). Só cai no campo
  // avulso `tax.presumidoBaseIRPJ/CSLL` quando não há override específico da atividade.
  const hasOverride = !!tax.ratesOverride?.presumidoBases?.[businessType];
  const baseIRPJ = (hasOverride ? bases.irpj : (tax.presumidoBaseIRPJ || bases.irpj)) / 100;
  const baseCSLL = (hasOverride ? bases.csll : (tax.presumidoBaseCSLL || bases.csll)) / 100;
  const iss = tax.issIcms / 100;
  const issDed = (tax.issDeducoes ?? 0) / 12;
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;
  const reforma = getReformaRates(tax.era, tax);
  // [CBS/IBS] Alíquotas efetivas de crédito sobre CPV — fornecedor SN limita.
  const snFornecedorPct = tax.fornecedorSimplesNacionalPct ?? 0;
  const cbsCredPct = getCbsCredCpvPct(reforma.cbsPct, snFornecedorPct);
  const ibsCredPct = getIbsCredCpvPct(reforma.ibsPct, snFornecedorPct);
  const usaReforma =
    reforma.cbsPct > 0 ||
    reforma.ibsPct > 0 ||
    reforma.pisCofinsMult < 1 ||
    reforma.icmsIssMult < 1;
  const irpjAliq = getIrpjPct(tax) / 100;
  const csllAliq = getCsllPct(tax) / 100;
  const pisAliq = getPisCumPct(tax) / 100;
  const cofinsAliq = getCofinsCumPct(tax) / 100;

  // Bases de crédito — DOIS acumuladores distintos:
  // - cpvMonthly: ICMS antigo (não-cumulatividade FÍSICA, só mercadoria do CPV)
  // - baseCreditoCbsIbsMonthly: CBS/IBS (não-cumulatividade AMPLA da LC 214/2025
  //   arts. 47-56 — todo insumo exceto folha/financeiro/semCredito).
  const cpvMonthly = zeros12();
  const baseCreditoCbsIbsMonthly = zeros12();
  const temCpvCredito = icmsCredAliq > 0;
  const temCredAmplo = usaReforma;
  if (temCpvCredito || temCredAmplo) {
    for (const c of state.costs) {
      const v = effectiveMonthValues(c);
      if (temCpvCredito && isCpvCost(c) && !c.semCredito) {
        for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
      }
      if (temCredAmplo && isCreditoAmploCbsIbs(c)) {
        for (let i = 0; i < 12; i++) baseCreditoCbsIbsMonthly[i] += v[i];
      }
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
  // IRRF antecipação sobre rendimentos de aplicações — compensável com IRPJ.
  // No modelo, aplicamos compensação MENSAL com piso zero (não gera restituição
  // automática; excesso não retorna). Base = mesma rendFinTrib usada no IRPJ.
  const irrfAliq = getIrrfAplicacoesPct(tax) / 100;

  let irpjTotal = 0,
    csllTotal = 0,
    pisTotal = 0,
    cofinsTotal = 0,
    issTotal = 0,
    cbsTotal = 0,
    ibsTotal = 0,
    irrfTotal = 0;
  let saldoCredorICMS = 0,
    saldoCBS = 0,
    saldoIBS = 0;
  const monthlyVendas = zeros12();
  const monthlyLucro = zeros12();
  const monthlyCbsIbs = zeros12();
  const monthly = trib.map((r, i) => {
    const irpj = baseIRPJMensal[i] * irpjAliq;
    const adicional = adicionalMensal[i];
    const csll = baseCSLLMensal[i] * csllAliq;
    // IRRF retido na fonte sobre rendimentos financeiros — antecipação do IRPJ.
    // Compensa contra IRPJ + Adicional no próprio mês; piso zero (excesso não gera
    // restituição automática neste modelo).
    const irrfRetido = (rendFinTrib[i] || 0) * irrfAliq;
    const irpjLiquido = Math.max(0, irpj + adicional - irrfRetido);
    const pis = r * pisAliq * reforma.pisCofinsMult;
    const cofins = r * cofinsAliq * reforma.pisCofinsMult;
    const issBase = Math.max(0, r - issDed);
    const debito = issBase * iss;
    const creditoMes = cpvMonthly[i] * icmsCredAliq + saldoCredorICMS;
    const issvBruto = Math.max(0, debito - creditoMes);
    const issv = issvBruto * reforma.icmsIssMult;
    saldoCredorICMS = Math.max(0, creditoMes - debito);
    let cbs = 0,
      ibs = 0;
    if (reforma.cbsPct > 0) {
      const dCbs = cbsValor(r, reforma.cbsPct);
      const cCbs = cbsValor(baseCreditoCbsIbsMonthly[i], cbsCredPct) + saldoCBS;
      cbs = Math.max(0, dCbs - cCbs);
      saldoCBS = Math.max(0, cCbs - dCbs);
    }
    if (reforma.ibsPct > 0) {
      const dIbs = ibsValor(r, reforma.ibsPct);
      const cIbs = ibsValor(baseCreditoCbsIbsMonthly[i], ibsCredPct) + saldoIBS;
      ibs = Math.max(0, dIbs - cIbs);
      saldoIBS = Math.max(0, cIbs - dIbs);
    }
    irpjTotal += irpjLiquido;
    csllTotal += csll;
    pisTotal += pis;
    cofinsTotal += cofins;
    issTotal += issv;
    cbsTotal += cbs;
    ibsTotal += ibs;
    // Compensação efetivamente utilizada (limitada pelo IRPJ+Adicional do mês).
    irrfTotal += Math.min(irrfRetido, irpj + adicional);
    const vendas = pis + cofins + issv + cbs + ibs;
    const lucro = irpjLiquido + csll;
    monthlyVendas[i] = vendas;
    monthlyLucro[i] = lucro;
    monthlyCbsIbs[i] = cbs + ibs;
    return vendas + lucro;
  });
  const annual = sum(monthly);
  const annualVendas = sum(monthlyVendas);
  const annualLucro = sum(monthlyLucro);
  const rbAnual = sum(revenue.bruta);
  // IRPJ bruto (sem compensação) para o detail — mantém rastreabilidade contábil.
  const adicionalAnual = sum(adicionalMensal);
  const irpjBrutoAnual = irpjTotal + irrfTotal; // reverte a compensação para o "bruto"
  const detail: Record<string, number> = {
    IRPJ: irpjBrutoAnual - adicionalAnual,
    "Adicional IRPJ (10%)": adicionalAnual,
    CSLL: csllTotal,
  };
  if (irrfTotal > 0) detail["(−) IRRF s/ aplicações (compensado)"] = -irrfTotal;
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
    monthlyCbsIbs,
    annual,
    annualVendas,
    annualLucro,
    effective: rbAnual > 0 ? (annual / rbAnual) * 100 : 0,
    detail,
  };
}
