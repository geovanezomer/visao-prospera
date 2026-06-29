
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status_created
  ON public.subscriptions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shared_reports_owner_active
  ON public.shared_reports (owner_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_plans_active_sort
  ON public.plans (sort_order)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_signup_events_created
  ON public.signup_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received
  ON public.webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_intents_created
  ON public.checkout_intents (created_at DESC);
