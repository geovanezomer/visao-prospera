-- ============================================================================
-- Reagenda os jobs de cron com autenticação por CRON_SECRET.
--
-- Antes:
--   • webhook-retry-worker chamava uma URL *.lovable.app SEM header de
--     autenticação → o endpoint respondia 401 e o retry de webhooks não rodava.
--   • trial-cleanup e reconcile-checkout-intents não estavam agendados aqui.
--
-- Agora a URL do app e o segredo vêm do Supabase Vault (nada sensível no git).
-- Antes de aplicar, crie os dois segredos no SQL editor do Supabase:
--
--   select vault.create_secret('https://SEU-DOMINIO', 'app_url');
--   select vault.create_secret('<mesmo valor de CRON_SECRET do .env>', 'cron_secret');
--
-- Sem os segredos os jobs rodam, mas o POST falha (URL nula) — sem efeito colateral.
-- Idempotente.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.call_app_hook(_path text, _body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_url') || _path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := _body
  );
$$;

-- Só o agendador (postgres) chama; ninguém via API.
REVOKE ALL ON FUNCTION public.call_app_hook(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('webhook-retry-worker');   EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('trial-cleanup');          EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('reconcile-checkout-intents'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'webhook-retry-worker', '*/2 * * * *',
  $cron$ SELECT public.call_app_hook('/api/public/hooks/webhook-retry', '{"limit": 25}'::jsonb); $cron$
);

SELECT cron.schedule(
  'trial-cleanup', '7 * * * *',
  $cron$ SELECT public.call_app_hook('/api/public/hooks/trial-cleanup'); $cron$
);

SELECT cron.schedule(
  'reconcile-checkout-intents', '*/30 * * * *',
  $cron$ SELECT public.call_app_hook('/api/public/hooks/reconcile-checkout-intents'); $cron$
);
