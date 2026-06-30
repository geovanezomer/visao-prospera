
-- ============================================================================
-- RBAC: app_role + user_roles + has_role() — substitui RBAC por env var.
-- Etapa 1 P1 / F-04 / P4-02
-- ============================================================================

-- 1) Enum de papéis
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  END IF;
END $$;

-- 2) Tabela user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 3) Grants (Data API)
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

-- 4) RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 5) Função has_role (SECURITY DEFINER, evita recursão RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;

-- 6) Política para admins poderem ver todas as roles (gestão futura)
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 7) Seed admin a partir do e-mail conhecido (migra ADMIN_EMAIL → DB)
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = lower('contato@geovanezomer.com.br')
ON CONFLICT (user_id, role) DO NOTHING;

-- ============================================================================
-- P4-02: shared_reports — bloqueia hard-delete pelo usuário.
-- Soft-delete continua via UPDATE revoked_at (server fn).
-- ============================================================================
REVOKE DELETE ON public.shared_reports FROM authenticated;
REVOKE DELETE ON public.shared_reports FROM anon;
-- service_role mantém ALL para limpeza/admin via server.

-- Política admin para SELECT (suporte/auditoria)
DROP POLICY IF EXISTS "Admins can view all shared reports" ON public.shared_reports;
CREATE POLICY "Admins can view all shared reports"
  ON public.shared_reports FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
