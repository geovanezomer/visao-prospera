-- email_log: dedupe de envios de e-mails de ciclo de vida
CREATE TABLE public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  subscription_id text,
  sent_to_hash text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_log_kind_sub_sent_idx
  ON public.email_log (kind, subscription_id, sent_at DESC);

GRANT ALL ON public.email_log TO service_role;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
-- Sem políticas: apenas service_role (webhook handler) acessa.

-- Amplia CHECK dos tipos de template com os novos kinds
ALTER TABLE public.email_templates DROP CONSTRAINT IF EXISTS email_templates_kind_check;
ALTER TABLE public.email_templates ADD CONSTRAINT email_templates_kind_check
  CHECK (kind IN (
    'magic_link','receipt','password_reset','refund','welcome',
    'trial_magic_link','payment_failed','trial_ending','subscription_canceled'
  ));

-- Seeds default dos novos templates (idempotente).
INSERT INTO public.email_templates (kind, subject, html, text, enabled) VALUES
('payment_failed',
 'Não conseguimos processar seu pagamento — Finnance',
 '<h1>Olá {{name}}</h1><p>Não conseguimos processar sua última cobrança do plano <strong>{{plan}}</strong> no valor de <strong>{{amount}}</strong>.</p><p>Você tem <strong>7 dias</strong> para atualizar sua forma de pagamento antes do bloqueio do acesso.</p><p><a href="{{portal_url}}">Atualizar forma de pagamento</a></p><p>Seus dados permanecem salvos no seu dispositivo.</p>',
 'Não conseguimos processar seu pagamento. Atualize em: {{portal_url}}',
 true),
('trial_ending',
 'Seu teste do Finnance termina em breve',
 '<h1>Olá {{name}}</h1><p>Seu período de teste termina em <strong>{{trial_end}}</strong>.</p><p>Assine agora para não perder o acesso:</p><p><a href="{{plans_url}}">Ver planos</a></p><p>Seus dados permanecem salvos no seu dispositivo.</p>',
 'Seu teste termina em {{trial_end}}. Assine em: {{plans_url}}',
 true),
('subscription_canceled',
 'Sua assinatura foi cancelada — Finnance',
 '<h1>Olá {{name}}</h1><p>Confirmamos o cancelamento da sua assinatura. Seu acesso permanece ativo até <strong>{{access_end}}</strong>.</p><p>Seus dados permanecem no seu dispositivo e serão restaurados se você reativar a assinatura no futuro.</p><p><a href="{{plans_url}}">Ver planos</a></p>',
 'Cancelamento confirmado. Acesso até {{access_end}}.',
 true)
ON CONFLICT (kind) DO NOTHING;