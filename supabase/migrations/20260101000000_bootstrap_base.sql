-- ============================================================
-- Bootstrap base: objetos foundationais que existiam no Lovable
-- Cloud por padrão (criados via dashboard) mas nunca foram
-- versionados em migrations. Sem isto, um banco zerado quebra
-- ao aplicar migrations posteriores que referenciam:
--   • função public.touch_updated_at()
--   • tabela public.shared_reports
--   • tabela public.subscriptions
-- Tudo aqui é IDEMPOTENTE (IF NOT EXISTS / OR REPLACE) — seguro
-- de re-rodar em bancos que já têm parte do schema (ex.: Lovable
-- Cloud), onde vira essencialmente no-op.
-- ============================================================

-- Função utilitária de updated_at (usada por triggers de várias tabelas)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $func$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$func$;

-- ---------- shared_reports ----------
CREATE TABLE IF NOT EXISTS public.shared_reports (
  share_id     text PRIMARY KEY,
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  company_name text NOT NULL,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shared_reports_owner_idx
  ON public.shared_reports(owner_id);
CREATE INDEX IF NOT EXISTS shared_reports_company_idx
  ON public.shared_reports(owner_id, company_name) WHERE revoked_at IS NULL;

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

-- ---------- subscriptions ----------
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
