CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove jobs antigos com o mesmo nome (idempotente)
DO $$ BEGIN
  PERFORM cron.unschedule('webhook-retry-worker');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'webhook-retry-worker',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--63373a99-4bbe-47c8-8af7-a1a7d7342a30.lovable.app/api/public/hooks/webhook-retry',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVraGJ3ZGhzY3B0bmd4YXNpbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzYzMDgsImV4cCI6MjA5NTkxMjMwOH0.RiQo_1aGg6HCi1p3gmoleKtoyRf2E6wDowsekqfDeEk"}'::jsonb,
    body := '{"limit": 25}'::jsonb
  ) AS request_id;
  $$
);