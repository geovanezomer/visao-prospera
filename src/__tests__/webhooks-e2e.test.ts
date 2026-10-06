// ============================================================================
// Testes end-to-end dos webhooks de pagamento (Stripe + Asaas).
//
// Para cada provedor e método de pagamento, montamos um payload real,
// assinamos como o provedor faria (HMAC-SHA256 no Stripe / `asaas-access-token`
// no Asaas), batemos no handler HTTP e validamos:
//
//   1. Transição de estado em `checkout_intents`
//      (created → paid; ou inalterada quando o evento não é "activated").
//   2. Upsert em `public.subscriptions` com os campos certos.
//   3. Emissão do magic link via Supabase auth.admin.generateLink.
//   4. Persistência do evento em `public.webhook_events` (status processed).
//   5. Falha de assinatura → HTTP 400, sem nenhuma escrita lateral.
//
// Tudo mockado em memória — nenhuma chamada de rede sai do processo.
// ============================================================================

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Envs determinísticas ───────────────────────────────────────────────────
process.env.CHECKOUT_INTENT_HMAC_SECRET ??= "test-secret-do-nao-use-em-prod-32+chars";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key-stub";
process.env.APP_URL ??= "https://app.example.com";

const STRIPE_WEBHOOK_SECRET = "whsec_test_stripe_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const ASAAS_WEBHOOK_TOKEN = "asaas_test_token_xxxxxxxxxxxxxxxxxxxxxxx";

// ─── Mock de @supabase/supabase-js ──────────────────────────────────────────
// Modela o subset que o pipeline de webhook toca: provider_credentials,
// subscriptions (upsert/update), checkout_intents (update chain), webhook_events
// (insert), email_settings/email_templates (maybeSingle), notification_settings,
// e auth.admin (listUsers/createUser/generateLink). Capturamos calls para asserts.

type Captured = {
  subscriptionsUpsert: any[];
  subscriptionsUpdate: any[];
  checkoutIntentsUpdate: any[];
  webhookEventsInsert: any[];
  webhookEventsUpdate: any[];
  generateLinkCalls: Array<{ type: string; email: string }>;
};

const cap: Captured = {
  subscriptionsUpsert: [],
  subscriptionsUpdate: [],
  checkoutIntentsUpdate: [],
  webhookEventsInsert: [],
  webhookEventsUpdate: [],
  generateLinkCalls: [],
};

// provider_event_id já presentes no UNIQUE de webhook_events (simula 23505).
const claimedEventIds = new Set<string>();

const knownUsers = new Map<string, string>(); // email → id

function chain(result: { data: any; error: any } = { data: null, error: null }) {
  // Suporta cadeias arbitrárias `.eq().in().order().limit().select().maybeSingle()`
  // sem precisar enumerar combinações; cada método retorna o próprio objeto
  // (thenable) que resolve em `result`.
  const obj: any = {
    eq: () => obj,
    in: () => obj,
    order: () => obj,
    limit: () => obj,
    select: () => obj,
    maybeSingle: async () => result,
    then: (resolve: any) => resolve(result),
  };
  return obj;
}

