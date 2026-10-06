// =====================================================================
// TAX/SHARED — tipo MonthlyTax e helpers compartilhados pelos regimes.
// Submódulo coeso da engine financeira — funções puras, sem dependência de UI.
// =====================================================================

import type { CostLine, TaxConfig } from "../types";
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
import { isCpvCost, isLaborLine, effectiveMonthValues } from "../costs";
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
  const aj = icmsAjustes(tax, isMercadoria);
  const monthly = trib.map((r, i) => {
    if (isMercadoria) {
      const debito = r * aj.baseProprio * iss;
      const creditoMes = cpvMonthly[i] * icmsCredAliq + saldoCredorICMS;
      const liq = Math.max(0, debito - creditoMes) + r * aj.difalSobreReceita;
      saldoCredorICMS = Math.max(0, creditoMes - debito);
      return liq * mult;
    }
    const issBase = Math.max(0, r - issDedMensal);
    return issBase * iss * mult;
  });
  return { monthly, annual: monthly.reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------------------
// ICMS-ST, DIFAL e redução setorial da Reforma (Presumido e Real)
// ---------------------------------------------------------------------------

const pct01 = (v: number | undefined) => Math.min(1, Math.max(0, (v ?? 0) / 100));

/**
 * Ajustes do ICMS de comércio/indústria sobre a receita do mês:
 *  - `baseProprio`: fração da receita com débito de ICMS próprio (a parte já
 *    retida por substituição tributária fica fora);
 *  - `difal`: DIFAL devido ao estado de destino (sem crédito).
 * Serviços (ISS) não têm esses ajustes.
 */
export function icmsAjustes(
  tax: TaxConfig,
  isMercadoria: boolean,
): { baseProprio: number; difalSobreReceita: number } {
  if (!isMercadoria) return { baseProprio: 1, difalSobreReceita: 0 };
  return {
    baseProprio: 1 - pct01(tax.icmsStReceitaPct),
    difalSobreReceita: pct01(tax.difalReceitaPct) * Math.max(0, (tax.difalAliquotaPct ?? 0) / 100),
  };
}

/** Fator sobre a alíquota de CBS/IBS das VENDAS (redução setorial da LC 214/2025). */
export function fatorReducaoReforma(tax: TaxConfig): number {
  return 1 - pct01(tax.reformaReducaoPct);
}

/** Créditos de PIS/COFINS não cumulativos: custos com direito a crédito (art. 3º). */
const CREDITO_PIS_COFINS_RE =
  /energia|aluguel|alugu[eé]is|arrendamento|leasing|frete|armazenagem|deprecia/i;

export function temCreditoPisCofins(c: CostLine): boolean {
  if (c.semCredito || c.category === "financeiro") return false;
  if (isLaborLine(c)) return false;
  return isCpvCost(c) || CREDITO_PIS_COFINS_RE.test(c.label);
}

/**
 * Compensação de prejuízo fiscal / base negativa na apuração trimestral do
 * Lucro Real (trava de 30% do lucro do trimestre). Devolve a base mensal já
 * compensada (rateada pelos meses positivos), o total compensado e o saldo.
 */
export function compensarTrimestral(
  baseSigned: number[],
  saldoAbertura: number,
): { mensal: number[]; compensado: number; saldoFinal: number } {
  const mensal = baseSigned.map(() => 0);
  let saldo = Math.max(0, saldoAbertura);
  let compensado = 0;
  for (let q = 0; q < 4; q++) {
    const i0 = q * 3;
    const sumQ = baseSigned[i0] + baseSigned[i0 + 1] + baseSigned[i0 + 2];
    if (sumQ <= 0) {
      saldo += -sumQ;
      continue;
    }
    const comp = Math.min(sumQ * 0.3, saldo);
    saldo -= comp;
    compensado += comp;
    const ajustado = sumQ - comp;
    const pos = [0, 1, 2].map((k) => Math.max(0, baseSigned[i0 + k]));
    const posSum = pos[0] + pos[1] + pos[2];
    for (let k = 0; k < 3; k++)
      mensal[i0 + k] = posSum > 0 ? ajustado * (pos[k] / posSum) : ajustado / 3;
  }
  return { mensal, compensado, saldoFinal: saldo };
}
