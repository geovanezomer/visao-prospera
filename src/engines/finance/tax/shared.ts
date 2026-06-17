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
