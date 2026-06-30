// ============================================================================
// useIsAdmin — gating de UI para o painel admin.
//
// Antes: comparava `user.email` com `VITE_ADMIN_EMAIL` (exposto no bundle,
// permitindo enumeração). Agora: consulta `public.has_role(uid, 'admin')`
// via server fn. O resultado é cacheado (TanStack Query).
// Toda mutação admin é re-verificada no servidor por `assertAdmin`.
// ============================================================================

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { isCurrentUserAdmin } from "@/lib/admin/rbac.functions";

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["rbac", "isAdmin", user?.id ?? "anon"],
    queryFn: () => isCurrentUserAdmin(),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
  return data === true;
}
