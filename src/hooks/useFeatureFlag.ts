// ============================================================================
// useFeatureFlag — lê public.feature_flags (RLS authenticated) e aplica a
// lógica de elegibilidade no cliente: enabled + (e-mail allowlist OR plano
// allowlist OR rollout % via hash determinístico do user_id).
// ============================================================================
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

// Hash determinístico (FNV-1a 32 bits) — 0..99.
function bucket(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % 100;
}

export function useFeatureFlag(key: string, currentPlan?: string | null): boolean {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("feature_flags")
        .select("enabled, rollout_percent, allowed_emails, allowed_plans")
        .eq("key", key)
        .maybeSingle();
      if (cancel || !data || !data.enabled) { setEnabled(false); return; }

      const email = (user?.email ?? "").toLowerCase();
      if (email && (data.allowed_emails as string[] | null)?.some((e) => e.toLowerCase() === email)) {
        setEnabled(true); return;
      }
      if (currentPlan && (data.allowed_plans as string[] | null)?.includes(currentPlan)) {
        setEnabled(true); return;
      }
      const pct = data.rollout_percent ?? 0;
      if (pct >= 100) { setEnabled(true); return; }
      if (pct <= 0) { setEnabled(false); return; }
      const uid = user?.id ?? email;
      if (!uid) { setEnabled(false); return; }
      setEnabled(bucket(`${key}:${uid}`) < pct);
    })();
    return () => { cancel = true; };
  }, [key, user?.id, user?.email, currentPlan]);

  return enabled;
}
