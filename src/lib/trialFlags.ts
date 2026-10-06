// ============================================================================
// Flags do teste gratuito — fonte única de leitura e escrita.
//
// Moram em `app_metadata`, que só o service role grava. NUNCA ler de
// `user_metadata`: o próprio usuário edita esse campo via
// `supabase.auth.updateUser({ data })` ou no `signUp`, e poderia se dar
// um teste "até 2099".
// ============================================================================

export type TrialFlags = {
  isTrial: boolean;
  trialExpiresAt: string | null;
};

type UserLike = { app_metadata?: Record<string, unknown> | null } | null | undefined;

export function readTrialFlags(user: UserLike): TrialFlags {
  const meta = (user?.app_metadata ?? {}) as Record<string, unknown>;
  return {
    isTrial: meta.is_trial === true,
    trialExpiresAt: typeof meta.trial_expires_at === "string" ? meta.trial_expires_at : null,
  };
}

/** Payload de `app_metadata` para iniciar um teste (uso exclusivo do servidor). */
export function trialStartMetadata(expiresAt: string) {
  return { is_trial: true, trial_expires_at: expiresAt };
}

/** Payload de `app_metadata` para encerrar o teste (expirado ou convertido). */
export function trialEndMetadata(extra: Record<string, unknown> = {}) {
  return { is_trial: false, trial_expires_at: null, ...extra };
}
