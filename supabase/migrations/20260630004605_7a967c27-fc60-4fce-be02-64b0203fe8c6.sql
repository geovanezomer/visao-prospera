-- P4-01: remove apikey hardcoded do cron (rota /api/public/* já é pública)
DO $$ BEGIN
  PERFORM cron.unschedule('webhook-retry-worker');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'webhook-retry-worker',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--63373a99-4bbe-47c8-8af7-a1a7d7342a30.lovable.app/api/public/hooks/webhook-retry',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"limit": 25}'::jsonb
  ) AS request_id;
  $cron$
);