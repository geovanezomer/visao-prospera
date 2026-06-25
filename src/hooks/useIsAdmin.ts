// ============================================================================
// useIsAdmin — true quando o e-mail do usuário corrente bate com ADMIN_EMAIL.
// Apenas para gating de UI; toda mutação admin é revalidada no servidor.
// ============================================================================

import { useAuth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin/constants";

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return isAdminEmail(user?.email);
}
