## Escopo desta etapa

Apenas a parte de **autenticação**: trocar o login hardcoded (`src/lib/auth.tsx`) por Lovable Cloud Auth com verificação de e-mail e sessão persistente. Assinatura ASAAS, freemium e landing ficam para etapas seguintes.

## 1. Habilitar Lovable Cloud

Provisiona Postgres + Auth gerenciados (verificação de e-mail nativa, sessão persistente em localStorage com refresh automático, RLS, secrets server-side). Nenhum `.env` para colar — chaves injetadas automaticamente (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

## 2. Tabela `profiles` + trigger

Migration SQL:
- `profiles` (`id uuid PK FK auth.users`, `display_name text`, `created_at timestamptz default now()`).
- GRANTs explícitos (`authenticated` + `service_role`).
- RLS: `auth.uid() = id` para SELECT/UPDATE.
- Trigger `on_auth_user_created` → cria linha em `profiles` no signup, copiando `display_name` do `raw_user_meta_data`.

## 3. Substituir `src/lib/auth.tsx`

Mantém a **mesma API pública** (`useAuth()`, `AuthProvider`, `user`, `login`, `logout`, `hydrated`) para não quebrar o resto do app (`store.ts`, `ScenarioBar`, etc.), mas por dentro usa `supabase.auth`:

- `AuthProvider`: inicializa com `supabase.auth.getSession()` e assina `onAuthStateChange` para manter `user` em sincronia (sessão persistente automática).
- `login(email, password)` → `signInWithPassword`. Rejeita se `email_confirmed_at` for nulo, com mensagem clara "Confirme seu e-mail antes de entrar".
- Novas funções: `signup(email, password, displayName)` → `signUp` com `emailRedirectTo: window.location.origin/auth/callback` e `data: { display_name }`; `requestPasswordReset(email)` → `resetPasswordForEmail` com `redirectTo: .../reset-password`.
- `logout()` → `signOut`.
- `AuthUser` muda para `{ id, email, displayName, emailConfirmed }`. Adapto os 2 lugares que liam `user.username` (`store.ts` usa `user.username` como chave de localStorage — passa a usar `user.id`, que é estável).

## 4. Rotas novas/atualizadas

- `/login` (existente) — refatorada: campo **e-mail** (não username), link "Esqueci a senha", link "Criar conta", mensagem de "verifique seu e-mail" pós-signup.
- `/signup` — nome, e-mail, senha (com validação Zod: e-mail válido, senha ≥ 8 chars com letras e números). Após sucesso, mostra "Enviamos um link de confirmação para seu e-mail".
- `/forgot-password` — campo e-mail → dispara reset.
- `/reset-password` — public route, lê `type=recovery` do hash, formulário de nova senha → `supabase.auth.updateUser({ password })`.
- `/auth/callback` — recebe redirect de confirmação de e-mail, mostra "E-mail confirmado, redirecionando…" e navega para `/`.

Todas as rotas privadas atuais ficam atrás do layout `_authenticated.tsx` (já usado no projeto). `beforeLoad` redireciona para `/login` com `?redirect=` preservado.

## 5. Cache invalidation no auth change

Adicionar listener único em `src/routes/__root.tsx` (`onAuthStateChange` → `router.invalidate()` + `queryClient.invalidateQueries()`) para evitar mostrar dados do usuário anterior após login/logout.

## 6. E-mails de auth

Lovable Cloud já envia e-mails de confirmação e reset com templates padrão. Para domínio customizado de remetente, fica para a etapa do ASAAS (junto com Resend / transacionais). Por agora: templates padrão do Cloud — funcional desde o primeiro signup.

## 7. Migração dos dados localStorage (preserva trabalho atual)

`useAppState`/`useScenarios` em `src/lib/finance/store.ts` hoje chaveiam por `username`. Mudo para chavear por `user.id` (Supabase UUID). No 1º login pós-migração, um efeito procura `gzfp:state:adminfinancepro` ou `gzfp:state:clientefinancepro` no localStorage e, se achar, copia para `gzfp:state:<novo-uuid>` e marca `gzfp:migrated:<uuid>=1`. Os dados continuam em localStorage nesta etapa — mover para Postgres é etapa separada.

## Detalhes técnicos

- Cliente Supabase do browser: `src/integrations/supabase/client.ts` (auto-gerado ao habilitar Cloud).
- Validação dos formulários: `zod` + `react-hook-form` (já no projeto via shadcn).
- Sem `createServerFn` nesta etapa — auth é 100% client-side via SDK do Supabase.
- Hardcoded `USERS` em `src/lib/auth.tsx` é removido. As contas `adminfinancepro`/`clientefinancepro` deixam de existir; usuário cria conta nova. Avisar no `/login` durante 1 semana com banner: "Recriamos o sistema de contas — clique em Criar conta".

## Fora de escopo (etapas seguintes)

- ASAAS / assinatura / webhook.
- Landing nova em `/`.
- Freemium por aba.
- Mover `scenarios` e `app_state` para Postgres.
- Domínio customizado para e-mails (Resend).
- Social login (Google/Apple).
