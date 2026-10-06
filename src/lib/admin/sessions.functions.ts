// ============================================================================
// Admin · Sessões ativas do usuário (tabela `session` do Better Auth).
// Lista as sessões não expiradas e permite revogar uma ou todas.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/requireAuth";
import { actorEmail } from "./_types";

export type ActiveSession = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};

export type UserSession = {
  userId: string;
  email: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  /** Formas de login disponíveis: "senha" (conta credential) e "magic link". */
  loginMethods: string[];
  sessions: ActiveSession[];
};

export const getUserSessions = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<UserSession> => {
    await assertAdmin(context);
    const { getAppUser, listUserSessions } = await import("@/lib/users.server");
    const { db, schema } = await import("@/db/client.server");
    const user = await getAppUser(data.userId);
    if (!user) throw new Error("Usuário não encontrado.");
    const [cred] = await db()
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(
        and(eq(schema.account.userId, data.userId), eq(schema.account.providerId, "credential")),
      )
      .limit(1);
    const now = Date.now();
    const sessions = (await listUserSessions(data.userId))
      .filter((s) => s.expiresAt.getTime() > now)
      .map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      }));
    return {
      userId: user.id,
      email: user.email,
      lastSignInAt: user.lastSignInAt,
      createdAt: user.createdAt,
      loginMethods: cred ? ["senha", "magic link"] : ["magic link"],
      sessions,
    };
  });

export const revokeSession = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string; sessionId: string }) =>
    z.object({ userId: z.string().uuid(), sessionId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    await db()
      .delete(schema.session)
      .where(and(eq(schema.session.id, data.sessionId), eq(schema.session.userId, data.userId)));
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "user.session_revoked",
      resource: "user",
      targetId: data.userId,
      metadata: { sessionId: data.sessionId },
    });
    return { ok: true };
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { revokeUserSessions } = await import("@/lib/users.server");
    await revokeUserSessions(data.userId);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "user.sessions_revoked",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });
