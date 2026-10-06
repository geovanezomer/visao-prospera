// =====================================================================
// SIMPLES NACIONAL — cálculo do DAS e alíquota efetiva por anexo.
// Tabelas vivem em taxDefaults.ts (editáveis via painel).
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// [CBS/IBS] A reforma mantém o Simples opcional (LC 214/2025 art. 41);
// quem optar segue pagando DAS único e NÃO compõe CBS/IBS aqui.
// =====================================================================

import { AppState, SimplesAnexo, TaxConfig } from "../types";
import { sum, zeros12 } from "../format";
import { getSimplesTable, getSimplesLimite, SIMPLES_SUBLIMITE_ESTADUAL } from "../taxDefaults";
import { receitaTributavel } from "../shared";
import { resolveSimplesAnexo } from "../regime";
import { computeIcmsIssNormal, type MonthlyTax } from "./shared";

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
  // [Auditoria Bloco 1] RBT12 = Receita Bruta dos Últimos 12 Meses (LC 123/06 art. 3º §1º).
  // A FAIXA da tabela é determinada pela RECEITA BRUTA — não pela receita tributável
  // (que já está líquida de devoluções/cancelamentos). Aplicar alíquota efetiva sobre
  // a receita tributável é correto (devoluções não geram DAS), mas a faixa é da bruta.
  const rbBrutaAnual = sum(revenue.bruta);
  const aliq = simplesAliquotaEfetiva(rbBrutaAnual, anexo, tax) / 100;
  const dasBruto = trib.map((r) => r * aliq);
  const limite = getSimplesLimite(tax);
  const excedeu = rbBrutaAnual > limite;
  const sublimEstadual = SIMPLES_SUBLIMITE_ESTADUAL;
  const excedeuSublimite = rbBrutaAnual > sublimEstadual && rbBrutaAnual <= limite;

  // Acima do sublimite (LC 123/06 art. 13-A), ICMS/ISS saem do DAS e são
  // recolhidos pelo regime normal:
  //   monthly[m] = das[m] + icmsIssForaMensal[m]
  // O DAS NÃO é reduzido: RBT12 acima de R$ 3,6M cai sempre na 6ª faixa, cuja
  // repartição nos Anexos da LC 123 não tem coluna de ICMS/ISS (a alíquota da
  // faixa já é só federal — no Anexo I a efetiva cai de 11,875% para 8,5% ao
  // cruzar R$ 3,6M). Antes subtraíamos a partilha da 5ª faixa e o ICMS/ISS
  // saía duas vezes (Anexo I, RBT12 4M: DAS subestimado em ~R$ 128 mil/ano).
  // O teto de ISS (5% LC 116/03) e o multiplicador da reforma (transição ICMS→IBS)
  // são aplicados dentro de `computeIcmsIssNormal`.
  let monthly = dasBruto.slice();
  let icmsIssForaAnual = 0;
  let dasSemIcmsIssAnual = 0;
  if (excedeuSublimite && !excedeu) {
    const fora = computeIcmsIssNormal(state);
    monthly = dasBruto.map((v, i) => v + (fora.monthly[i] || 0));
    icmsIssForaAnual = fora.annual;
    dasSemIcmsIssAnual = sum(dasBruto);
  }
  const annual = sum(monthly);

  const detail: Record<string, number> = {};
  if (excedeuSublimite && !excedeu && icmsIssForaAnual >= 0) {
    detail[`DAS Simples (Anexo ${anexo}, s/ ICMS-ISS)`] = dasSemIcmsIssAnual;
    detail[`ICMS/ISS por fora (sublimite art. 13-A)`] = icmsIssForaAnual;
    detail[`ℹ Acima do sublimite estadual (R$ 3,6M) — ICMS/ISS recolhidos pelo regime normal`] = 0;
  } else {
    detail[`DAS Simples (Anexo ${anexo})`] = annual;
  }
  if (excedeu) {
    const limMi = (limite / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    detail[`⚠ Excedeu limite Simples (R$ ${limMi}M) — desenquadramento obrigatório`] = 0;
  }
  return {
    monthly,
    monthlyVendas: monthly.slice(),
    monthlyLucro: zeros12(),
    monthlyCbsIbs: zeros12(),
    annual,
    annualVendas: annual,
    annualLucro: 0,
    effective: rbBrutaAnual > 0 ? (annual / rbBrutaAnual) * 100 : 0,
    detail,
  };
}
