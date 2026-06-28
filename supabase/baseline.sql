-- ============================================================
-- FinancePRO — BASELINE consolidado do schema
-- Gerado em: 2026-06-28T16:15:12Z
-- 
-- Concatenação ordenada de todas as migrations em supabase/migrations/.
-- Uso: aplique este arquivo UMA ÚNICA VEZ em um banco Supabase vazio
-- para recriar todo o schema do FinancePRO (tabelas, policies, RLS,
-- funções, triggers, grants).
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline.sql
--
-- Depois disso, o db-bootstrap.sh marca todas as migrations como
-- aplicadas automaticamente (ver final deste arquivo).
-- ============================================================

BEGIN;


-- ─────────────────────────────────────────────────────────────
-- 20260601201550_0b530fdd-bf4e-4fe1-9b41-b6340e9bc62d.sql
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 20260601201605_43ddfe1a-eaec-4c19-a895-e9d9170235df.sql
-- ─────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 20260619215357_3d39d716-36d5-44d5-8d5f-365523cd5ab5.sql
-- ─────────────────────────────────────────────────────────────
CREATE POLICY "backups upload próprio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "backups leitura própria" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "backups atualização própria" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "backups deleção própria" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────
-- 20260623133558_ba6788be-9ce2-4b39-9675-185ef20a7ea3.sql
-- ─────────────────────────────────────────────────────────────
CREATE POLICY "shared-reports owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shared-reports owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shared-reports owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ─────────────────────────────────────────────────────────────
-- shared_reports (tabela base — necessária antes do trigger/policies)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shared_reports (
  share_id     text PRIMARY KEY,
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  company_name text NOT NULL,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shared_reports_owner_idx ON public.shared_reports (owner_id);
CREATE INDEX IF NOT EXISTS shared_reports_company_idx
  ON public.shared_reports (owner_id, company_name) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_reports TO authenticated;
GRANT ALL ON public.shared_reports TO service_role;

ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_reports insert proprio" ON public.shared_reports;
CREATE POLICY "shared_reports insert proprio" ON public.shared_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "shared_reports update proprio" ON public.shared_reports;
CREATE POLICY "shared_reports update proprio" ON public.shared_reports
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "shared_reports delete proprio" ON public.shared_reports;
CREATE POLICY "shared_reports delete proprio" ON public.shared_reports
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────
-- 20260623135424_6c5c47c9-bc08-4891-ba51-e0c82f89d52d.sql
-- ─────────────────────────────────────────────────────────────


-- Trigger de imutabilidade: em UPDATE de shared_reports, só o campo
-- revoked_at pode mudar. Qualquer outra alteração é rejeitada,
-- mesmo que o cliente tente via API com a chave do dono.
CREATE OR REPLACE FUNCTION public.shared_reports_enforce_readonly()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.share_id      IS DISTINCT FROM OLD.share_id      THEN RAISE EXCEPTION 'shared_reports: share_id é imutável'; END IF;
  IF NEW.owner_id      IS DISTINCT FROM OLD.owner_id      THEN RAISE EXCEPTION 'shared_reports: owner_id é imutável'; END IF;
  IF NEW.storage_path  IS DISTINCT FROM OLD.storage_path  THEN RAISE EXCEPTION 'shared_reports: storage_path é imutável'; END IF;
  IF NEW.company_name  IS DISTINCT FROM OLD.company_name  THEN RAISE EXCEPTION 'shared_reports: company_name é imutável'; END IF;
  IF NEW.expires_at    IS DISTINCT FROM OLD.expires_at    THEN RAISE EXCEPTION 'shared_reports: expires_at é imutável'; END IF;
  IF NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN RAISE EXCEPTION 'shared_reports: created_at é imutável'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_reports_readonly_guard ON public.shared_reports;
CREATE TRIGGER shared_reports_readonly_guard
  BEFORE UPDATE ON public.shared_reports
  FOR EACH ROW EXECUTE FUNCTION public.shared_reports_enforce_readonly();


-- ─────────────────────────────────────────────────────────────
-- 20260623140345_6dcf2d6c-ec68-4918-b498-b066239ec26a.sql
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.shared_reports_enforce_readonly()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.share_id      IS DISTINCT FROM OLD.share_id      THEN RAISE EXCEPTION 'shared_reports: share_id é imutável'; END IF;
  IF NEW.owner_id      IS DISTINCT FROM OLD.owner_id      THEN RAISE EXCEPTION 'shared_reports: owner_id é imutável'; END IF;
  IF NEW.storage_path  IS DISTINCT FROM OLD.storage_path  THEN RAISE EXCEPTION 'shared_reports: storage_path é imutável'; END IF;
  IF NEW.company_name  IS DISTINCT FROM OLD.company_name  THEN RAISE EXCEPTION 'shared_reports: company_name é imutável'; END IF;
  IF NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN RAISE EXCEPTION 'shared_reports: created_at é imutável'; END IF;
  -- expires_at e revoked_at podem ser alterados pelo dono via server fn.
  RETURN NEW;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- helpers globais (necessários antes dos triggers)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- subscriptions (tabela base — necessária antes dos ALTER/índices)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  price_id               text NOT NULL,
  plan                   text NOT NULL,
  status                 text NOT NULL,
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON public.subscriptions(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users view own subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS subscriptions_touch_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_touch_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 20260625135412_72952dea-009f-46f6-bb89-ac4cd8991151.sql
-- ─────────────────────────────────────────────────────────────


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


-- ─────────────────────────────────────────────────────────────
-- 20260625135450_282b3c00-fb7b-4ad9-9c63-979341d2828a.sql
-- ─────────────────────────────────────────────────────────────

-- Refatora para usar auth.uid() (sem aceitar user_id arbitrário) e revoga public/anon
CREATE OR REPLACE FUNCTION public.get_active_plan()
RETURNS TABLE(plan text, status text, current_period_end timestamptz, provider text, cancel_at_period_end boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT plan, status, current_period_end, provider, cancel_at_period_end
  FROM public.subscriptions
  WHERE user_id = auth.uid()
    AND status IN ('active','trialing','lifetime','past_due')
  ORDER BY created_at DESC
  LIMIT 1
$$;

-- Remove a versão anterior que aceitava parâmetro
DROP FUNCTION IF EXISTS public.get_active_plan(uuid);

REVOKE ALL ON FUNCTION public.get_active_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_plan() TO authenticated;

-- Garante que a função exista antes do REVOKE/GRANT (definição final reaparece adiante)
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND status IN ('active','trialing','lifetime')
  )
$$;

REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 20260625142633_e2410c14-03a2-4fef-aaec-ab6667153873.sql
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings public read" ON public.app_settings FOR SELECT USING (true);

CREATE TABLE public.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE CHECK (provider IN ('stripe','asaas')),
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  api_key text,
  webhook_secret text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX provider_credentials_only_one_active
  ON public.provider_credentials ((is_active)) WHERE is_active = true;
GRANT ALL ON public.provider_credentials TO service_role;
ALTER TABLE public.provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_api_key text,
  from_email text,
  from_name text,
  reply_to text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL UNIQUE CHECK (kind IN ('magic_link','receipt','password_reset','refund','welcome')),
  subject text NOT NULL,
  html text NOT NULL,
  text text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.email_templates (kind, subject, html, text) VALUES
('magic_link', 'Seu acesso ao Finnance',
 '<h1>Olá {{name}}</h1><p>Clique no link abaixo para acessar sua conta:</p><p><a href="{{link}}">Acessar agora</a></p><p>Este link expira em 1 hora.</p>',
 'Olá {{name}}. Acesse: {{link}}'),
('receipt', 'Recibo de pagamento — Finnance',
 '<h1>Pagamento confirmado</h1><p>Olá {{name}}, recebemos seu pagamento de <strong>{{amount}}</strong> referente ao plano <strong>{{plan}}</strong>.</p>',
 'Pagamento de {{amount}} - plano {{plan}} confirmado.'),
('password_reset', 'Redefinição de senha — Finnance',
 '<h1>Redefinir senha</h1><p>Olá {{name}}, clique abaixo para criar uma nova senha:</p><p><a href="{{link}}">Redefinir senha</a></p>',
 'Redefinir senha: {{link}}'),
('refund', 'Estorno processado — Finnance',
 '<h1>Estorno confirmado</h1><p>Olá {{name}}, processamos o estorno de <strong>{{amount}}</strong>. O valor será creditado em até 10 dias úteis.</p>',
 'Estorno de {{amount}} processado.'),
('welcome', 'Bem-vindo ao Finnance',
 '<h1>Bem-vindo, {{name}}!</h1><p>Sua conta está ativa. Comece agora a analisar o financeiro da sua empresa.</p><p><a href="{{link}}">Acessar plataforma</a></p>',
 'Bem-vindo, {{name}}! Acesse: {{link}}');

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe','asaas','admin')),
  event_type text NOT NULL,
  subscription_id text,
  customer_email text,
  status text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','failed','skipped','replayed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_received_at_idx ON public.webhook_events (received_at DESC);
CREATE INDEX webhook_events_email_idx ON public.webhook_events (customer_email);
CREATE INDEX webhook_events_subscription_idx ON public.webhook_events (subscription_id);
CREATE INDEX webhook_events_provider_status_idx ON public.webhook_events (provider, status);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value) VALUES
('branding', '{"system_name":"Finnance","logo_url":null,"favicon_url":null}'::jsonb),
('login_texts', '{"headline":"Análise financeira completa para sua empresa","subheadline":"Acesse a plataforma para fazer um Raio-X do Fluxo de Caixa, DRE, Balanço, Impactos da Reforma Tributária e +40 Indicadores.","cta":"Entrar"}'::jsonb),
('footer', '{"text":"Desenvolvido por GZ Consultoria Financeira & Investimentos"}'::jsonb),
('active_provider', '{"provider":"stripe"}'::jsonb);


-- ─────────────────────────────────────────────────────────────
-- 20260625145356_96567798-e0ec-4ea5-8cb7-9459a8a8c964.sql
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  resource text NOT NULL,
  target_id text,
  target_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_audit_log TO service_role;
-- nenhum GRANT para anon/authenticated: leitura/escrita só via server fn com service role

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX admin_audit_log_actor_idx ON public.admin_audit_log (actor_id);
CREATE INDEX admin_audit_log_resource_idx ON public.admin_audit_log (resource, action);

-- ─────────────────────────────────────────────────────────────
-- 20260625150933_3e79b535-58ad-4bff-943c-fac3571f3d43.sql
-- ─────────────────────────────────────────────────────────────

-- Feature flags + broadcasts (P2)
CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent integer NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  allowed_emails text[] NOT NULL DEFAULT '{}',
  allowed_plans text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feature_flags read for authenticated" ON public.feature_flags FOR SELECT TO authenticated USING (true);

CREATE TABLE public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  html text NOT NULL,
  segment jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
-- No authenticated policy: only service_role via admin fns can read/write.


-- ─────────────────────────────────────────────────────────────
-- 20260625151553_836ab5e7-1979-404e-bcab-2a6beac83a6c.sql
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 20260625152401_be7e4c16-36c1-4ab2-a4c0-31318ff49022.sql
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 20260625152609_5ab6c5e1-b45e-4969-869f-d3540e42cbf1.sql
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 20260625152847_e89fda07-7d68-40ae-881f-fce14ec28085.sql
-- ─────────────────────────────────────────────────────────────
-- Sem alteração de schema: app_settings já aceita qualquer key (TEXT + JSONB).
-- Apenas garante a linha inicial vazia para a chave 'tracking'.
INSERT INTO public.app_settings (key, value)
VALUES ('tracking', '{"head":"","body_start":"","body_end":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 20260625153146_90c372ed-a176-498d-ae53-af2243a988ca.sql
-- ─────────────────────────────────────────────────────────────

-- 1) app_settings: narrow public SELECT to safe keys only
DROP POLICY IF EXISTS "app_settings public read" ON public.app_settings;
CREATE POLICY "app_settings public read safe keys"
  ON public.app_settings
  FOR SELECT
  TO anon, authenticated
  USING (key IN ('branding','login_texts','footer','tracking'));

-- 2) shared_reports: drop public SELECT — access is always brokered by
-- getSharedReport server function using service_role.
DROP POLICY IF EXISTS "shared_reports leitura publica" ON public.shared_reports;

