// ============================================================================
// Admin · Sessões ativas. Usa Supabase Auth Admin para revogar tokens.
// Listagem inferida via `last_sign_in_at` + identidades; revogação global
// usa signOut com escopo `global`.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";

function assertAdmin(claims: any) {
  if (!isAdminEmail((claims?.email as string) ?? "")) throw new Error("Acesso negado.");
}

export type UserSession = {
  userId: string;
  email: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  identities: Array<{ provider: string; createdAt: string | null; lastSignInAt: string | null }>;
};

export const getUserSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (error || !u?.user) throw new Error(error?.message ?? "Usuário não encontrado.");
    const user = u.user as any;
    const session: UserSession = {
      userId: user.id,
      email: user.email ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      createdAt: user.created_at,
      identities: (user.identities ?? []).map((i: any) => ({
        provider: i.provider,
        createdAt: i.created_at ?? null,
        lastSignInAt: i.last_sign_in_at ?? null,
      })),
    };
    return session;
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `signOut` no admin client revoga todos os refresh tokens do usuário.
    const { error } = await (supabaseAdmin.auth.admin as any).signOut(data.userId, "global");
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as any)?.email,
      action: "user.sessions_revoked",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });
