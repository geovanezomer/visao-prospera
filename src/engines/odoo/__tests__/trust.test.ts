import { describe, expect, it } from "vitest";
import { classifyAccount } from "../mapping";
import { buildEntityData, listEntities } from "../toAppState";
import { computeTrust } from "../trust";
import type { OdooAccountSnapshot, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7),
); // 2025-10 … 2026-09
const flat = (v: number) => MONTHS.map(() => v);
const acc = (id: number, code: string, name: string, type: string, m: number[], o = 0) =>
  ({
    id,
    code,
    name,
    type,
    cls: classifyAccount({ code, name, type }),
    monthly: m,
    opening: o,
  }) as OdooAccountSnapshot;

/** Empresa equilibrada: vende 1.000/mês à vista, capital 5.000 em caixa. */
function snap(): OdooSnapshot {
  return {
    version: 1,
    syncedAt: new Date().toISOString(),
    serverVersion: "20.0",
    months: MONTHS,
    companies: [
      {
        id: 1,
        name: "Alfa",
        vat: "1",
        parentId: null,
        partnerId: 9,
        currency: "BRL",
        lockDate: "2026-09-30",
      },
    ],
    perCompany: {
      "1": {
        accounts: [
          acc(1, "1.01.01.01.01.01", "Caixa", "asset_cash", flat(1_000), 5_000),
          acc(2, "3.01.01.01.01.04", "Vendas", "income", flat(-1_000)),
          acc(3, "2.03.01.01.01.01", "Capital", "equity", flat(0), -5_000),
        ],
        intercompany: { lines: [] },
        draftCount: 0,
      },
    },
  };
}

const run = (s: OdooSnapshot, lastError: string | null = null) => {
  const e = listEntities(s)[0];
  return computeTrust(s, e, buildEntityData(s, e), { lastError });
};

describe("computeTrust", () => {
  it("retrato íntegro e recente → verde", () => {
    const r = run(snap());
    expect(r.checks.filter((c) => c.level !== "ok").map((c) => c.id)).toEqual([]);
    expect(r.level).toBe("ok");
  });

  it("conta com saldo marcada como ignorar → vermelho e balanço não fecha", () => {
    const s = snap();
    s.perCompany["1"].accounts[0].cls = { kind: "ignore" };
    const r = run(s);
    expect(r.level).toBe("error");
    expect(r.checks.find((c) => c.id === "classification")?.level).toBe("error");
    expect(r.checks.find((c) => c.id === "bs-closes")?.level).toBe("error");
  });

  it("falha de sincronização, rascunhos e receita negativa (encerramento) são sinalizados", () => {
    const s = snap();
    s.perCompany["1"].draftCount = 3;
    s.perCompany["1"].accounts[1].monthly[11] = 11_000; // estorno de encerramento em set
    s.perCompany["1"].accounts[0].monthly[11] = -11_000;
    const r = run(s, "Chave de API recusada.");
    const lv = (id: string) => r.checks.find((c) => c.id === id)?.level;
    expect(lv("sync-error")).toBe("error");
    expect(lv("drafts")).toBe("warn");
    expect(lv("closing-entries")).toBe("warn");
  });

  it("balancete desequilibrado → vermelho", () => {
    const s = snap();
    s.perCompany["1"].accounts[0].opening = 6_000;
    expect(run(s).checks.find((c) => c.id === "trial-balance")?.level).toBe("error");
  });
});
