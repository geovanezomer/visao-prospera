CREATE POLICY "shared-reports owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shared-reports owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "shared-reports owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shared-reports' AND auth.uid()::text = (storage.foldername(name))[1]);