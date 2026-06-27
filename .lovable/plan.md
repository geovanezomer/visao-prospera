
## Diagnóstico

149 ocorrências de `any` (não 186 — a contagem original incluía comentários e o `types.ts` autogerado do Supabase, que não conta como dívida). Distribuição:

```text
src/lib/admin           72  ← funções server-side do painel
src/components/admin    30  ← UI do painel + DashboardCharts
src/lib/payments        29  ← webhook handler, refund, adapters
src/engines/finance      4  ← resíduo do pdfExport
outros                  14  ← ruído marginal
```

Não são 149 problemas distintos — são **6 famílias** repetidas, fruto da pressa de construir a esteira de pagamentos antes do lançamento.

## Famílias e correção

### F1 — `admin: any` / `supabaseAdmin: any` (≈ 35 ocorrências)

Helpers internos recebem o cliente admin como `any`. Já existe o tipo certo: `SupabaseClient<Database>` de `@supabase/supabase-js` + `Database` de `@/integrations/supabase/types`.

- Criar `src/lib/admin/_types.ts` com `export type AdminClient = SupabaseClient<Database>`.
- Trocar todas as assinaturas `admin: any` por `admin: AdminClient`.
- Arquivos: `webhook-handler.server.ts`, `userDetail.functions.ts`, `notify.server.ts`, `refund.server.ts`, e os demais `*.functions.ts` do admin.

### F2 — `claims: any` (≈ 10 ocorrências)

JWT claims vindos do `requireSupabaseAuth` são tratados como `any` para ler `email` e fazer `assertAdmin`.

- Definir `AuthClaims` (`sub: string; email?: string; role?: string; app_metadata?: {...}`) em `src/lib/admin/_types.ts`.
- Substituir `(context.claims as any)?.email` e `assertAdmin(claims: any)` por `AuthClaims`.

### F3 — Respostas brutas de Stripe/Asaas (≈ 20 ocorrências)

`refund.server.ts`, `stripe.ts`, `asaas.ts` fazem `(await r.json()) as any`.

- Criar `src/lib/payments/_remote-types.ts` com shapes mínimos do que efetivamente usamos: `StripeSubscription`, `StripeInvoice`, `StripeRefund`, `AsaasPayment`, `AsaasRefund` (campos consumidos apenas — não replicar a API inteira).
- Trocar `stripeGet<any>` / `asaasReq<any>` pelos genéricos certos.

### F4 — `PaymentEvent` apagado para `any` (≈ 8 ocorrências em `webhook-handler.server.ts`)

O union `PaymentEvent` já existe e é validado pelos testes E2E. As linhas `(event as any).type`, `(event as any).subscriptionId`, `(event as any).email` derrotam a discriminação.

- Tipar `event: PaymentEvent` no entry-point e narrowar por `event.type` (já é discriminated union). Isso elimina os 8 casts e fortalece o handler — se um campo deixar de existir num evento, o TS pega na hora.

### F5 — Linhas de tabela em `.map((row: any) => ...)` (≈ 25 ocorrências)

`userDetail.functions.ts`, `webhook-handler.server.ts`, `admin.functions.ts` mapeiam resultados de `.from('subscriptions')`, `.from('webhook_events')`, `.from('audit_log')` com `(s: any) => ...`.

- Deixar o Supabase inferir: removendo o `: any` o tipo gerado vem sozinho. Onde a query usa `.select('a,b,c')`, o tipo já é parcial e correto.
- Onde precisarmos compor (ex.: `.map((s) => ({ id: s.stripe_subscription_id }))`), declarar um `Row = Tables<'subscriptions'>` local.

### F6 — Recharts callbacks (8 em `DashboardCharts.tsx`)

`(e: any) => toggle(...)`, `formatter={(v: any, n: any, item: any) => ...}` etc.

- Recharts exporta `TooltipProps`, `LegendProps`, `PieLabel`. Já que o callback shape varia por chart, criar tipos locais mínimos (`type LegendClickPayload = { dataKey?: string | number; value?: string }`) no topo do arquivo e usar.
- Para o `payload?: any[]` do tooltip customizado, usar `TooltipProps<number, string>['payload']`.

## Guardrail

Após a limpeza, adicionar ao `src/__tests__/architecture.test.ts` um teste que conta `any` explícitos em `src/lib/admin/**`, `src/lib/payments/**`, `src/components/admin/**` e falha se ultrapassar um teto (ex.: 5 — algumas integrações externas legitimamente exigem). Isso impede regressão silenciosa em PRs futuros.

## Execução

Vou dividir em 4 commits lógicos, parando para verificar `tsgo` e a suíte de testes entre eles:

1. **F1 + F2** — `AdminClient` e `AuthClaims` (libera ~45 ocorrências em arquivos compartilhados; mudança mecânica).
2. **F4** — `PaymentEvent` tipado no `webhook-handler.server.ts` (é o que dá mais segurança real — esses 8 casts escondiam bugs em potencial).
3. **F3 + F5** — Shapes remotos e inferência das rows do Supabase.
4. **F6** + resíduos de `pdfExport.ts`/`BrandingApplier.tsx` + **guardrail arquitetural**.

Meta: ≤ 5 `any` remanescentes no escopo, todos justificados por comentário `// any-ok:` explicando a razão (ex.: JSON dinâmico de payload de webhook bruto antes da validação Zod).

## Não-objetivos

- **Não** vou caçar `any` fora de payments/admin nesta passagem — o resto do projeto já está disciplinado e não justifica o churn.
- **Não** vou redesenhar as APIs internas; só tipar o que já existe.
- **Não** mexo em `src/integrations/supabase/types.ts` (autogerado).
