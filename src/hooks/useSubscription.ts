// ============================================================================
// Hook useSubscription — consulta o plano ativo do usuário via RPC
// get_active_plan() (SECURITY DEFINER que filtra por auth.uid()).
// Usa React Query com cache de 5 min — evita refetch em cada navegação
// e em cada componente que consome o hook (dedupe automático por queryKey).
// ============================================================================

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type ActivePlan = {
  plan: string;
  status: string;
  current_period_end: string | null;
  provider: string;
  cancel_at_period_end: boolean;
} | null;

async function fetchActivePlan(): Promise<ActivePlan> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data, error } = await supabase.rpc("get_active_plan");
  if (error) {
    console.warn("[useSubscription]", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ActivePlan;
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

  // Re-fetch apenas em transições de identidade — não em token refresh.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        queryClient.invalidateQueries({ queryKey: ["active_plan"] });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  // Enquanto auth ainda não hidratou, ou temos user mas ainda não há dado,
  // reportamos loading — evita o flash de Paywall pós-login. Importante:
  // NÃO consideramos `isFetching` (background refetch) como loading, senão
  // qualquer revalidação silenciosa desmontaria o app inteiro (o
  // SubscriptionGate voltaria a "Carregando…" e perderia estado de UI).
  const loading = !hydrated || (!!userId && (isLoading || plan === undefined));

  return { plan, loading, isActive: !!plan, refetch };
}
