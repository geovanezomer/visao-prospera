// ============================================================================
// Server function: retorna o status de assinatura do usuário logado.
// Usada para gatear o acesso ao /app.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SubscriptionStatus = {
  active: boolean;
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
};

export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionStatus> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("subscriptions")
      .select("plan,status,current_period_end")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("getMySubscription error:", error);
      return { active: false, plan: null, status: null, current_period_end: null };
    }
    if (!data) return { active: false, plan: null, status: null, current_period_end: null };

    // Ativo se: status em (active, trialing, lifetime)
    // OU cancelado mas ainda dentro do período pago (grace period até current_period_end)
    const now = Date.now();
    const periodEndMs = data.current_period_end ? new Date(data.current_period_end).getTime() : null;
    const inGracePeriod =
      data.status === "canceled" && periodEndMs !== null && periodEndMs > now;
    const active = ["active", "trialing", "lifetime"].includes(data.status) || inGracePeriod;
    return {
      active,
      plan: data.plan,
      status: data.status,
      current_period_end: data.current_period_end,
    };
  });
