// ============================================================================
// Admin · Sessões ativas. Usa Supabase Auth Admin para revogar tokens.
// Listagem inferida via `last_sign_in_at` + identidades; revogação global
// usa signOut com escopo `global`.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

export type UserSession = {
  userId: string;
  email: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  identities: Array<{ provider: string; createdAt: string | null; lastSignInAt: string | null }>;
};

export const getUserSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (error || !u?.user) throw new Error(error?.message ?? "Usuário não encontrado.");
    const user = u.user;
    const session: UserSession = {
      userId: user.id,
      email: user.email ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      createdAt: user.created_at,
      identities: (user.identities ?? []).map((i) => ({
        provider: i.provider,
        createdAt: i.created_at ?? null,
        lastSignInAt: i.last_sign_in_at ?? null,
      })),
    };
    return session;
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `signOut(userId, scope)` é admin-only e exposta como helper sem
    // tipagem pública. Mantemos um cast estreito para a assinatura.
    type AdminSignOut = (
      userId: string,
      scope: "global" | "local",
    ) => Promise<{ error: { message: string } | null }>;
    const adminAuth = supabaseAdmin.auth.admin as unknown as { signOut: AdminSignOut };
    const { error } = await adminAuth.signOut(data.userId, "global");
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "user.sessions_revoked",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });
