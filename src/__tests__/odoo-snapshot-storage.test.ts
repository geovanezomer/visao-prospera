// Retrato do Odoo por empresa: leitura seletiva, formato antigo e reclassificação.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";
import { latestSnapshot, latestSnapshotMeta } from "@/lib/odoo/sync.server";
import { reclassifyLatestSnapshot } from "@/lib/odoo/reclassify.server";
import type { OdooSnapshot } from "@/engines/odoo/types";

const comp = (code: string) => ({
  accounts: [
    {
      id: 1,
      code,
      name: "Vendas",
      type: "income",
      cls: { kind: "ignore" },
      monthly: [-10],
      opening: 0,
    },
  ],
  intercompany: { lines: [] },
});
const header = (storage?: string) =>
  ({
    version: 1,
    syncedAt: "2026-09-01T00:00:00Z",
    serverVersion: "20",
    months: ["2026-08"],
    companies: [
      {
        id: 1,
        name: "A",
        vat: null,
        parentId: null,
        partnerId: 1,
        currency: "BRL",
        lockDate: null,
      },
      {
        id: 2,
        name: "B",
        vat: null,
        parentId: null,
        partnerId: 2,
        currency: "BRL",
        lockDate: null,
      },
    ],
    perCompany: storage ? {} : { "1": comp("3.01.01.01.01.01"), "2": comp("3.01.01.01.01.02") },
    ...(storage ? { storage } : {}),
  }) as unknown as OdooSnapshot;

describe("retrato do Odoo por empresa", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("lê só as empresas pedidas; [] traz só o cabeçalho", async () => {
    const [s] = await t.db
      .insert(schema.odooSnapshots)
      .values({ status: "ok", payload: header("per-company") })
      .returning({ id: schema.odooSnapshots.id });
    await t.db.insert(schema.odooSnapshotCompanies).values([
      { snapshotId: s.id, companyId: 1, payload: comp("3.01.01.01.01.01") },
      { snapshotId: s.id, companyId: 2, payload: comp("3.01.01.01.01.02") },
    ]);
    expect(Object.keys((await latestSnapshot([2]))!.payload.perCompany)).toEqual(["2"]);
    expect(Object.keys((await latestSnapshot([]))!.payload.perCompany)).toEqual([]);
    expect(Object.keys((await latestSnapshot())!.payload.perCompany).sort()).toEqual(["1", "2"]);
    const meta = await latestSnapshotMeta();
    expect(meta?.id).toBe(s.id); // id é UUID (texto), não número
  });

  it("formato antigo (tudo no cabeçalho) continua legível", async () => {
    await t.db.insert(schema.odooSnapshots).values({ status: "ok", payload: header() });
    expect(Object.keys((await latestSnapshot([1]))!.payload.perCompany)).toEqual(["1"]);
  });

  it("reclassificação regrava as empresas e muda a revisão", async () => {
    const [s] = await t.db
      .insert(schema.odooSnapshots)
      .values({ status: "ok", payload: header("per-company") })
      .returning({ id: schema.odooSnapshots.id });
    await t.db
      .insert(schema.odooSnapshotCompanies)
      .values([{ snapshotId: s.id, companyId: 1, payload: comp("3.01.01.01.01.01") }]);
    const antes = await latestSnapshotMeta();
    expect(await reclassifyLatestSnapshot()).toBe(true);
    const snap = await latestSnapshot([1]);
    expect(snap!.payload.perCompany["1"].accounts[0].cls).toEqual({
      kind: "pl",
      line: "receita_bruta",
    });
    expect((await latestSnapshotMeta())!.revision).not.toBe(antes!.revision);
  });
});
