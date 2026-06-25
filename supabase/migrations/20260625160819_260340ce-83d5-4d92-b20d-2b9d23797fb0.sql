CREATE TABLE public.checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_slug text NOT NULL,
  email text NOT NULL,
  with_upsell boolean NOT NULL DEFAULT false,
  provider text NOT NULL,
  plan_amount_cents integer,
  upsell_amount_cents integer,
  currency text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX checkout_intents_email_idx ON public.checkout_intents (lower(email));
CREATE INDEX checkout_intents_created_at_idx ON public.checkout_intents (created_at DESC);

GRANT ALL ON public.checkout_intents TO service_role;

ALTER TABLE public.checkout_intents ENABLE ROW LEVEL SECURITY;

-- Nenhuma política para anon/authenticated: leitura/escrita somente via service_role
-- nas server functions e no painel admin.
CREATE POLICY "no public access" ON public.checkout_intents
  FOR SELECT USING (false);