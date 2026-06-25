-- Retry/backoff + histórico para webhook_events
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replayed_at timestamptz,
  ADD COLUMN IF NOT EXISTS replayed_by uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- Permitir novos estados
ALTER TABLE public.webhook_events DROP CONSTRAINT IF EXISTS webhook_events_status_check;
ALTER TABLE public.webhook_events ADD CONSTRAINT webhook_events_status_check
  CHECK (status = ANY (ARRAY['processed','failed','skipped','replayed','pending_retry','dead_letter']));

-- Índice para o worker de retry
CREATE INDEX IF NOT EXISTS webhook_events_retry_idx
  ON public.webhook_events (next_attempt_at)
  WHERE status = 'pending_retry';