-- 1) Fix OVERLY_PERMISSIVE: feature_flags era legível por qualquer authenticated,
-- expondo allowed_emails (PII). Só admins agora, via has_role.
DROP POLICY IF EXISTS "feature_flags read for authenticated" ON public.feature_flags;

CREATE POLICY "feature_flags admin read"
  ON public.feature_flags FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "feature_flags admin write"
  ON public.feature_flags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) MISSING_RLS_POLICY: tabelas admin com RLS on e zero policies (fail-closed).
-- Torna a intenção explícita: só admins conseguem ler/gerenciar.
-- Service role continua com acesso total (bypassa RLS).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_audit_log','email_settings','provider_credentials','webhook_events',
    'broadcasts','email_templates','notification_settings','signup_events',
    'trial_requests','user_emails','user_notes','rate_limit_buckets','email_log'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s admin all" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s admin all" ON public.%I FOR ALL TO authenticated
         USING (public.has_role(auth.uid(), ''admin''))
         WITH CHECK (public.has_role(auth.uid(), ''admin''))',
      t, t
    );
  END LOOP;
END $$;