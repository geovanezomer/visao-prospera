// ============================================================================
// Admin · User Notes (CRM leve) — apenas admin lê/escreve.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { desc, eq } from "drizzle-orm";
import { actorEmail } from "./_types";

export type UserNote = {
  id: string;
  userId: string;
  authorId: string | null;
  authorEmail: string | null;
  body: string;
  pinned: boolean;
  createdAt: string;
};

type DbNoteRow = {
  id: string;
  userId: string;
  authorId: string | null;
  authorEmail: string | null;
  body: string;
  pinned: boolean;
  createdAt: string;
};

function rowToNote(r: DbNoteRow): UserNote {
  return {
    id: r.id,
    userId: r.userId,
    authorId: r.authorId,
    authorEmail: r.authorEmail,
    body: r.body,
    pinned: r.pinned,
    createdAt: r.createdAt,
  };
}

export const listUserNotes = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.userNotes;
    const rows = await db()
      .select()
      .from(t)
      .where(eq(t.userId, data.userId))
      .orderBy(desc(t.pinned), desc(t.createdAt));
    return { notes: rows.map(rowToNote) };
  });

export const createUserNote = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string; body: string }) =>
    z.object({ userId: z.string().uuid(), body: z.string().min(1).max(4000) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const [row] = await db()
      .insert(schema.userNotes)
      .values({
        userId: data.userId,
        authorId: context.userId,
        authorEmail: actorEmail(context),
        body: data.body,
      })
      .returning();
    return { note: row ? rowToNote(row) : null };
  });

export const toggleNotePin = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { id: string; pinned: boolean }) =>
    z.object({ id: z.string().uuid(), pinned: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    await db()
      .update(schema.userNotes)
      .set({ pinned: data.pinned })
      .where(eq(schema.userNotes.id, data.id));
    return { ok: true };
  });

export const deleteUserNote = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    await db().delete(schema.userNotes).where(eq(schema.userNotes.id, data.id));
    return { ok: true };
  });
