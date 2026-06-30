// ============================================================================
// rbac.functions — checagens de papel para o cliente, sem expor e-mail
// do administrador no bundle (F-04). Backed by public.has_role no Postgres.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Retorna true se o usuário autenticado possui o papel `admin`
 * em `public.user_roles`. Usado apenas para gating de UI; toda mutação
 * admin é revalidada no servidor via `assertAdmin`.
 */
export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) return false;
    return data === true;
  });