-- 3) SECURITY DEFINER helpers: switch to INVOKER (subscriptions RLS already
-- restricts rows to auth.uid()) and tighten EXECUTE grants.
CREATE OR REPLACE FUNCTION public.get_active_plan()
RETURNS TABLE(plan text, status text, current_period_end timestamp with time zone, provider text, cancel_at_period_end boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT plan, status, current_period_end, provider, cancel_at_period_end
  FROM public.subscriptions
  WHERE user_id = auth.uid()
    AND status IN ('active','trialing','lifetime','past_due')
  ORDER BY created_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND status IN ('active','trialing','lifetime')
  )
$$;

-- handle_new_user is a trigger on auth.users — keep DEFINER, but it must
-- not be directly executable by API roles.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 20260625155852_00667ac9-42f6-4737-bdea-d4bec8785141.sql
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS upsell_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upsell_name text,
  ADD COLUMN IF NOT EXISTS upsell_description text,
  ADD COLUMN IF NOT EXISTS upsell_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upsell_stripe_price_id text,
  ADD COLUMN IF NOT EXISTS upsell_asaas_ref text;

-- ─────────────────────────────────────────────────────────────
-- 20260625160819_260340ce-83d5-4d92-b20d-2b9d23797fb0.sql
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- 20260625161136_c6f08c07-356f-413e-84ac-8adad2fc1034.sql
-- ─────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────
-- 20260625171705_fa9578d5-7d88-40a6-af79-e25bd63a18ce.sql
-- ─────────────────────────────────────────────────────────────

