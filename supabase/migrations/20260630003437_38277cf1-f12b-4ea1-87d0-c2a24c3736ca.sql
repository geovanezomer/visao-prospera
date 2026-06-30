ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS provider_event_id text;

-- UNIQUE parcial: aplica apenas quando provider_event_id está presente.
-- Eventos antigos sem o campo preenchido permanecem válidos.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_unique
  ON public.webhook_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;