// ============================================================================
// Hook useSubscription — consulta o plano ativo do usuário via server fn
// getMyActivePlan (sessão por cookie; o servidor filtra pelo usuário logado).
// Usa React Query com cache de 5 min — evita refetch em cada navegação
// e em cada componente que consome o hook (dedupe automático por queryKey).
// ============================================================================

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getMyActivePlan } from "@/lib/subscription.functions";

export type ActivePlan = {
  plan: string;
  status: string;
  current_period_end: string | null;
  provider: string;
  cancel_at_period_end: boolean;
} | null;

async function fetchActivePlan(): Promise<ActivePlan> {
  try {
    return (await getMyActivePlan()) ?? null;
  } catch (e) {
    console.warn("[useSubscription]", e instanceof Error ? e.message : e);
    return null;
  }
}

export function useSubscription() {
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuth();
  const userId = user?.id ?? null;

  // Chavear por userId evita reaproveitar cache de outra identidade
  // (ex.: null anônimo pré-login virando resposta "sem plano" no dashboard).
  const {
    data: plan = null,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["active_plan", userId],
    queryFn: fetchActivePlan,
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // Re-fetch apenas em transições de identidade (login/logout/troca de usuário).
  const prevUserRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!hydrated) return;
    if (prevUserRef.current !== undefined && prevUserRef.current !== userId) {
      queryClient.invalidateQueries({ queryKey: ["active_plan"] });
    }
    prevUserRef.current = userId;
  }, [hydrated, userId, queryClient]);

  // Enquanto auth ainda não hidratou, ou temos user mas ainda não há dado,
  // reportamos loading — evita o flash de Paywall pós-login. Importante:
  // NÃO consideramos `isFetching` (background refetch) como loading, senão
  // qualquer revalidação silenciosa desmontaria o app inteiro (o
  // SubscriptionGate voltaria a "Carregando…" e perderia estado de UI).
  const loading = !hydrated || (!!userId && (isLoading || plan === undefined));

  return { plan, loading, isActive: !!plan, refetch };
}
