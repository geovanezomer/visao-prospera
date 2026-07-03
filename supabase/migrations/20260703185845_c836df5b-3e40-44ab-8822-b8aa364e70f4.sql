
-- Tabela espelho de e-mails para lookup rápido por webhook
CREATE TABLE public.user_emails (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem GRANT para anon/authenticated: acesso somente via service_role.
GRANT ALL ON public.user_emails TO service_role;

ALTER TABLE public.user_emails ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy pública: service_role bypassa RLS; qualquer outro role fica bloqueado.

-- Trigger em auth.users: mantém espelho sincronizado (case-insensitive).
CREATE OR REPLACE FUNCTION public.sync_user_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.email IS NOT NULL THEN
      INSERT INTO public.user_emails (user_id, email)
      VALUES (NEW.id, lower(NEW.email))
      ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      IF NEW.email IS NULL THEN
        DELETE FROM public.user_emails WHERE user_id = NEW.id;
      ELSE
        INSERT INTO public.user_emails (user_id, email)
        VALUES (NEW.id, lower(NEW.email))
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_emails_ins ON auth.users;
CREATE TRIGGER sync_user_emails_ins
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_emails();

DROP TRIGGER IF EXISTS sync_user_emails_upd ON auth.users;
CREATE TRIGGER sync_user_emails_upd
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_emails();

-- Backfill inicial
INSERT INTO public.user_emails (user_id, email)
SELECT id, lower(email) FROM auth.users WHERE email IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
