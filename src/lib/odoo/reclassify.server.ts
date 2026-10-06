// Reaplica a classificação de contas no retrato mais recente — usado quando o
// admin ajusta o mapeamento, para valer na hora sem consultar o Odoo.
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { classifyAccount } from "@/engines/odoo/mapping";
import type { OdooSnapshot } from "@/engines/odoo/types";
import { loadOverrides } from "./sync.server";

type CompanyPayload = OdooSnapshot["perCompany"][string];

export async function reclassifyLatestSnapshot(): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.odooSnapshots.id, payload: schema.odooSnapshots.payload })
    .from(schema.odooSnapshots)
    .where(eq(schema.odooSnapshots.status, "ok"))
    .orderBy(desc(schema.odooSnapshots.syncedAt))
    .limit(1);
  if (!row?.payload) return false;
  const head = row.payload as OdooSnapshot & { storage?: string };
  const overrides = await loadOverrides();
  const reclass = (comp: CompanyPayload) => {
    for (const a of comp.accounts) {
      a.cls = classifyAccount({ code: a.code, name: a.name, type: a.type }, overrides);
    }
  };
  await db().transaction(async (tx) => {
    if (head.storage === "per-company") {
      const rows = await tx
        .select()
        .from(schema.odooSnapshotCompanies)
        .where(eq(schema.odooSnapshotCompanies.snapshotId, row.id));
      for (const r of rows) {
        const comp = r.payload as CompanyPayload;
        reclass(comp);
        await tx
          .update(schema.odooSnapshotCompanies)
          .set({ payload: comp })
          .where(
            and(
              eq(schema.odooSnapshotCompanies.snapshotId, row.id),
              eq(schema.odooSnapshotCompanies.companyId, r.companyId),
            ),
          );
      }
    } else {
      for (const comp of Object.values(head.perCompany ?? {})) reclass(comp);
    }
    // Nova revisão: os navegadores abertos recarregam o retrato.
    head.revisedAt = new Date().toISOString();
    await tx
      .update(schema.odooSnapshots)
      .set({ payload: head })
      .where(eq(schema.odooSnapshots.id, row.id));
  });
  return true;
}