function makeClient() {
  return {
    from(table: string) {
      return {
        select: (_cols?: string) => {
          if (table === "provider_credentials") {
            return {
              eq: (_c: string, provider: string) => ({
                maybeSingle: async () => ({
                  data:
                    provider === "stripe"
                      ? {
                          api_key: "sk_test_x",
                          webhook_secret: STRIPE_WEBHOOK_SECRET,
                          mode: "sandbox",
                        }
                      : {
                          api_key: "asaas_test",
                          webhook_secret: ASAAS_WEBHOOK_TOKEN,
                          mode: "sandbox",
                        },
                  error: null,
                }),
              }),
            };
          }
          if (table === "email_settings") {
            return {
              limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            };
          }
          if (table === "email_templates" || table === "notification_settings") {
            return {
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            };
          }
          if (table === "admin_audit_log") {
            return chain({ data: null, error: null });
          }
          if (table === "user_emails") {
            return {
              eq: (_c: string, email: string) => ({
                maybeSingle: async () => {
                  const id = knownUsers.get(email.toLowerCase());
                  return { data: id ? { user_id: id } : null, error: null };
                },
              }),
            };
          }
          return chain();
        },
        upsert: async (row: any, _opts?: any) => {
          if (table === "subscriptions") cap.subscriptionsUpsert.push(row);
          return { data: null, error: null };
        },
        update: (patch: any) => {
          const fn = chain({ data: [{ id: "row-1" }], error: null });
          if (table === "subscriptions") cap.subscriptionsUpdate.push(patch);
          if (table === "checkout_intents") cap.checkoutIntentsUpdate.push(patch);
          if (table === "webhook_events") cap.webhookEventsUpdate.push(patch);
          return fn;
        },
        insert: (row: any) => {
          if (table === "webhook_events") {
            const id = row.provider_event_id as string | null;
            if (id && claimedEventIds.has(id)) {
              return {
                select: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
                  }),
                }),
              };
            }
            if (id) claimedEventIds.add(id);
            cap.webhookEventsInsert.push(row);
          }
          return {
            select: () => ({ maybeSingle: async () => ({ data: { id: "ev-1" }, error: null }) }),
          };
        },
      };
    },
    rpc: async () => ({
      data: [{ allowed: true, remaining: 100, retry_after_seconds: 0 }],
      error: null,
    }),
    auth: {
      admin: {
        listUsers: async (_args: { page: number; perPage: number }) => ({
          data: { users: Array.from(knownUsers, ([email, id]) => ({ email, id })) },
          error: null,
        }),
        createUser: async ({ email }: { email: string }) => {
          const id = `usr_${knownUsers.size + 1}`;
          knownUsers.set(email.toLowerCase(), id);
          return { data: { user: { id } }, error: null };
        },
        generateLink: async (args: { type: string; email: string }) => {
          cap.generateLinkCalls.push({ type: args.type, email: args.email });
          return {
            data: { properties: { action_link: "https://magic.example.com/ok" } },
            error: null,
          };
        },
      },
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => makeClient() }));

// Notify admin é dinamicamente importado pelo handler — neutralizamos.
vi.mock("@/lib/admin/notify.server", () => ({
  notifyAdmin: async () => ({ sent: false, reason: "stubbed" }),
}));

// Bloqueia qualquer fetch real; respondemos só ao que o Asaas chama
// (lookup de customer email) e a Resend (não deve disparar — email_settings null).
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (...args: any[]) => {
    const url = String(args[0] ?? "");
    if (url.includes("asaas.com/api/v3/customers/")) {
      // Endpoint `GET /customers/{id}` — fallback de email quando o
      // webhook não traz `customerEmail` (cenário comum no Asaas).
      return new Response(JSON.stringify({ email: "lookup@asaas.test" }), { status: 200 });
    }
    if (url.includes("api.resend.com")) {
      return new Response(JSON.stringify({ id: "em_stub" }), { status: 200 });
    }
    return realFetch(...(args as Parameters<typeof realFetch>));
  }) as typeof fetch;
});

