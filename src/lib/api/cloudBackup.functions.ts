// ============================================================================
// Backup em nuvem dos arquivos .finnance — server functions.
//
// Substitui o bucket "backups" do Supabase Storage: o conteúdo vai para a
// tabela `cloud_backups` (um registro por usuário + nome de arquivo).
// Sempre opera sobre o usuário da sessão — nunca sobre um id vindo do cliente.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";

/** Limite duro por arquivo: 2 MiB (UTF-8). */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

/**
 * Nome de arquivo aceito: 1–200 caracteres, sem barras, sem caracteres de
 * controle e sem `..` (nada que pareça caminho).
 */
// eslint-disable-next-line no-control-regex
const FILENAME_RE = /^[^/\\\u0000-\u001f\u007f]{1,200}$/;
export function isValidBackupFilename(name: string): boolean {
  return FILENAME_RE.test(name) && !name.includes("..") && name.trim() === name && name !== "";
}

const filenameSchema = z.string().refine(isValidBackupFilename, "nome de arquivo inválido");

const uploadSchema = z
  .object({
    filename: filenameSchema,
    content: z.string(),
  })
  .superRefine((d, ctx) => {
    const bytes = new TextEncoder().encode(d.content).length;
    if (bytes > MAX_BACKUP_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: `backup excede o limite de ${Math.round(MAX_BACKUP_BYTES / 1024)} KiB (recebido: ${Math.round(bytes / 1024)} KiB).`,
      });
    }
  });

async function dbx() {
  const { db, schema } = await import("@/db/client.server");
  const orm = await import("drizzle-orm");
  return { db: db(), t: schema.cloudBackups, orm };
}

export const uploadBackupFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: unknown) => uploadSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { db, t } = await dbx();
    const now = new Date().toISOString();
    await db
      .insert(t)
      .values({
        userId: context.userId,
        filename: data.filename,
        content: data.content,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [t.userId, t.filename],
        set: { content: data.content, updatedAt: now },
      });
    return { ok: true as const, updatedAt: now };
  });

export const listBackupsFn = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, t, orm } = await dbx();
    const rows = await db
      .select({ name: t.filename, updatedAt: t.updatedAt })
      .from(t)
      .where(orm.eq(t.userId, context.userId))
      .orderBy(orm.desc(t.updatedAt));
    return rows.map((r) => ({ name: r.name, updatedAt: r.updatedAt ?? null }));
  });

export const downloadBackupFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: unknown) => z.object({ filename: filenameSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, t, orm } = await dbx();
    const [row] = await db
      .select({ content: t.content })
      .from(t)
      .where(orm.and(orm.eq(t.userId, context.userId), orm.eq(t.filename, data.filename)))
      .limit(1);
    if (!row) throw new Error("BACKUP_NOT_FOUND");
    return { content: row.content };
  });

export const deleteBackupFn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: unknown) => z.object({ filename: filenameSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, t, orm } = await dbx();
    await db
      .delete(t)
      .where(orm.and(orm.eq(t.userId, context.userId), orm.eq(t.filename, data.filename)));
    return { ok: true as const };
  });
