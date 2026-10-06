// Sessão única: revoga TODAS as outras sessões do usuário autenticado,
// mantendo a atual. O cliente normalmente usa `authClient.revokeOtherSessions()`
// (Better Auth); esta server fn é o equivalente no servidor.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAuth } from "@/lib/requireAuth";

export const revokeOtherSessions = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { getSessionFromHeaders } = await import("@/lib/auth.server");
    const { db, schema } = await import("@/db/client.server");
    const { and, eq, ne } = await import("drizzle-orm");
    const request = getRequest();
    const current = request ? await getSessionFromHeaders(request.headers) : null;
    if (!current) return { ok: false, error: "sessão atual não encontrada" };
    try {
      await db()
        .delete(schema.session)
        .where(
          and(eq(schema.session.userId, context.userId), ne(schema.session.id, current.session.id)),
        );
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[revokeOtherSessions] falha:", msg);
      return { ok: false, error: msg };
    }
  });
