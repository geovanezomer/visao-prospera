
-- 1) app_settings: narrow public SELECT to safe keys only
DROP POLICY IF EXISTS "app_settings public read" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings public read safe keys" ON public.app_settings;
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
