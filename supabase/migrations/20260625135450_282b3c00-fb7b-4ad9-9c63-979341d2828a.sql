
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

-- has_active_subscription pode ainda não existir em bancos novos (é criada
-- na migration 20260625153146). Aplica REVOKE/GRANT só se já existir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_active_subscription'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, service_role';
  END IF;
END $$;
