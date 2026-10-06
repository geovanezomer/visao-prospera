# Pagamentos — Stripe (principal) e Asaas (fallback)

Sistema de assinaturas provider-agnóstico controlado por `.env`. Implementação BYOK (Bring Your Own Keys) — você usa sua própria conta Stripe ou Asaas, sem intermediários.

---

## 1. Visão geral

```
Landing (/) → Pricing → POST /api/public/payments/checkout
                              ↓
              Stripe Checkout  ou  Asaas Hosted Invoice
                              ↓
              Pagamento confirmado
                              ↓
        Webhook → handler unificado → upsert subscriptions + magic link (Resend)
                              ↓
        Usuário acessa /app → <BillingButton/> abre Portal do Cliente
```

**Arquivos-chave**:

- `src/lib/payments/types.ts` — interface `PaymentProvider`.
- `src/lib/payments/index.ts` — seleção via `PAYMENT_PROVIDER`.
- `src/lib/payments/stripe.ts` — adapter REST Stripe (checkout + portal + HMAC).
- `src/lib/payments/asaas.ts` — adapter REST Asaas v3.
- `src/lib/payments/webhook-handler.server.ts` — persistência + magic link.
- `src/routes/api/public/payments/*` — endpoints públicos.
- `src/hooks/useSubscription.ts` + `src/components/billing/BillingButton.tsx` — UI.

---

## 2. Variáveis de ambiente

### Flag global

```env
VITE_PAYMENTS_ENABLED=true       # Mostra preços e BillingButton
PAYMENT_PROVIDER=stripe          # ou "asaas" — opcional; autodetecta pelas chaves
APP_URL=https://app.seudominio.com
```

### Stripe

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_xxxxx
STRIPE_PRICE_PRO=price_yyyyy
```

### Asaas

```env
ASAAS_API_KEY=$aact_prod_...
ASAAS_WEBHOOK_TOKEN=<token-definido-no-dashboard>
ASAAS_API_BASE=https://api.asaas.com/v3
ASAAS_PRICE_STARTER=<id-do-plano-ou-link>
ASAAS_PRICE_PRO=<id-do-plano-ou-link>
```

### Magic link (opcional, recomendado)

```env
RESEND_API_KEY=re_...
EMAIL_FROM=FinancePRO <no-reply@seudominio.com>
```

Sem Resend, o sistema cria o usuário no Supabase mesmo assim — apenas não envia o e-mail automático.

---

## 3. Configuração no Stripe Dashboard

1. **Criar produtos**: Products → Add Product → criar "Starter" e "Pro" recorrentes (mensal).
2. Copiar o `price_xxxxx` de cada um para `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO`.
3. **Webhook**: Developers → Webhooks → Add endpoint
   - URL: `${APP_URL}/api/public/payments/webhook/stripe`
   - Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copiar o `whsec_...` para `STRIPE_WEBHOOK_SECRET`.
4. **Customer Portal**: Settings → Billing → Customer Portal → habilitar cancelamento + atualização de método.

---

## 4. Configuração no Asaas Dashboard

1. **API Key**: Integrações → Gerar nova chave (prod ou sandbox).
2. **Webhook**: Integrações → Notificações Webhook
   - URL: `${APP_URL}/api/public/payments/webhook/asaas`
   - Token: gerar string aleatória e colar em `ASAAS_WEBHOOK_TOKEN`
   - Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`
3. **Planos**: criar assinaturas/links em Cobranças → Assinaturas e copiar IDs para `ASAAS_PRICE_*`.

---

## 5. Deploy em VPS com Docker

### docker-compose.yml (trecho)

```yaml
services:
  app:
    build: .
    env_file: .env
    ports: ["3000:3000"]
    restart: unless-stopped
```

### Nginx reverse-proxy (trecho)

```nginx
location /api/public/payments/webhook/ {
  proxy_pass http://app:3000;
  proxy_set_header Host $host;
  # CRÍTICO: não bufferizar o corpo bruto p/ verificação HMAC
  proxy_request_buffering off;
  client_max_body_size 1m;
}
```

### Passo-a-passo

```bash
git pull
cp .env.example .env   # preencher chaves
docker compose up -d --build
docker compose logs -f app
```

---

## 6. Trocar de provedor

Basta alterar `PAYMENT_PROVIDER=asaas` (ou `stripe`) e reiniciar o container. As assinaturas existentes permanecem no provedor original — a troca afeta apenas novos checkouts.

---

## 7. Troubleshooting

| Sintoma                                  | Causa provável                           | Solução                                                  |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| "Pagamentos não configurados" no console | `VITE_PAYMENTS_ENABLED` ausente          | Setar `true` no `.env` e rebuild                         |
| Webhook Stripe 400 "Invalid signature"   | Nginx buferizando corpo                  | `proxy_request_buffering off`                            |
| Webhook Asaas 401                        | Token divergente                         | Conferir `ASAAS_WEBHOOK_TOKEN`                           |
| `BillingButton` não aparece              | Usuário sem assinatura ativa             | Confirmar webhook chegou → checar tabela `subscriptions` |
| Magic link não chega                     | Resend não configurado ou e-mail em spam | Setar `RESEND_API_KEY` + domínio verificado              |

---

## 8. Tabela `subscriptions`

Colunas relevantes:

- `provider` (`stripe` \| `asaas`)
- `provider_customer_id`
- `stripe_subscription_id` (usado por ambos como ID externo)
- `plan` (`starter` \| `pro`)
- `status` (`active`, `trialing`, `past_due`, `canceled`, `lifetime`)
- `current_period_end`
- `cancel_at_period_end`

RPC `get_active_plan()` retorna o plano ativo do `auth.uid()` corrente.

---

## 9. Segurança

- Chaves secretas vivem apenas em `.env` no VPS — nunca commitar.
- Webhooks verificam assinatura (HMAC-SHA256 Stripe / token Asaas) antes de gravar.
- Persistência usa `supabaseAdmin` (service role) restrita ao handler do webhook.
- RLS na `subscriptions` permite SELECT apenas ao dono (`auth.uid() = user_id`).
