-- Recria policies de storage de forma idempotente para 'backups' e 'shared-reports'.
-- Buckets em si são gerenciados pelo tooling de storage (não podem ser criados via SQL migration aqui).

-- backups
DROP POLICY IF EXISTS "backups upload próprio" ON storage.objects;
CREATE POLICY "backups upload próprio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "backups leitura própria" ON storage.objects;
CREATE POLICY "backups leitura própria" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "backups atualização própria" ON storage.objects;
CREATE POLICY "backups atualização própria" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "backups deleção própria" ON storage.objects;
CREATE POLICY "backups deleção própria" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

-- shared-reports
DROP POLICY IF EXISTS "shared-reports owner insert" ON storage.objects;
CREATE POLICY "shared-reports owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "shared-reports owner select" ON storage.objects;
CREATE POLICY "shared-reports owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "shared-reports owner delete" ON storage.objects;
CREATE POLICY "shared-reports owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);
