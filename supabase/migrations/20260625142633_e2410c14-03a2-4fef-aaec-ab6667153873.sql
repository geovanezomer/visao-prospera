
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings public read" ON public.app_settings FOR SELECT USING (true);

CREATE TABLE public.provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE CHECK (provider IN ('stripe','asaas')),
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  api_key text,
  webhook_secret text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX provider_credentials_only_one_active
  ON public.provider_credentials ((is_active)) WHERE is_active = true;
GRANT ALL ON public.provider_credentials TO service_role;
ALTER TABLE public.provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_api_key text,
  from_email text,
  from_name text,
  reply_to text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL UNIQUE CHECK (kind IN ('magic_link','receipt','password_reset','refund','welcome')),
  subject text NOT NULL,
  html text NOT NULL,
  text text,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.email_templates (kind, subject, html, text) VALUES
('magic_link', 'Seu acesso ao Finnance',
 '<h1>Olá {{name}}</h1><p>Clique no link abaixo para acessar sua conta:</p><p><a href="{{link}}">Acessar agora</a></p><p>Este link expira em 1 hora.</p>',
 'Olá {{name}}. Acesse: {{link}}'),
('receipt', 'Recibo de pagamento — Finnance',
 '<h1>Pagamento confirmado</h1><p>Olá {{name}}, recebemos seu pagamento de <strong>{{amount}}</strong> referente ao plano <strong>{{plan}}</strong>.</p>',
 'Pagamento de {{amount}} - plano {{plan}} confirmado.'),
('password_reset', 'Redefinição de senha — Finnance',
 '<h1>Redefinir senha</h1><p>Olá {{name}}, clique abaixo para criar uma nova senha:</p><p><a href="{{link}}">Redefinir senha</a></p>',
 'Redefinir senha: {{link}}'),
('refund', 'Estorno processado — Finnance',
 '<h1>Estorno confirmado</h1><p>Olá {{name}}, processamos o estorno de <strong>{{amount}}</strong>. O valor será creditado em até 10 dias úteis.</p>',
 'Estorno de {{amount}} processado.'),
('welcome', 'Bem-vindo ao Finnance',
 '<h1>Bem-vindo, {{name}}!</h1><p>Sua conta está ativa. Comece agora a analisar o financeiro da sua empresa.</p><p><a href="{{link}}">Acessar plataforma</a></p>',
 'Bem-vindo, {{name}}! Acesse: {{link}}');

CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe','asaas','admin')),
  event_type text NOT NULL,
  subscription_id text,
  customer_email text,
  status text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','failed','skipped','replayed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_received_at_idx ON public.webhook_events (received_at DESC);
CREATE INDEX webhook_events_email_idx ON public.webhook_events (customer_email);
CREATE INDEX webhook_events_subscription_idx ON public.webhook_events (subscription_id);
CREATE INDEX webhook_events_provider_status_idx ON public.webhook_events (provider, status);
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value) VALUES
('branding', '{"system_name":"Finnance","logo_url":null,"favicon_url":null}'::jsonb),
('login_texts', '{"headline":"Análise financeira completa para sua empresa","subheadline":"Acesse a plataforma para fazer um Raio-X do Fluxo de Caixa, DRE, Balanço, Impactos da Reforma Tributária e +40 Indicadores.","cta":"Entrar"}'::jsonb),
('footer', '{"text":"Desenvolvido por GZ Consultoria Financeira & Investimentos"}'::jsonb),
('active_provider', '{"provider":"stripe"}'::jsonb);
