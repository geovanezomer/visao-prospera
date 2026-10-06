-- ============================================================================
-- Move as flags do teste gratuito de user_metadata para app_metadata.
--
-- user_metadata é editável pelo próprio usuário (auth.updateUser / signUp),
-- então is_trial/trial_expires_at ali permitiam um teste "até 2099".
-- app_metadata só é gravável pelo service role.
--
-- A fonte de verdade para quem tem trial é public.trial_requests (gravada só
-- pelo servidor). O prazo vem de lá, nunca do user_metadata — assim um prazo
-- forjado antes desta migration não é promovido para app_metadata.
-- Idempotente.
-- ============================================================================

UPDATE auth.users u
SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
       'is_trial', true,
       'trial_expires_at', to_char(tr.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     )
FROM public.trial_requests tr
WHERE tr.user_id = u.id
  AND (u.raw_user_meta_data ->> 'is_trial') = 'true'
  AND coalesce(u.raw_app_meta_data ->> 'is_trial', '') <> 'true';

-- Remove as chaves antigas do user_metadata para não confundir leituras futuras.
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'is_trial' - 'trial_expires_at'
WHERE raw_user_meta_data ?| array['is_trial', 'trial_expires_at'];
