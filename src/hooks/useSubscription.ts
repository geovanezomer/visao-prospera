// ============================================================================
// Hook useSubscription — consulta o plano ativo do usuário corrente via
// RPC get_active_plan() (SECURITY DEFINER que filtra por auth.uid()).
// ============================================================================

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActivePlan = {
  plan: string;
  status: string;
  current_period_end: string | null;
  provider: string;
  cancel_at_period_end: boolean;
} | null;

export function useSubscription() {
  const [plan, setPlan] = useState<ActivePlan>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setPlan(null);
        return;
      }
      const { data, error } = await (supabase.rpc as any)("get_active_plan");
      if (error) {
        console.warn("[useSubscription]", error.message);
        setPlan(null);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      setPlan(row ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") refetch();
    });
    return () => sub.subscription.unsubscribe();
  }, [refetch]);

  return { plan, loading, isActive: !!plan, refetch };
}
