// ============================================================================
// useIsAdmin — gating de UI para o painel admin.
//
// Consulta `public.has_role(uid, 'admin')` diretamente via RPC autenticado
// (o RPC é SECURITY DEFINER e tem GRANT EXECUTE para `authenticated`).
// Evita dependência de server fn + middleware de bearer no runtime do VPS,
// que já causou o botão sumir mesmo com o papel correto no banco.
// Toda mutação admin é revalidada no servidor por `assertAdmin`.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["rbac", "isAdmin", user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (error) {
        console.warn("[useIsAdmin] has_role RPC falhou:", error.message);
        return false;
      }
      return data === true;
    },
  });
  return data === true;
}
