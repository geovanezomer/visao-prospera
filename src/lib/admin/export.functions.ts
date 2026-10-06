// ============================================================================
// Export de usuários em CSV.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { requireAuth } from "@/lib/requireAuth";
import { desc, inArray } from "drizzle-orm";
import { actorEmail } from "./_types";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}

export const exportUsersCsv = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { listAppUsers } = await import("@/lib/users.server");
    const { db, schema } = await import("@/db/client.server");

    const all = await listAppUsers();
    const ids = all.map((u) => u.id);
    const t = schema.subscriptions;
    const subs = ids.length
      ? await db()
          .select({
            userId: t.userId,
            plan: t.plan,
            status: t.status,
            currentPeriodEnd: t.currentPeriodEnd,
            provider: t.provider,
          })
          .from(t)
          .where(inArray(t.userId, ids))
          .orderBy(desc(t.createdAt))
      : [];
    type SubRow = (typeof subs)[number];
    const sub = new Map<string, SubRow>();
    for (const s of subs) if (!sub.has(s.userId)) sub.set(s.userId, s);

    const headers = [
      "id",
      "email",
      "display_name",
      "phone",
      "created_at",
      "last_sign_in_at",
      "active",
      "plan",
      "status",
      "current_period_end",
      "provider",
    ];
    const lines = [headers.join(",")];
    for (const u of all) {
      const s = sub.get(u.id);
      lines.push(
        [
          u.id,
          u.email,
          u.name,
          "",
          u.createdAt,
          u.lastSignInAt ?? "",
          u.banned ? "false" : "true",
          s?.plan ?? "",
          s?.status ?? "",
          s?.currentPeriodEnd ?? "",
          s?.provider ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "users.export_csv",
      resource: "user",
      metadata: { rows: all.length },
    });

    return { csv: lines.join("\n"), rows: all.length };
  });