-- Tabela para rate limiting distribuído (todos os workers compartilham).
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- Sem políticas: somente service_role (server-side) acessa.

CREATE INDEX IF NOT EXISTS idx_rl_reset ON public.rate_limit_buckets(reset_at);

-- Função atômica para incrementar/criar bucket. Retorna se está dentro do limite
-- e quanto falta para o reset. SECURITY DEFINER + service_role no GRANT abaixo.
CREATE OR REPLACE FUNCTION public.rl_consume(
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS TABLE(allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_reset timestamptz;
  v_count integer;
BEGIN
  INSERT INTO public.rate_limit_buckets (bucket_key, count, reset_at)
  VALUES (_key, 1, v_now + make_interval(secs => _window_seconds))
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE
                  WHEN public.rate_limit_buckets.reset_at < v_now THEN 1
                  ELSE public.rate_limit_buckets.count + 1
                END,
        reset_at = CASE
                     WHEN public.rate_limit_buckets.reset_at < v_now
                       THEN v_now + make_interval(secs => _window_seconds)
                     ELSE public.rate_limit_buckets.reset_at
                   END
  RETURNING count, reset_at INTO v_count, v_reset;

  RETURN QUERY SELECT
    (v_count <= _limit) AS allowed,
    GREATEST(_limit - v_count, 0) AS remaining,
    GREATEST(EXTRACT(EPOCH FROM (v_reset - v_now))::int, 0) AS retry_after_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.rl_consume(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_consume(text, integer, integer) TO service_role;

-- Limpeza periódica de buckets expirados (sem CRON; opcional).
CREATE OR REPLACE FUNCTION public.rl_gc() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.rate_limit_buckets WHERE reset_at < now() - interval '1 hour';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.rl_gc() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_gc() TO service_role;

-- Coluna opcional para reconciliação por método de pagamento.
ALTER TABLE public.checkout_intents
  ADD COLUMN IF NOT EXISTS payment_method text;


-- ─────────────────────────────────────────────────────────────
-- 20260628133628_4aff040e-310d-44b3-b999-5bd4d7067436.sql
-- ─────────────────────────────────────────────────────────────

-- Trial requests (1 por e-mail, controlado pelo backend)
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS public.trial_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

GRANT ALL ON public.trial_requests TO service_role;
ALTER TABLE public.trial_requests ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: acesso só via service_role.

-- Expande CHECK do email_templates para aceitar 'trial_magic_link'
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('magic_link','receipt','password_reset','refund','welcome','trial_magic_link'));

INSERT INTO public.email_templates (kind, subject, html, text, enabled)
VALUES (
  'trial_magic_link',
  'Seu teste gratuito do {{system_name}} está pronto',
  '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
     <h2 style="margin:0 0 12px">Olá {{name}},</h2>
     <p>Seu acesso de teste foi liberado. Você tem <strong>{{hours}} horas</strong> para explorar a plataforma.</p>
     <p style="text-align:center;margin:28px 0">
       <a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Entrar na plataforma</a>
     </p>
     <p style="color:#64748b;font-size:13px">Este link é pessoal e expira ao final do período de teste. Após {{hours}}h sua sessão será encerrada automaticamente e você poderá escolher um plano para continuar.</p>
     <p style="color:#94a3b8;font-size:12px;margin-top:24px">Se você não solicitou este acesso, ignore este e-mail.</p>
   </div>',
  'Olá {{name}}, seu teste gratuito foi liberado por {{hours}} horas. Acesse: {{link}}',
  true
)
ON CONFLICT (kind) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 20260628140626_d0f1c9ee-4d60-42d7-ba2d-98a912d13082.sql
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "app_settings public read safe keys" ON public.app_settings;
CREATE POLICY "app_settings public read safe keys" ON public.app_settings
FOR SELECT
USING (key = ANY (ARRAY['branding','login_texts','footer','tracking','landing_video','legal','trial']));

-- ─────────────────────────────────────────────────────────────
-- Marca todas as migrations como aplicadas no ledger
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._lovable_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public._lovable_migrations (filename) VALUES ('20260601201550_0b530fdd-bf4e-4fe1-9b41-b6340e9bc62d.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260601201605_43ddfe1a-eaec-4c19-a895-e9d9170235df.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260619215357_3d39d716-36d5-44d5-8d5f-365523cd5ab5.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260623133558_ba6788be-9ce2-4b39-9675-185ef20a7ea3.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260623135424_6c5c47c9-bc08-4891-ba51-e0c82f89d52d.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260623140345_6dcf2d6c-ec68-4918-b498-b066239ec26a.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625135412_72952dea-009f-46f6-bb89-ac4cd8991151.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625135450_282b3c00-fb7b-4ad9-9c63-979341d2828a.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625142633_e2410c14-03a2-4fef-aaec-ab6667153873.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625145356_96567798-e0ec-4ea5-8cb7-9459a8a8c964.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625150933_3e79b535-58ad-4bff-943c-fac3571f3d43.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625151553_836ab5e7-1979-404e-bcab-2a6beac83a6c.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625152401_be7e4c16-36c1-4ab2-a4c0-31318ff49022.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625152609_5ab6c5e1-b45e-4969-869f-d3540e42cbf1.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625152847_e89fda07-7d68-40ae-881f-fce14ec28085.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625153146_90c372ed-a176-498d-ae53-af2243a988ca.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625155852_00667ac9-42f6-4737-bdea-d4bec8785141.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625160819_260340ce-83d5-4d92-b20d-2b9d23797fb0.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625161136_c6f08c07-356f-413e-84ac-8adad2fc1034.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260625171705_fa9578d5-7d88-40a6-af79-e25bd63a18ce.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260628133628_4aff040e-310d-44b3-b999-5bd4d7067436.sql') ON CONFLICT DO NOTHING;
INSERT INTO public._lovable_migrations (filename) VALUES ('20260628140626_d0f1c9ee-4d60-42d7-ba2d-98a912d13082.sql') ON CONFLICT DO NOTHING;

COMMIT;
