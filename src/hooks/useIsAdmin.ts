// ============================================================================
// useIsAdmin — gating de UI para o painel admin.
//
// Lê o papel direto da sessão (Better Auth), sem chamada de rede. É só uma
// dica de interface: toda operação admin é revalidada no servidor (assertAdmin).
// ============================================================================

import { useAuth } from "@/lib/auth";

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === "admin";
}
