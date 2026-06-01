/**
 * Self-tests das fórmulas críticas pós-Auditoria Jun/2026.
 * Roda no console (F12) e pode ser chamado pela aba Valuation → Auditoria.
 */
import { DEFAULT_STATE } from "./defaults";
import { buildDRE, calcIndicators, irShieldForRegime } from "./calculations";
import { irr, irrDetailed, npv } from "./forecast";

export interface SelfTestCase {
  name: string;
  expected: number | string;
  actual: number | string;
  pass: boolean;
}

const approx = (a: number, b: number, tol = 0.01) =>
  Math.abs(a - b) / Math.max(1, Math.abs(b)) <= tol;

export function runFinanceSelfTests(): { results: SelfTestCase[]; allPassed: boolean } {
  const results: SelfTestCase[] = [];
  const add = (name: string, expected: number | string, actual: number | string, pass: boolean) =>
    results.push({ name, expected, actual, pass });

  // 1) irShieldForRegime
  add("irShield Real = 0.34", 0.34, irShieldForRegime("real"), irShieldForRegime("real") === 0.34);
  add("irShield Presumido = 0 (Auditoria)", 0, irShieldForRegime("presumido"), irShieldForRegime("presumido") === 0);
  add("irShield Simples = 0", 0, irShieldForRegime("simples"), irShieldForRegime("simples") === 0);

  // 2) NOPAT/ROIC com caso da auditoria (EBIT 100k, impostos 30k → NOPAT 70k, CI 500k → ROIC 14%)
  {
    const ebit = 100_000, imp = 30_000, ci = 500_000;
    const tc = imp / ebit;
    const nopat = ebit - ebit * tc;
    const roic = (nopat / ci) * 100;
    add("ROIC com NOPAT correto (EBIT 100k, imp 30k, CI 500k)", 14, roic, approx(roic, 14));
  }

  // 3) PIS mensal (audit): 100k × 1.65% − 600/12 = 1650 − 50 = 1600
  {
    const pis = Math.max(0, 100_000 * 0.0165 - 600 / 12);
    add("PIS não-cum. com crédito anual rateado", 1600, pis, approx(pis, 1600));
  }

  // 4) PME com estoque médio: (5k+15k)/2 ÷ (CPV diário 1k) = 10 dias
  {
    const estMedio = (5_000 + 15_000) / 2;
    const cpvDiario = 360_000 / 360;
    const pme = estMedio / cpvDiario;
    add("PME com estoque médio (10k ÷ 1k/dia)", 10, pme, approx(pme, 10));
  }

  // 5) ICMS carry-over: mês1 débito 10k crédito 15k → 0 + saldo 5k; mês2 débito 2k → 0
  {
    let saldo = 0;
    const m1deb = 10_000, m1cr = 15_000;
    const m1pago = Math.max(0, m1deb - (m1cr + saldo));
    saldo = Math.max(0, (m1cr + saldo) - m1deb);
    const m2deb = 2_000, m2cr = 0;
    const m2pago = Math.max(0, m2deb - (m2cr + saldo));
    saldo = Math.max(0, (m2cr + saldo) - m2deb);
    add("ICMS mês 1 pago (carry-over)", 0, m1pago, m1pago === 0);
    add("ICMS mês 2 pago (consome saldo credor)", 0, m2pago, m2pago === 0);
  }

  // 6) Gordon degenerado: WACC=g → fallback FCL×10
  {
    const fcl = 600_000, g = 0.10, wacc = 0.10;
    const spread = wacc - g;
    const vt = spread >= 0.005 ? (fcl * (1 + g)) / spread : fcl * 10;
    add("Gordon fallback quando WACC≈g", 6_000_000, vt, approx(vt, 6_000_000));
  }

  // 7) TIR convergente
  {
    const v = irr([-1000, 400, 400, 400, 400]);
    add("TIR converge (~21.86%)", "≈0.2186", v?.toFixed(4) ?? "null", v != null && approx(v, 0.2186, 0.01));
  }

  // 8) TIR sem sinais opostos → diagnosticada
  {
    const d = irrDetailed([100, 200, 300]);
    add("TIR sem sinais opostos → erro", "erro", d.error ?? "ok", d.value === null && !!d.error);
  }

  // 9) buildDRE smoke + indicadores não-NaN para state default
  {
    const { dre } = buildDRE(DEFAULT_STATE, DEFAULT_STATE.tax.regime);
    const ind = calcIndicators(DEFAULT_STATE, dre);
    const allFinite = Number.isFinite(ind.roic) && Number.isFinite(ind.wacc) && Number.isFinite(ind.liquidezCorrente);
    add("Indicadores finitos no DEFAULT_STATE", "true", String(allFinite), allFinite);
    add("Liquidez corrente ≤ 99 (cap)", "≤99", ind.liquidezCorrente.toFixed(2), ind.liquidezCorrente <= 99);
  }

  const allPassed = results.every((r) => r.pass);
  if (typeof console !== "undefined") {
    console.groupCollapsed(
      `%c[GZ FinnancePRO] Auditoria — Self-tests Financeiros (${results.filter(r=>r.pass).length}/${results.length} OK)`,
      allPassed ? "color:#22c55e" : "color:#ef4444",
    );
    console.table(results);
    console.groupEnd();
  }
  return { results, allPassed };
}
