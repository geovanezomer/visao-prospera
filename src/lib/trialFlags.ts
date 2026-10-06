// ============================================================================
// Flags do teste gratuito — fonte única de leitura.
//
// Moram em colunas da tabela `user` (is_trial, trial_expires_at), gravadas
// só pelo servidor: no Better Auth são campos com `input: false`, então o
// usuário não consegue defini-los no cadastro nem ao editar o perfil.
// ============================================================================

export type TrialFlags = {
  isTrial: boolean;
  trialExpiresAt: string | null;
};

type UserLike =
  | { isTrial?: boolean | null; trialExpiresAt?: Date | string | null }
  | null
  | undefined;

export function readTrialFlags(user: UserLike): TrialFlags {
  const exp = user?.trialExpiresAt ? new Date(user.trialExpiresAt) : null;
  return {
    isTrial: user?.isTrial === true,
    trialExpiresAt: exp && !Number.isNaN(exp.getTime()) ? exp.toISOString() : null,
  };
}

/** Patch de usuário para iniciar um teste (uso exclusivo do servidor). */
export function trialStartPatch(expiresAt: string | Date) {
  return { isTrial: true, trialExpiresAt: new Date(expiresAt) };
}

/** Patch para encerrar o teste (expirado ou convertido). */
export function trialEndPatch(converted?: { plan: string | null }) {
  return {
    isTrial: false,
    trialExpiresAt: null,
    ...(converted ? { trialConvertedAt: new Date(), trialConvertedPlan: converted.plan } : {}),
  };
}
