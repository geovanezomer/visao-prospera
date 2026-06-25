
-- Extend checkout_intents with idempotency + lifecycle tracking
ALTER TABLE public.checkout_intents
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS checkout_url text,
  ADD COLUMN IF NOT EXISTS provider_session_id text,
  ADD COLUMN IF NOT EXISTS provider_customer_id text,
  ADD COLUMN IF NOT EXISTS provider_subscription_id text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_idem_key
  ON public.checkout_intents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS checkout_intents_email_status_idx
  ON public.checkout_intents (lower(email), status);

CREATE INDEX IF NOT EXISTS checkout_intents_provider_sub_idx
  ON public.checkout_intents (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checkout_intents_provider_cus_idx
  ON public.checkout_intents (provider, provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS checkout_intents_touch ON public.checkout_intents;
CREATE TRIGGER checkout_intents_touch
  BEFORE UPDATE ON public.checkout_intents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
