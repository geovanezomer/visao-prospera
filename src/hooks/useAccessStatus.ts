// ============================================================================
// useAccessStatus — fonte única de verdade sobre "o usuário tem acesso ao app?"
//
// Consolida auth + assinatura + trial em um único discriminated union para
// simplificar o SubscriptionGate em /app e a PaywallScreen.
//
// Regras (na ordem):
//   1. useSubscription().plan status "active"|"trialing"     → "active"
//   2. status "past_due"                                     → "past_due"
//   3. status "canceled":
//      - current_period_end > agora → "active" (cancelAtPeriodEnd=true)
//      - senão                      → "canceled"
//   4. user.isTrial && trialExpiresAt > agora                → "trial"
//   5. user.isTrial && expirado                              → "trial_expired"
//   6. senão                                                 → "none"
// ============================================================================

import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useSubscription } from "@/hooks/useSubscription";

export type AccessStatus =
  | { kind: "loading" }
  | { kind: "active"; plan: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }
  | { kind: "trial"; expiresAt: string }
  | { kind: "trial_expired" }
  | { kind: "past_due"; plan: string; currentPeriodEnd: string | null }
  | { kind: "canceled" }
  | { kind: "none" };

/** Puro — testável sem hooks. */
export function resolveAccessStatus(input: {
  hydrated: boolean;
  subLoading: boolean;
  isTrial: boolean;
  trialExpiresAt: string | null;
  plan: {
    plan: string;
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  now?: number;
}): AccessStatus {
  const now = input.now ?? Date.now();
  if (!input.hydrated || input.subLoading) return { kind: "loading" };

  const p = input.plan;
  if (p) {
    const periodEndMs = p.current_period_end ? new Date(p.current_period_end).getTime() : null;
    if (p.status === "active" || p.status === "trialing" || p.status === "lifetime") {
      return {
        kind: "active",
        plan: p.plan,
        cancelAtPeriodEnd: !!p.cancel_at_period_end,
        currentPeriodEnd: p.current_period_end,
      };
    }
    if (p.status === "past_due") {
      return { kind: "past_due", plan: p.plan, currentPeriodEnd: p.current_period_end };
    }
    if (p.status === "canceled") {
      if (periodEndMs !== null && periodEndMs > now) {
        return {
          kind: "active",
          plan: p.plan,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: p.current_period_end,
        };
      }
      return { kind: "canceled" };
    }
  }

  if (input.isTrial && input.trialExpiresAt) {
    const t = new Date(input.trialExpiresAt).getTime();
    if (t > now) return { kind: "trial", expiresAt: input.trialExpiresAt };
    return { kind: "trial_expired" };
  }

  return { kind: "none" };
}

export function useAccessStatus(): AccessStatus {
  const { user, hydrated } = useAuth();
  const { plan, loading: subLoading } = useSubscription();

  return useMemo(
    () =>
      resolveAccessStatus({
        hydrated: hydrated && !!user,
        subLoading,
        isTrial: !!user?.isTrial,
        trialExpiresAt: user?.trialExpiresAt ?? null,
        plan: plan
          ? {
              plan: plan.plan,
              status: plan.status,
              current_period_end: plan.current_period_end,
              cancel_at_period_end: plan.cancel_at_period_end,
            }
          : null,
      }),
    [hydrated, user, subLoading, plan],
  );
}

/** Dias entre now e current_period_end (>= 0). */
export function daysSince(iso: string | null, now = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Grace period para past_due antes de trocar para PaywallScreen. */
export const GRACE_DAYS_PAST_DUE = 7;
