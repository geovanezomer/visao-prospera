
CREATE TABLE public.shared_reports (
  share_id text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  company_name text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_reports TO authenticated;
GRANT SELECT ON public.shared_reports TO anon;
GRANT ALL ON public.shared_reports TO service_role;

ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

-- Leitura pública (qualquer um com o share_id pode consultar a linha para checar status)
CREATE POLICY "shared_reports leitura publica" ON public.shared_reports
  FOR SELECT USING (true);

-- Dono gerencia seus próprios shares
CREATE POLICY "shared_reports insert proprio" ON public.shared_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "shared_reports update proprio" ON public.shared_reports
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "shared_reports delete proprio" ON public.shared_reports
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX shared_reports_owner_idx ON public.shared_reports(owner_id);
CREATE INDEX shared_reports_company_idx ON public.shared_reports(owner_id, company_name) WHERE revoked_at IS NULL;

-- Storage: cada usuário só pode subir em pastas com seu uid (bucket é privado;
-- leitura pública será via server route com service-role após checar expires_at/revoked_at).
CREATE POLICY "shared-reports upload proprio" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'shared-reports' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "shared-reports delete proprio" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'shared-reports' AND (storage.foldername(name))[1] = auth.uid()::text
  );
