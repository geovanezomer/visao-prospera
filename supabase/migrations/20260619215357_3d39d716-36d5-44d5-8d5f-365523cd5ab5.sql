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