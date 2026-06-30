// ============================================================================
// assertAdmin — RBAC server-side via has_role('admin') no banco.
//
// Substitui a checagem antiga por e-mail (env var) por consulta ao
// public.user_roles, executada via função SECURITY DEFINER `public.has_role`.
//
// Uso (dentro de qualquer server fn admin*):
//   await assertAdmin(context);
//
// Lança Error("Acesso negado.") quando o usuário não possui o papel admin.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AdminCtx = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export async function assertAdmin(context: AdminCtx): Promise<void> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) {
    throw new Error("Acesso negado.");
  }
}
