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
import { getReformaRates } from "./reforma";

/** Teto de ISS estabelecido pela LC 116/03 art. 8º-A (2% mínimo, 5% máximo). */
export const ISS_TETO_LC116 = 5;

/**
 * Calcula o ICMS (mercadoria) ou ISS (serviços) devido pelo regime normal,
 * série mensal em R$. Reaproveita a lógica débito−crédito com carryforward
 * de saldo credor de ICMS, e o abatimento de `issDeducoes` no ISS.
 *
 * Regras aplicadas:
 *  • ISS respeita o TETO de 5% da LC 116/03 (defesa em profundidade — mesmo
 *    que a UI/validação permita > 5%, o cálculo trava aqui).
 *  • Se `respeitarReforma=true`, aplica `reforma.icmsIssMult` para refletir
 *    a redução progressiva do ICMS/ISS estadual/municipal durante a transição
 *    para IBS (EC 132/2023). Por padrão está LIGADO — cronograma oficial vale
 *    tanto para RPA quanto para Simples > sublimite estadual.
 */
export function computeIcmsIssNormal(
  state: AppState,
  opts: { respeitarReforma?: boolean } = {},
): { monthly: number[]; annual: number } {
  const respeitarReforma = opts.respeitarReforma ?? true;
  const { tax, businessType } = state;
  const trib = receitaTributavel(state);
  const isMercadoria = businessType === "comercio" || businessType === "industria";
  // ISS: teto legal de 5% (LC 116/03 art. 8º-A). Não aplicável a mercadoria (ICMS).
  const issRaw = (tax.issIcms || 0) / 100;
  const issClamped = isMercadoria ? issRaw : Math.min(issRaw, ISS_TETO_LC116 / 100);
  const iss = issClamped;
  const issDedMensal = (tax.issDeducoes ?? 0) / 12;
  const icmsCredAliq = isMercadoria ? (tax.aliquotaICMSCredito ?? 0) / 100 : 0;
  const reforma = respeitarReforma ? getReformaRates(tax.era, tax) : null;
  const mult = reforma ? reforma.icmsIssMult : 1;

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
      return liq * mult;
    }
    const issBase = Math.max(0, r - issDedMensal);
    return issBase * iss * mult;
  });
  return { monthly, annual: monthly.reduce((a, b) => a + b, 0) };
}
