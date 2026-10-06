// Server functions para criar / ler / revogar links de compartilhamento
// somente leitura do FinnancePRO.
//
// Fluxo:
//   - createShareLink (autenticada): recebe o payload .finnance serializado,
//     gera shareId aleatório e grava a linha em shared_reports (payload jsonb).
//   - getSharedReport (pública): valida revoked/expires e devolve o payload
//     para a rota /shared/$shareId renderizar read-only.
//   - revokeShareLink (autenticada): marca revoked_at = now() no próprio link.
//
// O banco é importado dinamicamente dentro dos handlers para não vazar
// código de servidor no bundle do cliente.

import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/lib/requireAuth";
import { z } from "zod";

async function dbx() {
  const { db, schema } = await import("@/db/client.server");
  const orm = await import("drizzle-orm");
  return { db: db(), t: schema.sharedReports, orm };
}

/** Gera um shareId curto, URL-safe (12 chars base36). */
function generateShareId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

/**
 * Limite duro de tamanho do payload (P4-03): 2 MiB serializados.
 * Um snapshot .finnance típico tem 50–300 KiB; 2 MiB já cobre cenários
 * extremos e bloqueia uploads abusivos (DoS / custo de storage).
 */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

const createSchema = z
  .object({
    // payload .finnance já serializado (objeto JSON).
    payload: z
      .unknown()
      .refine((v) => v != null && typeof v === "object", "payload deve ser um objeto JSON"),
    companyName: z.string().min(1).max(200),
  })
  .superRefine((d, ctx) => {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(d.payload)).length;
      if (bytes > MAX_PAYLOAD_BYTES) {
        ctx.addIssue({
          code: "custom",
          path: ["payload"],
          message: `payload excede o limite de ${Math.round(MAX_PAYLOAD_BYTES / 1024)} KiB (recebido: ${Math.round(bytes / 1024)} KiB).`,
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["payload"],
        message: "payload não-serializável",
      });
    }
  });

/** Padrão: 30 dias de validade do link público (revogável a qualquer momento). */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Enforcement server-side: só assinantes ativos (ou trial válido) podem gerar links.
    const { requireActiveSubscription } = await import("@/lib/requireActiveSubscription.server");
    await requireActiveSubscription(context.userId);
    const { db, t } = await dbx();
    const shareId = generateShareId();
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
    try {
      await db.insert(t).values({
        shareId,
        ownerId: context.userId,
        companyName: data.companyName,
        payload: data.payload as object,
        expiresAt,
      });
    } catch (e) {
      throw new Error(`Falha ao registrar link: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { shareId, expiresAt };
  });

const getSchema = z.object({ shareId: z.string().min(4).max(64) });

export const getSharedReport = createServerFn({ method: "GET" })
  .validator((d: unknown) => getSchema.parse(d))
  .handler(async ({ data }) => {
    const { db, t, orm } = await dbx();
    const [row] = await db
      .select({
        payload: t.payload,
        companyName: t.companyName,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
      })
      .from(t)
      .where(orm.eq(t.shareId, data.shareId))
      .limit(1);
    if (!row) throw new Error("LINK_NOT_FOUND");
    if (row.revokedAt) throw new Error("LINK_REVOKED");
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      throw new Error("LINK_EXPIRED");
    }

    return {
      // jsonb volta como objeto; o formato é validado por parseFinnanceFile na rota.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: row.payload as any,
      companyName: row.companyName,
      expiresAt: row.expiresAt ?? null,
    };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: unknown) => getSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { db, t, orm } = await dbx();
    await db
      .update(t)
      .set({ revokedAt: new Date().toISOString() })
      .where(orm.and(orm.eq(t.shareId, data.shareId), orm.eq(t.ownerId, context.userId)));
    return { ok: true };
  });

/**
 * Lista os links de compartilhamento ATIVOS do usuário logado
 * (não revogados e não expirados). Usado pelo ícone na header
 * para abrir o gerenciador de links compartilhados.
 */
export const listShareLinks = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, t, orm } = await dbx();
    const nowIso = new Date().toISOString();
    const rows = await db
      .select({
        shareId: t.shareId,
        companyName: t.companyName,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
      })
      .from(t)
      .where(
        orm.and(
          orm.eq(t.ownerId, context.userId),
          orm.isNull(t.revokedAt),
          orm.or(orm.isNull(t.expiresAt), orm.gt(t.expiresAt, nowIso)),
        ),
      )
      .orderBy(orm.desc(t.createdAt));
    return rows.map((r) => ({
      shareId: r.shareId,
      companyName: r.companyName,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt ?? null,
    }));
  });

/**
 * Atualiza o prazo de expiração de um link compartilhado.
 * `expiresAt` deve ser um ISO 8601 futuro; `null` remove a expiração.
 */
const updateExpirationSchema = z.object({
  shareId: z.string().min(4).max(64),
  expiresAt: z.string().datetime().nullable(),
});

export const updateShareExpiration = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: unknown) => updateExpirationSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
      throw new Error("A nova expiração deve estar no futuro");
    }
    const { db, t, orm } = await dbx();
    await db
      .update(t)
      .set({ expiresAt: data.expiresAt })
      .where(orm.and(orm.eq(t.shareId, data.shareId), orm.eq(t.ownerId, context.userId)));
    return { ok: true, expiresAt: data.expiresAt };
  });
