
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

REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, service_role;
