// Conversão para reais (CPC 02): DRE pela média, balanço pelo fim do mês,
// variação cambial no PL e balancete zerando.
import { describe, expect, it } from "vitest";
import { buildFxRates, convertCompany, convertSnapshotToBrl, CTA_CODE } from "../fx";
import { classifyAccount } from "../mapping";
import { buildEntityData, listEntities } from "../toAppState";
import { reconcile } from "../reconcile";
import { computeTrust } from "../trust";
import type { OdooAccountSnapshot, OdooCompanySnapshot, OdooFxRates, OdooSnapshot } from "../types";

const MONTHS = ["2026-01", "2026-02", "2026-03"];

describe("buildFxRates", () => {
  it("média do mês ponderada pelos dias de vigência; fim do mês; abertura", () => {
    const r = buildFxRates(
      [
        { currency: "USD", date: "2025-12-20", brlPerUnit: 5 },
        { currency: "USD", date: "2026-01-16", brlPerUnit: 6 }, // vale de 16 a 31/jan
        { currency: "USD", date: "2026-03-01", brlPerUnit: 5.5 },
      ],
      MONTHS,
    )!;
    // Janeiro: 15 dias a 5 e 16 dias a 6 → (75 + 96) / 31
    expect(r.avg[0]).toBeCloseTo(171 / 31, 10);
    expect(r.end).toEqual([6, 6, 5.5]);
    expect(r.avg[1]).toBe(6);
    expect(r.opening).toBe(5); // 31/12/2025
  });

  it("sem cotação no período: null", () => {
    expect(buildFxRates([{ currency: "USD", date: "2026-02-10", brlPerUnit: 5 }], MONTHS)).toBe(
      null,
    );
    expect(buildFxRates([], MONTHS)).toBe(null);
  });
});

const acc = (
  code: string,
  name: string,
  type: string,
  monthly: number[],
  opening = 0,
): OdooAccountSnapshot => ({
  id: 1,
  code,
  name,
  type,
  cls: classifyAccount({ code, name, type }),
  monthly,
  opening,
});

// Empresa em dólar: abertura caixa 1.000 = capital 1.000; vende 100/mês à vista.
const usdCompany = (): OdooCompanySnapshot => ({
  accounts: [
    acc("1.01.01.01.01.01", "Caixa", "asset_cash", [100, 100, 100], 1_000),
    acc("3.01.01.01.01.04", "Receita de vendas", "income", [-100, -100, -100]),
    acc("2.03.01.01.01.01", "Capital social", "equity", [0, 0, 0], -1_000),
  ],
  intercompany: { lines: [] },
});
const fx: OdooFxRates = { avg: [5, 5.2, 5.4], end: [5.1, 5.3, 5.5], opening: 5 };

describe("convertCompany", () => {
  it("receita pela média, caixa pelo fim do mês e balancete em reais zerando", () => {
    const c = convertCompany(usdCompany(), fx);
    const by = (code: string) => c.accounts.find((a) => a.code === code)!;
    expect(by("3.01.01.01.01.04").monthly).toEqual([-500, -520, -540]);
    // Caixa: saldos 1.100/1.200/1.300 USD × 5,1/5,3/5,5 = 5.610/6.360/7.150
    const caixa = by("1.01.01.01.01.01");
    expect(caixa.opening).toBe(5_000);
    expect(caixa.monthly.map((v) => Math.round(v * 100) / 100)).toEqual([610, 750, 790]);
    // Capital social (PL) também pelo fim do mês na abordagem simplificada.
    const total = (i: number) => c.accounts.reduce((s, a) => s + a.monthly[i], 0);
    for (const i of [0, 1, 2]) expect(total(i)).toBeCloseTo(0, 6);
    expect(c.accounts.reduce((s, a) => s + a.opening, 0)).toBeCloseTo(0, 6);
    const cta = by(CTA_CODE);
    expect(cta.cls).toEqual({ kind: "bs", bucket: "reservas" });
  });
});

function snapshotGrupo(comFx: boolean): OdooSnapshot {
  const brl: OdooCompanySnapshot = {
    accounts: [
      acc("1.01.01.01.01.01", "Caixa", "asset_cash", [1_000, 1_000, 1_000], 10_000),
      acc("3.01.01.01.01.04", "Receita de vendas", "income", [-1_000, -1_000, -1_000]),
      acc("2.03.01.01.01.01", "Capital social", "equity", [0, 0, 0], -10_000),
    ],
    intercompany: { lines: [] },
  };
  const s: OdooSnapshot = {
    version: 1,
    syncedAt: "2026-04-05T00:00:00Z",
    serverVersion: "20.0",
    months: MONTHS,
    companies: [
      {
        id: 1,
        name: "Matriz BR",
        vat: "11222333000181",
        parentId: null,
        partnerId: 11,
        currency: "BRL",
        lockDate: null,
      },
      {
        id: 2,
        name: "Sub USA",
        vat: null,
        parentId: null,
        partnerId: 12,
        currency: "USD",
        lockDate: null,
      },
    ],
    perCompany: { "1": brl, "2": usdCompany() },
  };
  return convertSnapshotToBrl(s, comFx ? { USD: fx } : { USD: null });
}

describe("convertSnapshotToBrl", () => {
  it("grupo com subsidiária em dólar: consolida em reais e a conciliação fecha", () => {
    const s = snapshotGrupo(true);
    expect(s.fx?.converted).toEqual({ "2": "USD" });
    const g = listEntities(s).find((e) => e.key === "group")!;
    const data = buildEntityData(s, g, "2026-03");
    // Receita: 3.000 (BR) + 500 + 520 + 540 (USD convertidos)
    expect(data.actuals.pl.receita_bruta.reduce((a, b) => a + b, 0)).toBeCloseTo(4_560, 6);
    const r = reconcile(s, g, data);
    expect(r.balanceteDiferenca).toBe(0);
    expect(r.ok).toBe(true);
    const trust = computeTrust(s, g, data, { lastError: null });
    expect(trust.checks.find((c) => c.id === "currency")?.level).toBe("warn");
  });

  it("sem cotação: não converte e a luz de moeda fica vermelha", () => {
    const s = snapshotGrupo(false);
    expect(s.fx?.missing).toEqual({ "2": "USD" });
    expect(s.perCompany["2"].accounts[1].monthly).toEqual([-100, -100, -100]);
    const g = listEntities(s).find((e) => e.key === "group")!;
    const trust = computeTrust(s, g, buildEntityData(s, g, "2026-03"), { lastError: null });
    expect(trust.checks.find((c) => c.id === "currency")?.level).toBe("error");
  });

  it("grupo só em reais: retrato intacto", () => {
    const s = snapshotGrupo(true);
    const soBrl = { ...s, companies: [s.companies[0]], fx: undefined };
    expect(convertSnapshotToBrl(soBrl, {})).toBe(soBrl);
  });
});
