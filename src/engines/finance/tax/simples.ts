// =====================================================================
// SIMPLES NACIONAL — cálculo do DAS e alíquota efetiva por anexo.
// Tabelas vivem em taxDefaults.ts (editáveis via painel).
// Extraído de calculations.ts (Fase 2) — comportamento idêntico.
// [CBS/IBS] A reforma mantém o Simples opcional (LC 214/2025 art. 41);
// quem optar segue pagando DAS único e NÃO compõe CBS/IBS aqui.
// =====================================================================

import { AppState, SimplesAnexo, TaxConfig } from "../types";
import { sum, zeros12 } from "../format";
import { getSimplesTable, getSimplesLimite } from "../taxDefaults";
import { receitaTributavel } from "../shared";
import { resolveSimplesAnexo } from "../regime";
import type { MonthlyTax } from "./shared";

/** Alíquota efetiva (%) do Simples para RBT12 + anexo, descontando a parcela a deduzir. */
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
