// Reaplica a classificação de contas no retrato mais recente — usado quando o
// admin ajusta o mapeamento, para valer na hora sem consultar o Odoo.
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { classifyAccount } from "@/engines/odoo/mapping";
import type { OdooSnapshot } from "@/engines/odoo/types";
import { loadOverrides } from "./sync.server";

export async function reclassifyLatestSnapshot(): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.odooSnapshots.id, payload: schema.odooSnapshots.payload })
    .from(schema.odooSnapshots)
    .where(eq(schema.odooSnapshots.status, "ok"))
    .orderBy(desc(schema.odooSnapshots.syncedAt))
    .limit(1);
  if (!row?.payload) return false;
  const snap = row.payload as OdooSnapshot;
  const overrides = await loadOverrides();
  for (const comp of Object.values(snap.perCompany)) {
    for (const a of comp.accounts) {
      a.cls = classifyAccount({ code: a.code, name: a.name, type: a.type }, overrides);
    }
  }
  await db()
    .update(schema.odooSnapshots)
    .set({ payload: snap })
    .where(eq(schema.odooSnapshots.id, row.id));
  return true;
}
