DROP POLICY IF EXISTS "app_settings public read safe keys" ON public.app_settings;
CREATE POLICY "app_settings public read safe keys" ON public.app_settings
FOR SELECT
USING (key = ANY (ARRAY['branding','login_texts','footer','tracking','landing_video','legal','trial']));