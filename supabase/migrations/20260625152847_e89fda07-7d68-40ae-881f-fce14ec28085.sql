-- Sem alteração de schema: app_settings já aceita qualquer key (TEXT + JSONB).
-- Apenas garante a linha inicial vazia para a chave 'tracking'.
INSERT INTO public.app_settings (key, value)
VALUES ('tracking', '{"head":"","body_start":"","body_end":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;