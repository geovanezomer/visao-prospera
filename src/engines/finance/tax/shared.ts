// =====================================================================
// TAX/SHARED — tipo MonthlyTax e helpers compartilhados pelos regimes.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// =====================================================================

import { TaxConfig } from "../types";
import { zeros12 } from "../format";
import { getIrpjAdicionalPct, getIrpjAdicionalGatilhoTri } from "../taxDefaults";

export interface MonthlyTax {
  /** Total mensal (vendas + lucro). Retro-compat. */
  monthly: number[];
  /** Impostos sobre venda — PIS/COFINS/ICMS/ISS/CBS/IBS (+ DAS no Simples). Deduzidos antes da Receita Líquida. */
  monthlyVendas: number[];
  /** Impostos sobre lucro — IRPJ + Adicional + CSLL. Deduzidos do LAIR. */
  monthlyLucro: number[];
  /** [Split Payment] Parcela mensal de CBS+IBS dentro de `monthlyVendas`.
   *  Usada por `computeImpostos` para aplicar lag 0 quando o Split está ativo. */
  monthlyCbsIbs: number[];
  annual: number;
  annualVendas: number;
  annualLucro: number;
  effective: number;
  detail: Record<string, number>;
}

/**
 * Adicional IRPJ trimestral: % sobre lucro trimestral acima do gatilho
 * (R$ 20k × 3 meses por padrão). Rateia proporcionalmente entre os 3 meses
 * do trimestre para preservar a granularidade mensal das séries.
 */
export function adicionalIrpjTrimestral(baseMensal: number[], tax: TaxConfig): number[] {
  const out = zeros12();
  const aliq = getIrpjAdicionalPct(tax) / 100;
  const gatilho = getIrpjAdicionalGatilhoTri(tax);
  for (let t = 0; t < 4; t++) {
    const m0 = t * 3;
    const baseTri = Math.max(
      0,
      (baseMensal[m0] || 0) + (baseMensal[m0 + 1] || 0) + (baseMensal[m0 + 2] || 0),
    );
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

// =====================================================================
// ICMS/ISS "por fora" — usado no Simples acima do sublimite estadual
// (LC 123/06 art. 13-A) e por qualquer regime que precise reaproveitar as
// mesmas regras do RPA (débito × crédito para mercadoria; alíquota × base
// líquida de deduções para serviços). Extraído para evitar duplicação
// com tax/presumido.ts.
// =====================================================================

import type { AppState } from "../types";
import { receitaTributavel } from "../shared";
import { isCpvCost, effectiveMonthValues } from "../costs";
import { zeros12 } from "../format";

/**
 * Calcula o ICMS (mercadoria) ou ISS (serviços) devido pelo regime normal,
 * série mensal em R$. Reaproveita a lógica débito−crédito com carryforward
 * de saldo credor de ICMS, e o abatimento de `issDeducoes` no ISS.
 *
 * Retorna a série mensal + total anual. Não aplica multiplicadores da reforma
 * (uso previsto: Simples > sublimite recolhe ICMS/ISS pelo cronograma normal
 * do estado/município — a era da reforma incide no DAS residual, não aqui).
 */
export function computeIcmsIssNormal(state: AppState): {
  monthly: number[];
  annual: number;
} {
  const { tax, businessType } = state;
  const trib = receitaTributavel(state);
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  const iss = (tax.issIcms || 0) / 100;
  const issDedMensal = (tax.issDeducoes ?? 0) / 12;
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;

  // CPV mensal — mesma regra de presumido.ts (só linhas de CPV, sem semCredito).
  const cpvMonthly = zeros12();
  if (icmsCredAliq > 0) {
    for (const c of state.costs) {
      if (!isCpvCost(c) || c.semCredito) continue;
      const v = effectiveMonthValues(c);
      for (let i = 0; i < 12; i++) cpvMonthly[i] += v[i];
    }
  }

  let saldoCredorICMS = 0;
  const monthly = trib.map((r, i) => {
    if (isMercadoria) {
      const debito = r * iss;
      const creditoMes = cpvMonthly[i] * icmsCredAliq + saldoCredorICMS;
      const liq = Math.max(0, debito - creditoMes);
      saldoCredorICMS = Math.max(0, creditoMes - debito);
      return liq;
    }
    const issBase = Math.max(0, r - issDedMensal);
    return issBase * iss;
  });
  return { monthly, annual: monthly.reduce((a, b) => a + b, 0) };
}
