ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS upsell_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upsell_name text,
  ADD COLUMN IF NOT EXISTS upsell_description text,
  ADD COLUMN IF NOT EXISTS upsell_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upsell_stripe_price_id text,
  ADD COLUMN IF NOT EXISTS upsell_asaas_ref text;