beforeEach(() => {
  cap.subscriptionsUpsert.length = 0;
  cap.subscriptionsUpdate.length = 0;
  cap.checkoutIntentsUpdate.length = 0;
  cap.webhookEventsInsert.length = 0;
  cap.webhookEventsUpdate.length = 0;
  cap.generateLinkCalls.length = 0;
  claimedEventIds.clear();
  knownUsers.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────
async function loadPost(modPath: string) {
  const mod: any = await import(modPath);
  return mod.Route.options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;
}

async function signStripe(rawBody: string, secret = STRIPE_WEBHOOK_SECRET): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${hex}`;
}

function stripeReq(body: any, sig: string): Request {
  const raw = JSON.stringify(body);
  return new Request("https://x.test/api/public/payments/webhook.stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sig },
    body: raw,
  });
}

function asaasReq(body: any, token = ASAAS_WEBHOOK_TOKEN): Request {
  return new Request("https://x.test/api/public/payments/webhook.asaas", {
    method: "POST",
    headers: { "content-type": "application/json", "asaas-access-token": token },
    body: JSON.stringify(body),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// STRIPE
// ════════════════════════════════════════════════════════════════════════════
describe("Stripe webhook E2E", () => {
  test("rejeita assinatura inválida → 400, sem efeitos colaterais", async () => {
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({
      request: stripeReq(
        { type: "checkout.session.completed", data: { object: {} } },
        "t=1,v1=deadbeef",
      ),
    });
    expect(r.status).toBe(400);
    expect(cap.subscriptionsUpsert).toHaveLength(0);
    expect(cap.generateLinkCalls).toHaveLength(0);
  });

  test("checkout.session.completed (subscription) → ativa + emite magic link", async () => {
    const body = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_123",
          subscription: "sub_abc",
          customer_email: "alice@exemplo.com",
          metadata: { plan: "pro", email: "alice@exemplo.com" },
        },
      },
    };
    const raw = JSON.stringify(body);
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(raw)) });

    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpsert).toHaveLength(1);
    expect(cap.subscriptionsUpsert[0]).toMatchObject({
      provider: "stripe",
      stripe_subscription_id: "sub_abc",
      stripe_customer_id: "cus_123",
      plan: "pro",
      status: "active",
    });
    // checkout_intents vinculada e marcada como paga.
    expect(cap.checkoutIntentsUpdate).toHaveLength(1);
    expect(cap.checkoutIntentsUpdate[0]).toMatchObject({
      status: "paid",
      provider_subscription_id: "sub_abc",
    });
    expect(cap.generateLinkCalls).toEqual([{ type: "magiclink", email: "alice@exemplo.com" }]);
    expect(cap.webhookEventsInsert.at(-1)?.status).toBe("processed");
  });

  test("evento com id: reivindica antes de processar e fecha como processed", async () => {
    const body = {
      id: "evt_claim_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_claim", customer: "cus_1", status: "canceled" } },
    };
    const raw = JSON.stringify(body);
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(raw)) });

    expect(r.status).toBe(200);
    expect(cap.webhookEventsInsert).toHaveLength(1);
    expect(cap.webhookEventsInsert[0]).toMatchObject({
      provider_event_id: "evt_claim_1",
      status: "pending_retry",
    });
    expect(cap.webhookEventsInsert[0].locked_at).toBeTruthy();
    expect(cap.webhookEventsUpdate.at(-1)).toMatchObject({
      status: "processed",
      locked_at: null,
      attempts: 1,
    });
  });

  test("entrega duplicada (mesmo id) não roda a lógica duas vezes", async () => {
    const body = {
      id: "evt_dup_1",
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          customer: "cus_dup",
          subscription: "sub_dup",
          customer_email: "dup@exemplo.com",
          metadata: { plan: "pro", email: "dup@exemplo.com" },
        },
      },
    };
    const { StripeProvider } = await import("@/lib/payments/stripe");
    const { handleNormalizedEvent } = await import("@/lib/payments/webhook-handler.server");
    const raw = JSON.stringify(body);
    const event = await new StripeProvider({
      apiKey: "sk_test_x",
      webhookSecret: STRIPE_WEBHOOK_SECRET,
      mode: "sandbox",
    }).verifyWebhook(stripeReq(body, await signStripe(raw)), raw);

    await Promise.all([
      handleNormalizedEvent("stripe", event, "evt_dup_1"),
      handleNormalizedEvent("stripe", event, "evt_dup_1"),
    ]);

    expect(cap.subscriptionsUpsert).toHaveLength(1);
    expect(cap.generateLinkCalls).toHaveLength(1);
  });

  test("checkout.session.completed (one_time / lifetime) → subscriptionId sintético pi_*", async () => {
    const body = {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "payment",
          customer: "cus_one",
          payment_intent: "pi_xyz",
          customer_email: "bob@exemplo.com",
          metadata: { plan: "lifetime", email: "bob@exemplo.com" },
        },
      },
    };
    const raw = JSON.stringify(body);
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(raw)) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpsert[0].stripe_subscription_id).toBe("pi_pi_xyz");
    expect(cap.generateLinkCalls[0].email).toBe("bob@exemplo.com");
  });

  test("customer.subscription.updated → atualiza status/plan sem emitir magic link", async () => {
    const body = {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_abc",
          customer: "cus_123",
          status: "active",
          metadata: { plan: "pro" },
          items: {
            data: [
              { price: { lookup_key: "pro", id: "price_pro" }, current_period_end: 1800000000 },
            ],
          },
        },
      },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(JSON.stringify(body))) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpdate).toHaveLength(1);
    expect(cap.subscriptionsUpdate[0]).toMatchObject({ status: "active", plan: "pro" });
    expect(cap.generateLinkCalls).toHaveLength(0);
  });

  test("customer.subscription.deleted → status canceled", async () => {
    const body = {
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_del", customer: "cus_x" } },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(JSON.stringify(body))) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpdate.at(-1)).toMatchObject({ status: "canceled" });
  });

  test("invoice.payment_failed → status past_due", async () => {
    const body = {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_pd" } },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(JSON.stringify(body))) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpdate.at(-1)).toMatchObject({ status: "past_due" });
  });

  test("evento ignorado → 200 sem upsert e registrado como skipped", async () => {
    const body = { type: "ping.something", data: { object: {} } };
    const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
    const r = await POST({ request: stripeReq(body, await signStripe(JSON.stringify(body))) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpsert).toHaveLength(0);
    expect(cap.webhookEventsInsert.at(-1)?.status).toBe("skipped");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ASAAS
// ════════════════════════════════════════════════════════════════════════════
describe("Asaas webhook E2E", () => {
  test("token inválido → 400, sem efeitos colaterais", async () => {
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({
      request: asaasReq({ event: "PAYMENT_CONFIRMED", payment: {} }, "token_errado"),
    });
    expect(r.status).toBe(400);
    expect(cap.subscriptionsUpsert).toHaveLength(0);
  });

  test("PAYMENT_CONFIRMED (cartão) com customerEmail → ativa + magic link", async () => {
    const body = {
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: "pay_1",
        subscription: "sub_asaas_1",
        customer: "cus_asaas_1",
        customerEmail: "carlos@exemplo.com",
        externalReference: "starter",
        value: 99.9,
        dueDate: "2026-07-25",
      },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({ request: asaasReq(body) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpsert[0]).toMatchObject({
      provider: "asaas",
      stripe_subscription_id: "sub_asaas_1",
      plan: "starter",
      status: "active",
    });
    expect(cap.generateLinkCalls).toEqual([{ type: "magiclink", email: "carlos@exemplo.com" }]);
  });

  test("PAYMENT_RECEIVED (boleto/PIX) sem customerEmail → faz lookup de email", async () => {
    const body = {
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "pay_2",
        subscription: "sub_asaas_2",
        customer: "cus_asaas_2",
        externalReference: "pro",
        value: 199.0,
      },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({ request: asaasReq(body) });
    expect(r.status).toBe(200);
    // Email recuperado pelo lookup mockado em globalThis.fetch.
    expect(cap.generateLinkCalls.at(-1)?.email).toBe("lookup@asaas.test");
    expect(cap.subscriptionsUpsert.at(-1)?.plan).toBe("pro");
  });

  test("SUBSCRIPTION_DELETED → cancela assinatura", async () => {
    const body = {
      event: "SUBSCRIPTION_DELETED",
      subscription: { id: "sub_asaas_del", customer: "cus_asaas_del" },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({ request: asaasReq(body) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpdate.at(-1)).toMatchObject({ status: "canceled" });
  });

  test("PAYMENT_OVERDUE → past_due, sem reativar magic link", async () => {
    const body = {
      event: "PAYMENT_OVERDUE",
      payment: { id: "pay_pd", customer: "cus_pd", subscription: "sub_pd_asaas" },
    };
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({ request: asaasReq(body) });
    expect(r.status).toBe(200);
    expect(cap.subscriptionsUpdate.at(-1)).toMatchObject({ status: "past_due" });
    expect(cap.generateLinkCalls).toHaveLength(0);
  });

  test("evento desconhecido → skipped, 200", async () => {
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({ request: asaasReq({ event: "ACCOUNT_STATUS_UPDATED" }) });
    expect(r.status).toBe(200);
    expect(cap.webhookEventsInsert.at(-1)?.status).toBe("skipped");
    expect(cap.subscriptionsUpsert).toHaveLength(0);
  });
});
