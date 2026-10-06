// ============================================================================
// Server fns: leitura do admin_audit_log (apenas admin).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { requireAuth } from "@/lib/requireAuth";
import { toSnake, type Json } from "./_types";

export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (d: { page?: number; perPage?: number; search?: string; action?: string; resource?: string }) =>
      z
        .object({
          page: z.number().int().min(1).max(10000).optional(),
          perPage: z.number().int().min(1).max(200).optional(),
          search: z.string().max(120).optional(),
          action: z.string().max(80).optional(),
          resource: z.string().max(80).optional(),
        })
        .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.adminAuditLog;
    const page = data.page ?? 1;
    const perPage = data.perPage ?? 50;

    const conds = [];
    if (data.action) conds.push(eq(t.action, data.action));
    if (data.resource) conds.push(eq(t.resource, data.resource));
    if (data.search?.trim()) {
      const like = `%${data.search.trim()}%`;
      conds.push(
        or(ilike(t.actorEmail, like), ilike(t.targetId, like), ilike(t.targetLabel, like)),
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db()
        .select()
        .from(t)
        .where(where)
        .orderBy(desc(t.createdAt))
        .limit(perPage)
        .offset((page - 1) * perPage),
      db().select({ total: count() }).from(t).where(where),
    ]);
    return {
      rows: rows.map((r) => toSnake({ ...r, metadata: r.metadata as Json })),
      total: Number(total),
      page,
      perPage,
    };
  });
