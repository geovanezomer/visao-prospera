
-- Fase 2: multi-provider support para subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Constraint de provedor válido
DO $$ BEGIN
  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_provider_check CHECK (provider IN ('stripe','asaas'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON public.subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer ON public.subscriptions(provider, provider_customer_id);

-- RPC: plano ativo do usuário corrente
CREATE OR REPLACE FUNCTION public.get_active_plan(_user_id uuid)
RETURNS TABLE(plan text, status text, current_period_end timestamptz, provider text, cancel_at_period_end boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT plan, status, current_period_end, provider, cancel_at_period_end
  FROM public.subscriptions
  WHERE user_id = _user_id
    AND status IN ('active','trialing','lifetime','past_due')
  ORDER BY created_at DESC
  LIMIT 1
$$;
