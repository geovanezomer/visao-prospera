// ============================================================================
// Aceite dos Termos de Uso e da Política de Privacidade (LGPD, art. 8º: o
// controlador prova o consentimento). Cada usuário aceita a versão vigente;
// quando o admin altera os textos, a versão muda e o aceite é pedido de novo.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";

async function versaoVigente(): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { db, schema } = await import("@/db/client.server");
  const { eq } = await import("drizzle-orm");
  const [row] = await db()
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "legal"));
  const legal = (row?.value ?? {}) as { terms_html?: string; privacy_html?: string };
  // Textos padrão: versão fixa (o modelo padrão inclui a data do dia, que não é mudança).
  const base = `${legal.terms_html || "padrao-termos-v1"}\u0000${legal.privacy_html || "padrao-privacidade-v1"}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

export const getLegalStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, schema } = await import("@/db/client.server");
    const { and, eq } = await import("drizzle-orm");
    const version = await versaoVigente();
    const [row] = await db()
      .select({ acceptedAt: schema.legalAcceptances.acceptedAt })
      .from(schema.legalAcceptances)
      .where(
        and(
          eq(schema.legalAcceptances.userId, context.userId),
          eq(schema.legalAcceptances.version, version),
        ),
      )
      .limit(1);
    return { version, accepted: !!row, acceptedAt: row?.acceptedAt ?? null };
  });

export const acceptLegal = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ version: z.string().min(8).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const version = await versaoVigente();
    // Só vale o aceite da versão que está em vigor agora.
    if (data.version !== version) throw new Error("Os termos mudaram. Leia a versão atual.");
    const { db, schema } = await import("@/db/client.server");
    const { getRequest, getRequestHeader } = await import("@tanstack/react-start/server");
    const { clientIp } = await import("@/lib/rateLimit.server");
    await db()
      .insert(schema.legalAcceptances)
      .values({
        userId: context.userId,
        version,
        ip: clientIp(getRequest()).slice(0, 64),
        userAgent: (getRequestHeader("user-agent") ?? "").slice(0, 300) || null,
      })
      .onConflictDoNothing();
    return { ok: true, version };
  });
