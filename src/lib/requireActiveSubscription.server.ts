// ============================================================================
// requireActiveSubscription — enforcement server-side de assinatura ativa.
//
// Consulta subscriptions + auth.users.user_metadata via supabaseAdmin e lança
// Error("402: ...") quando não há acesso válido. Cache em memória por userId
// (TTL 60s) para não bater no banco em cada chamada.
//
// Uso dentro de um createServerFn com requireSupabaseAuth:
//     await requireActiveSubscription(context.userId);
//
// NÃO usar em rotas públicas de checkout/webhook/trial.
// ============================================================================

type CacheEntry = { at: number; ok: boolean };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

/** Estados que garantem acesso pago ao produto. */
const ACTIVE_STATUSES = new Set(["active", "trialing", "lifetime"]);

/**
 * Retorna true se o usuário tem assinatura ativa OU trial válido.
 * Puro — recebe as leituras cruas para permitir teste sem I/O.
 */
export function isAccessGranted(input: {
  subscription: {
    status: string;
    current_period_end: string | null;
  } | null;
  isTrial: boolean;
  trialExpiresAt: string | null;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const s = input.subscription;
  if (s) {
    if (ACTIVE_STATUSES.has(s.status)) return true;
    if (s.status === "canceled" && s.current_period_end) {
      if (new Date(s.current_period_end).getTime() > now) return true;
    }
    // past_due: gate de servidor NÃO libera — client concede grace via banner.
  }
  if (input.isTrial && input.trialExpiresAt) {
    if (new Date(input.trialExpiresAt).getTime() > now) return true;
  }
  return false;
}

export async function requireActiveSubscription(userId: string): Promise<void> {
  const cached = CACHE.get(userId);
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    if (cached.ok) return;
    throw new Error("402: Assinatura inativa. Reative um plano para usar este recurso.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [subRes, userRes] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(userId),
  ]);

  const meta = (userRes.data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const isTrial = meta.is_trial === true;
  const trialExpiresAt = typeof meta.trial_expires_at === "string" ? meta.trial_expires_at : null;

  const ok = isAccessGranted({
    subscription: subRes.data
      ? { status: subRes.data.status, current_period_end: subRes.data.current_period_end }
      : null,
    isTrial,
    trialExpiresAt,
    now,
  });

  CACHE.set(userId, { at: now, ok });
  if (!ok) {
    throw new Error("402: Assinatura inativa. Reative um plano para usar este recurso.");
  }
}

/** Limpa o cache — chamado após checkout/webhook para efeito imediato. */
export function invalidateSubscriptionCache(userId?: string): void {
  if (userId) CACHE.delete(userId);
  else CACHE.clear();
}
