## Admin v3 — 5 novas capacidades

Implementação completa com Claude Opus. Tudo auditado em `admin_audit_log`.

### 1. Configuração de Planos via UI (P0)
Hoje `PLANS` está hardcoded em `src/lib/payments/plans.ts`. Migrar para tabela.

- **DB:** tabela `plans` (slug, name, price_cents, currency, interval, features jsonb, limits jsonb, stripe_price_id, asaas_plan_id, active, sort_order).
- **Server:** `plans.functions.ts` — `listPlans`, `upsertPlan`, `togglePlan`, `deletePlan` (admin-gated + audit).
- **Compat:** `getPlans()` lê do banco com fallback ao hardcoded; landing/pricing e checkout passam a usar a fonte dinâmica.
- **UI:** nova aba **Planos** no `/admin` — tabela editável com drawer (preço, features list, limites, IDs Stripe/Asaas, toggle ativo).
- **Seed:** migração popula os planos atuais (free/pro).

### 2. Notas Internas no Usuário (CRM leve)
- **DB:** tabela `user_notes` (user_id, author_id, body, pinned, created_at).
- **Server:** `userNotes.functions.ts` — list/create/delete/togglePin.
- **UI:** nova aba **Notas** no `UserDetailDrawer.tsx` — timeline com autor, "fixar", soft delete.

### 3. Notificações para o Admin
Eventos: novo signup, churn (cancelamento), past_due, webhook failure.

- **DB:** `notification_settings` (singleton: slack_webhook_url, email_to, events jsonb com flags por tipo).
- **Server:** `notify.server.ts` — `notifyAdmin(event, payload)` envia Slack (webhook) + Resend (email), respeita flags. Throttle simples (dedup por chave 5min em `admin_audit_log`).
- **Integração:** hooks em
  - `handle_new_user` trigger → tabela `signup_events` + chamada via server fn pós-signup
  - webhook handlers (Stripe/Asaas): em `subscription.deleted`, `past_due`, e falha de assinatura
  - `webhook_events` quando `status='failed'`
- **UI:** aba **Sistema** ganha card "Notificações" (webhook Slack, email destino, checkboxes por evento, botão "Testar").

### 4. Sessões Ativas / Revogar Tokens
- **Server:** `sessions.functions.ts` (admin) — `listUserSessions(userId)` via `supabaseAdmin.auth.admin` (lista refresh tokens), `revokeAllSessions(userId)` via `signOut({ scope: 'global' })`, `revokeSession(sessionId)`.
- **UI:** nova aba **Sessões** no `UserDetailDrawer` — lista (criado em, último uso, IP, user-agent quando disponível), botões "Revogar" / "Revogar todas". Auditado.

### 5. Status Page Interno
- **Server:** `status.functions.ts` — checa em paralelo:
  - **Stripe:** `GET https://status.stripe.com/api/v2/status.json`
  - **Resend:** ping `GET https://api.resend.com/domains` com API key (HEAD se possível)
  - **Supabase:** `SELECT 1` + `https://status.supabase.com/api/v2/status.json`
  - **Asaas:** `GET /v3/finance/balance` com key
  - **Lovable AI Gateway:** `GET /v1/models` com `LOVABLE_API_KEY`
- Cada check retorna `{ name, status: 'operational'|'degraded'|'down', latencyMs, message }`.
- **UI:** nova aba **Status** com 5 cards (LED verde/amarelo/vermelho, latência, última verificação, botão "Recheck"). Auto-refresh 60s.

### Arquivos novos
```
src/lib/admin/plans.functions.ts
src/lib/admin/userNotes.functions.ts
src/lib/admin/sessions.functions.ts
src/lib/admin/status.functions.ts
src/lib/admin/notify.server.ts
src/components/admin/tabs/PlansTab.tsx
src/components/admin/tabs/StatusTab.tsx
src/components/admin/UserNotesPanel.tsx
src/components/admin/UserSessionsPanel.tsx
```

### Arquivos alterados
- `src/routes/admin.tsx` (+2 abas: Planos, Status → 11 abas)
- `src/components/admin/UserDetailDrawer.tsx` (+2 sub-abas: Notas, Sessões)
- `src/components/admin/tabs/SystemTab.tsx` (card de notificações)
- `src/lib/payments/plans.ts` (passa a ler do banco com cache + fallback)
- `src/routes/api/public/payments/webhook*.ts` (chama `notifyAdmin` em past_due/canceled/failure)

### Migrations (uma única)
- `plans` + GRANTs + RLS (leitura pública pros ativos; escrita só service_role)
- `user_notes` + GRANTs + RLS (leitura apenas admin)
- `notification_settings` (singleton id=1)
- Seed dos planos atuais

Confirma para eu executar?