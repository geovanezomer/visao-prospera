-- user_emails: dono pode ler o próprio registro (populado por trigger)
CREATE POLICY "user_emails self read"
  ON public.user_emails FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- subscriptions: admin all (dono já tinha SELECT via policy existente)
CREATE POLICY "subscriptions admin all"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));