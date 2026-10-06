// ============================================================================
// Conversão para reais de empresas do grupo em outra moeda (CPC 02 / IAS 21).
//
//  - Resultado (DRE): movimento do mês × cotação MÉDIA do mês.
//  - Balanço: saldo do fim de cada mês × cotação do FIM do mês; o movimento
//    convertido é a diferença entre saldos convertidos.
//  - A diferença que sobra (variação cambial sobre o patrimônio) vai para o
//    PL como "Ajuste acumulado de conversão", e o balancete continua zerando.
//
// As cotações vêm do próprio Odoo (res.currency.rate, inverse_company_rate =
// reais por 1 unidade da moeda) e a conversão é feita na sincronização.
// ============================================================================
import type {
  OdooAccountSnapshot,
  OdooCompanySnapshot,
  OdooFxInfo,
  OdooFxRates,
  OdooSnapshot,
} from "./types";

export type FxRateRecord = { currency: string; date: string; brlPerUnit: number };

const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const daysOf = (ym: string) => Number(lastDay(ym).slice(8, 10));

/**
 * Tabela de cotações por mês a partir dos registros do Odoo. Vale a última
 * cotação na data ou antes dela (como o Odoo faz); a média do mês pondera
 * cada cotação pelos dias em que vigorou. Sem cotação até o fim da janela →
 * a moeda fica de fora (null).
 */
export function buildFxRates(records: FxRateRecord[], months: string[]): OdooFxRates | null {
  const rs = records.filter((r) => r.brlPerUnit > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!rs.length || !months.length) return null;
  const at = (date: string): number | null => {
    let v: number | null = null;
    for (const r of rs) {
      if (r.date > date) break;
      v = r.brlPerUnit;
    }
    return v;
  };
  const avg: number[] = [];
  const end: number[] = [];
  for (const ym of months) {
    const n = daysOf(ym);
    let soma = 0;
    let dias = 0;
    for (let d = 1; d <= n; d++) {
      const v = at(`${ym}-${String(d).padStart(2, "0")}`);
      if (v !== null) {
        soma += v;
        dias++;
      }
    }
    const fim = at(lastDay(ym));
    if (fim === null || dias === 0) return null;
    avg.push(soma / dias);
    end.push(fim);
  }
  const [y, m] = months[0].split("-").map(Number);
  const antes = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  // Sem cotação antes da janela: usa a primeira disponível para a abertura.
  const opening = at(antes) ?? rs[0].brlPerUnit;
  return { avg, end, opening };
}

function convertAccount(
  a: Pick<OdooAccountSnapshot, "monthly" | "opening">,
  fx: OdooFxRates,
  balanco: boolean,
): { monthly: number[]; opening: number } {
  const opening = a.opening * fx.opening;
  if (!balanco) return { opening, monthly: a.monthly.map((v, i) => v * (fx.avg[i] ?? 0)) };
  let saldo = a.opening;
  let anterior = opening;
  const monthly = a.monthly.map((v, i) => {
    saldo += v;
    const conv = saldo * (fx.end[i] ?? 0);
    const mov = conv - anterior;
    anterior = conv;
    return mov;
  });
  return { opening, monthly };
}

export const CTA_CODE = "CTA";

/** Converte uma empresa para BRL e lança o ajuste de conversão no PL. */
export function convertCompany(comp: OdooCompanySnapshot, fx: OdooFxRates): OdooCompanySnapshot {
  const n = fx.avg.length;
  const kind = new Map(comp.accounts.map((a) => [a.code, a.cls.kind]));
  const accounts = comp.accounts.map((a) => ({
    ...a,
    ...convertAccount(a, fx, a.cls.kind === "bs"),
  }));
  // Balancete em reais: a soma de tudo precisa continuar zero.
  const ctaMonthly = Array.from(
    { length: n },
    (_, i) => -accounts.reduce((s, a) => s + (a.monthly[i] ?? 0), 0),
  );
  const ctaOpening = -accounts.reduce((s, a) => s + a.opening, 0);
  if (ctaMonthly.some((v) => Math.abs(v) > 0.005) || Math.abs(ctaOpening) > 0.005)
    accounts.push({
      id: -1,
      code: CTA_CODE,
      name: "Ajuste acumulado de conversão (CPC 02)",
      type: "equity",
      cls: { kind: "bs", bucket: "reservas" },
      monthly: ctaMonthly,
      opening: ctaOpening,
    });
  return {
    ...comp,
    accounts,
    intercompany: {
      lines: comp.intercompany.lines.map((l) => ({
        ...l,
        ...convertAccount(l, fx, kind.get(l.code) === "bs"),
      })),
    },
    products: comp.products?.map((p) => ({
      ...p,
      revenue: p.revenue.map((v, i) => v * (fx.avg[i] ?? 0)),
      cogs: p.cogs.map((v, i) => v * (fx.avg[i] ?? 0)),
    })),
  };
}

/** Converte para BRL as empresas em outra moeda que tenham cotação. */
export function convertSnapshotToBrl(
  snapshot: OdooSnapshot,
  rates: Record<string, OdooFxRates | null>,
): OdooSnapshot {
  const fx: OdooFxInfo = { base: "BRL", rates: {}, converted: {}, missing: {} };
  const perCompany = { ...snapshot.perCompany };
  for (const c of snapshot.companies) {
    const cur = (c.currency || "BRL").toUpperCase();
    if (cur === "BRL" || !perCompany[String(c.id)]) continue;
    const r = rates[cur];
    if (!r) {
      fx.missing[String(c.id)] = cur;
      continue;
    }
    fx.rates[cur] = r;
    fx.converted[String(c.id)] = cur;
    perCompany[String(c.id)] = convertCompany(perCompany[String(c.id)], r);
  }
  if (!Object.keys(fx.converted).length && !Object.keys(fx.missing).length) return snapshot;
  return { ...snapshot, perCompany, fx };
}
