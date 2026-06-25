-- ===========================================================================
-- Admin v3: plans (UI-configurable), user_notes (CRM), notification_settings,
-- signup_events (for new-signup notifications)
-- ===========================================================================

-- 1) plans ------------------------------------------------------------------
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'brl',
  interval text NOT NULL DEFAULT 'month',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  stripe_price_id text,
  asaas_plan_ref text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_public_read_active" ON public.plans
  FOR SELECT TO anon, authenticated USING (active = true);
CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed: planos atuais (starter / pro)
INSERT INTO public.plans (slug, name, description, price_cents, currency, interval, features, sort_order)
VALUES
  ('starter', 'Mensal', 'Acesso completo ao FinancePRO mês a mês.', 9700, 'brl', 'month',
    '["DRE, Balanço e Fluxo de Caixa", "Simulador CBS/IBS", "40+ indicadores", "Cálculos trabalhistas", "Análises com I.A."]'::jsonb, 10),
  ('pro', 'Anual', 'Tudo do plano Mensal com 2 meses grátis.', 97000, 'brl', 'year',
    '["Tudo do plano Mensal", "Economia equivalente a 2 meses", "Suporte prioritário"]'::jsonb, 20);

-- 2) user_notes -------------------------------------------------------------
CREATE TABLE public.user_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_email text,
  body text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_notes_user ON public.user_notes(user_id, created_at DESC);
GRANT ALL ON public.user_notes TO service_role;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
-- nenhum acesso direto: apenas via server fns (service_role)

-- 3) notification_settings (singleton) --------------------------------------
CREATE TABLE public.notification_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  slack_webhook_url text,
  email_to text,
  events jsonb NOT NULL DEFAULT '{"signup":true,"churn":true,"past_due":true,"webhook_failure":true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.notification_settings TO service_role;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.notification_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TRIGGER notif_touch BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) signup_events (para notificações de novos cadastros) -------------------
CREATE TABLE public.signup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.signup_events TO service_role;
ALTER TABLE public.signup_events ENABLE ROW LEVEL SECURITY;

-- Atualiza handle_new_user para registrar signup_event
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.signup_events (user_id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;