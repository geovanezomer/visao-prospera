## Plano: Upsell no Checkout

### 1. Schema (migration)
Adicionar à tabela `plans`:
- `upsell_enabled` (bool, default false)
- `upsell_name` (text)
- `upsell_description` (text)
- `upsell_price_cents` (int)
- `upsell_provider_ref` (jsonb) — `{ stripe_price_id, asaas_product_id }`

### 2. Admin UI (`PlansTab.tsx`)
Card colapsável "Upsell opcional" no formulário do plano:
- Toggle Ativar upsell
- Nome, descrição, preço (R$)
- IDs opcionais por provedor

### 3. Server `plans.functions.ts`
Estender schema Zod e CRUD (`upsertPlan`) para persistir campos de upsell.

### 4. Landing/Checkout UI
Na página de checkout (rota onde escolhe plano antes do redirect/embed), exibir checkbox "Adicionar [nome] por R$ X" quando `upsell_enabled`. Passar flag `withUpsell` ao endpoint de checkout.

### 5. Endpoint `checkout.ts` + provedores
- Carregar plano + upsell do banco.
- **Stripe** (`stripe.ts`):
  - `mode: subscription` → adicionar segundo `line_item` recorrente (cobra junto na assinatura) OU usar `price_data` one-time como add-on. Decisão: tratar upsell como **one-time** via `payment_intent_data`/`invoice_items` em assinatura é complexo; usar `line_items` adicional com mesmo `interval` quando assinatura, ou item adicional quando one-time.
  - Simplificação: upsell é sempre **one-time**. Em subscription, adicionar via `subscription_data.add_invoice_items` (cobra na primeira fatura). Em payment mode, adicionar `line_item` extra.
- **Asaas** (`asaas.ts`):
  - Em subscription: criar charge avulsa adicional via `/payments` com mesmo customer + `dueDate` hoje.
  - Em one-time: somar valor ao `value` da cobrança e descrever no `description`.

### 6. Webhook
Registrar metadata `upsell: true` na sessão/charge para rastreio em `webhook_events`. Sem mudança de lógica de plano (upsell não altera plano ativo).

### 7. Tipos
Atualizar `payments/types.ts` `CreateCheckoutInput` com `upsell?: { name, priceCents, providerRef? }`.

### 8. Validação
- `bunx tsgo` para tipos
- Smoke test mental dos fluxos: plano recorrente + upsell, plano one-time + upsell, sem upsell.

Pronto para executar?