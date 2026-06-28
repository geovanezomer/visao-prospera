
-- Trial requests (1 por e-mail, controlado pelo backend)
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS public.trial_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

GRANT ALL ON public.trial_requests TO service_role;
ALTER TABLE public.trial_requests ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: acesso só via service_role.

-- Expande CHECK do email_templates para aceitar 'trial_magic_link'
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN ('magic_link','receipt','password_reset','refund','welcome','trial_magic_link'));

INSERT INTO public.email_templates (kind, subject, html, text, enabled)
VALUES (
  'trial_magic_link',
  'Seu teste gratuito do {{system_name}} está pronto',
  '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a">
     <h2 style="margin:0 0 12px">Olá {{name}},</h2>
     <p>Seu acesso de teste foi liberado. Você tem <strong>{{hours}} horas</strong> para explorar a plataforma.</p>
     <p style="text-align:center;margin:28px 0">
       <a href="{{link}}" style="background:#10b981;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Entrar na plataforma</a>
     </p>
     <p style="color:#64748b;font-size:13px">Este link é pessoal e expira ao final do período de teste. Após {{hours}}h sua sessão será encerrada automaticamente e você poderá escolher um plano para continuar.</p>
     <p style="color:#94a3b8;font-size:12px;margin-top:24px">Se você não solicitou este acesso, ignore este e-mail.</p>
   </div>',
  'Olá {{name}}, seu teste gratuito foi liberado por {{hours}} horas. Acesse: {{link}}',
  true
)
ON CONFLICT (kind) DO NOTHING;
