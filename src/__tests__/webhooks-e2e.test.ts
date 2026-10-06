// ============================================================================
// Testes end-to-end dos webhooks de pagamento (Stripe + Asaas).
//
// Banco: PostgreSQL real em memória (PGlite) com o esquema da produção.
// Para cada provedor e método de pagamento, montamos um payload real,
// assinamos como o provedor faria (HMAC-SHA256 no Stripe / `asaas-access-token`
// no Asaas), batemos no handler HTTP e validamos:
//
//   1. Transição de estado em `checkout_intents` (created → paid).
//   2. Upsert em `subscriptions` com os campos certos.
//   3. Emissão do magic link (generateMagicLink) e envio pelo mailer.
//   4. Persistência do evento em `webhook_events` (status processed).
//   5. Falha de assinatura → HTTP 400, sem nenhuma escrita lateral.
//   6. Idempotência atômica (claim no UNIQUE) e retry/dead-letter.
//
// Rede externa: só fetch stubado (lookup de cliente no Asaas).
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";

// ─── Envs determinísticas ───────────────────────────────────────────────────
process.env.CHECKOUT_INTENT_HMAC_SECRET ??= "test-secret-do-nao-use-em-prod-32+chars";
process.env.BETTER_AUTH_SECRET ??= "better-auth-secret-de-teste-com-mais-de-32-chars";
process.env.APP_URL ??= "https://app.example.com";

const STRIPE_WEBHOOK_SECRET = "whsec_test_stripe_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const ASAAS_WEBHOOK_TOKEN = "asaas_test_token_xxxxxxxxxxxxxxxxxxxxxxx";

// ─── Mocks de efeitos externos ──────────────────────────────────────────────
const magicLinkCalls: Array<{ email: string; callbackPath?: string }> = [];
vi.mock("@/lib/magicLink.server", () => ({
  generateMagicLink: async (email: string, callbackPath?: string) => {
    magicLinkCalls.push({ email, callbackPath });
    return "https://app.example.com/api/auth/magic-link/verify?token=stub";
  },
}));

const mailCalls: Array<{ to: string; subject: string }> = [];
vi.mock("@/lib/mailer.server", () => ({
  sendMail: async (m: { to: string; subject: string }) => {
    mailCalls.push({ to: m.to, subject: m.subject });
    return { sent: true, via: "smtp" };
  },
  isMailConfigured: () => true,
}));

const notifyMock = vi.fn(async () => ({ sent: false, reason: "stubbed" }));
vi.mock("@/lib/admin/notify.server", () => ({
  notifyAdmin: (...a: unknown[]) => (notifyMock as (...x: unknown[]) => unknown)(...a),
}));

// Bloqueia qualquer fetch real; respondemos só ao lookup de cliente do Asaas.
const realFetch = globalThis.fetch;
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0] ?? "");
    if (url.includes("asaas.com") && url.includes("/customers/")) {
      // `GET /customers/{id}` — fallback de email quando o webhook não traz `customerEmail`.
      return new Response(JSON.stringify({ email: "lookup@asaas.test" }), { status: 200 });
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await t.close();
});

async function resetDb() {
  const res = await t.client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = res.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await t.client.exec(`TRUNCATE ${names} CASCADE`);
}

beforeEach(async () => {
  await resetDb();
  magicLinkCalls.length = 0;
  mailCalls.length = 0;
  notifyMock.mockReset();
  notifyMock.mockResolvedValue({ sent: false, reason: "stubbed" });
  await t.db.insert(schema.providerCredentials).values([
    { provider: "stripe", apiKey: "sk_test_x", webhookSecret: STRIPE_WEBHOOK_SECRET },
    { provider: "asaas", apiKey: "asaas_test", webhookSecret: ASAAS_WEBHOOK_TOKEN },
  ]);
});

// ─── Helpers ────────────────────────────────────────────────────────────────
type Handler = (ctx: { request: Request }) => Promise<Response>;
async function loadPost(modPath: string): Promise<Handler> {
  const mod = (await import(modPath)) as {
    Route: { options: { server: { handlers: { POST: Handler } } } };
  };
  return mod.Route.options.server.handlers.POST;
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

function stripeReq(body: unknown, sig: string): Request {
  return new Request("https://x.test/api/public/payments/webhook.stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sig },
    body: JSON.stringify(body),
  });
}

async function postStripe(body: unknown): Promise<Response> {
  const POST = await loadPost("@/routes/api/public/payments/webhook.stripe");
  return POST({ request: stripeReq(body, await signStripe(JSON.stringify(body))) });
}

function asaasReq(body: unknown, token = ASAAS_WEBHOOK_TOKEN): Request {
  return new Request("https://x.test/api/public/payments/webhook.asaas", {
    method: "POST",
    headers: { "content-type": "application/json", "asaas-access-token": token },
    body: JSON.stringify(body),
  });
}

const subscriptions = () => t.db.select().from(schema.subscriptions);
const events = () => t.db.select().from(schema.webhookEvents);
async function subBy(id: string) {
  const [row] = await t.db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.stripeSubscriptionId, id));
  return row;
}

async function seedSubscription(userEmail: string, subId: string, status = "active") {
  const { createAppUser } = await import("@/lib/users.server");
  const u = await createAppUser({ email: userEmail });
  await t.db.insert(schema.subscriptions).values({
    userId: u.id,
    provider: "stripe",
    stripeSubscriptionId: subId,
    providerCustomerId: "cus_x",
    priceId: "pro",
    plan: "pro",
    status,
  });
  return u;
}

function activatedBody(id: string | undefined, email: string, sub: string) {
  return {
    ...(id ? { id } : {}),
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        customer: `cus_${sub}`,
        subscription: sub,
        customer_email: email,
        metadata: { plan: "pro", email },
      },
    },
  };
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
    expect(await subscriptions()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect(magicLinkCalls).toHaveLength(0);
  });

  test("checkout.session.completed → cria usuário, ativa, vincula intent e envia magic link", async () => {
    await t.db.insert(schema.checkoutIntents).values({
      planSlug: "pro",
      email: "alice@exemplo.com",
      provider: "stripe",
      status: "redirected",
      idempotencyKey: "k1",
    });

    const r = await postStripe(activatedBody(undefined, "alice@exemplo.com", "sub_abc"));
    expect(r.status).toBe(200);

    const [user] = await t.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "alice@exemplo.com"));
    expect(user).toBeDefined();

    const sub = await subBy("sub_abc");
    expect(sub).toMatchObject({
      userId: user.id,
      provider: "stripe",
      stripeCustomerId: "cus_sub_abc",
      providerCustomerId: "cus_sub_abc",
      plan: "pro",
      status: "active",
    });

    const [intent] = await t.db.select().from(schema.checkoutIntents);
    expect(intent).toMatchObject({ status: "paid", providerSubscriptionId: "sub_abc" });
    expect(intent.confirmedAt).toBeTruthy();

    expect(magicLinkCalls).toEqual([{ email: "alice@exemplo.com", callbackPath: "/app" }]);
    expect(mailCalls.map((m) => m.to)).toEqual(["alice@exemplo.com"]);
    expect((await events()).at(-1)?.status).toBe("processed");
  });

  test("ativação de usuário em trial encerra o trial e registra a conversão", async () => {
    const { createAppUser } = await import("@/lib/users.server");
    const u = await createAppUser({
      email: "trial@exemplo.com",
      isTrial: true,
      trialExpiresAt: new Date(Date.now() + 3600_000),
    });
    await postStripe(activatedBody(undefined, "trial@exemplo.com", "sub_trial"));
    const [row] = await t.db.select().from(schema.user).where(eq(schema.user.id, u.id));
    expect(row.isTrial).toBe(false);
    expect(row.trialExpiresAt).toBeNull();
    expect(row.trialConvertedPlan).toBe("pro");
    expect(row.trialConvertedAt).toBeInstanceOf(Date);
    // Não criou usuário duplicado.
    expect(await t.db.select().from(schema.user)).toHaveLength(1);
  });

  test("evento com id: reivindica antes de processar e fecha como processed", async () => {
    await seedSubscription("c@x.com", "sub_claim");
    const r = await postStripe({
      id: "evt_claim_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_claim", customer: "cus_1", status: "canceled" } },
    });
    expect(r.status).toBe(200);
    const evs = await events();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      providerEventId: "evt_claim_1",
      status: "processed",
      lockedAt: null,
      attempts: 1,
      error: null,
    });
    expect(evs[0].attemptHistory).toHaveLength(1);
    expect((await subBy("sub_claim")).status).toBe("canceled");
  });

  test("entrega duplicada concorrente (mesmo id) não roda a lógica duas vezes", async () => {
    const body = activatedBody("evt_dup_1", "dup@exemplo.com", "sub_dup");
    const { StripeProvider } = await import("@/lib/payments/stripe");
    const { handleNormalizedEvent } = await import("@/lib/payments/webhook-handler.server");
    const raw = JSON.stringify(body);
    const event = await new StripeProvider({
      apiKey: "sk_test_x",
      webhookSecret: STRIPE_WEBHOOK_SECRET,
    }).verifyWebhook(stripeReq(body, await signStripe(raw)), raw);

    await Promise.all([
      handleNormalizedEvent("stripe", event, "evt_dup_1"),
      handleNormalizedEvent("stripe", event, "evt_dup_1"),
    ]);
    // Reentrega tardia (depois de processado) também é descartada.
    await handleNormalizedEvent("stripe", event, "evt_dup_1");

    expect(await subscriptions()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
    expect(magicLinkCalls).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  test("violação de UNIQUE é reconhecida com o código do driver (23505)", async () => {
    const { isUniqueViolation } = await import("@/lib/payments/webhook-handler.server");
    let caught: unknown = null;
    const row = {
      provider: "stripe",
      providerEventId: "evt_u",
      eventType: "x",
      status: "processed",
    };
    await t.db.insert(schema.webhookEvents).values(row);
    try {
      await t.db.insert(schema.webhookEvents).values(row);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(isUniqueViolation(caught)).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation(new Error("outro"))).toBe(false);
  });

  test("checkout.session.completed (one_time / lifetime) → subscriptionId sintético pi_*", async () => {
    const r = await postStripe({
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
    });
    expect(r.status).toBe(200);
    expect(await subBy("pi_pi_xyz")).toBeDefined();
    expect(magicLinkCalls[0].email).toBe("bob@exemplo.com");
  });

  test("customer.subscription.updated → atualiza status/plan sem emitir magic link", async () => {
    await seedSubscription("u@x.com", "sub_abc", "past_due");
    const r = await postStripe({
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
    });
    expect(r.status).toBe(200);
    expect(await subBy("sub_abc")).toMatchObject({ status: "active", plan: "pro" });
    expect(magicLinkCalls).toHaveLength(0);
  });

  test("customer.subscription.deleted → status canceled + e-mail ao cliente", async () => {
    await seedSubscription("del@x.com", "sub_del");
    const r = await postStripe({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_del", customer: "cus_x" } },
    });
    expect(r.status).toBe(200);
    expect((await subBy("sub_del")).status).toBe("canceled");
    expect(mailCalls.map((m) => m.to)).toEqual(["del@x.com"]);
    const log = await t.db.select().from(schema.emailLog);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "subscription_canceled", subscriptionId: "sub_del" });
  });

  test("invoice.payment_failed → status past_due", async () => {
    await seedSubscription("pd@x.com", "sub_pd");
    const r = await postStripe({
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_x", subscription: "sub_pd" } },
    });
    expect(r.status).toBe(200);
    expect((await subBy("sub_pd")).status).toBe("past_due");
  });

  test("evento ignorado → 200 sem upsert e registrado como skipped", async () => {
    const r = await postStripe({ type: "ping.something", data: { object: {} } });
    expect(r.status).toBe(200);
    expect(await subscriptions()).toHaveLength(0);
    expect((await events()).at(-1)?.status).toBe("skipped");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Retry / dead-letter
// ════════════════════════════════════════════════════════════════════════════
describe("retry com backoff", () => {
  test("falha na 1ª tentativa → pending_retry; worker reprocessa → processed", async () => {
    notifyMock.mockRejectedValueOnce(new Error("slack fora do ar"));
    await postStripe(activatedBody("evt_retry", "retry@x.com", "sub_retry"));

    let [ev] = await events();
    expect(ev).toMatchObject({ status: "pending_retry", attempts: 1, error: "slack fora do ar" });
    expect(ev.lockedAt).toBeNull();
    expect(new Date(ev.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now());

    // Amadurece o retry.
    await t.db
      .update(schema.webhookEvents)
      .set({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.webhookEvents.id, ev.id));

    const { runRetryBatch } = await import("@/lib/payments/webhook-handler.server");
    expect(await runRetryBatch()).toEqual({ picked: 1, ok: 1, failed: 0, deadLetter: 0 });
    [ev] = await events();
    expect(ev).toMatchObject({ status: "processed", attempts: 2, error: null, lockedAt: null });
    expect(ev.attemptHistory).toHaveLength(2);
    // Upsert idempotente: continua uma assinatura só.
    expect(await subscriptions()).toHaveLength(1);
  });

  test("esgotadas as tentativas → dead_letter", async () => {
    notifyMock.mockRejectedValue(new Error("sempre falha"));
    await postStripe(activatedBody("evt_dl", "dl@x.com", "sub_dl"));
    const [ev] = await events();
    await t.db
      .update(schema.webhookEvents)
      .set({ attempts: 5, nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.webhookEvents.id, ev.id));

    const { reprocessWebhookEventRow } = await import("@/lib/payments/webhook-handler.server");
    const r = await reprocessWebhookEventRow(ev.id);
    expect(r).toMatchObject({ ok: false, status: "dead_letter" });
    const [after] = await events();
    expect(after.status).toBe("dead_letter");
    expect(after.nextAttemptAt).toBeNull();
  });

  test("evento travado por outra rotina não é reprocessado", async () => {
    const [ev] = await t.db
      .insert(schema.webhookEvents)
      .values({
        provider: "stripe",
        eventType: "subscription.canceled",
        status: "pending_retry",
        payload: { type: "subscription.canceled", customerId: "c", subscriptionId: "s" },
        lockedAt: new Date().toISOString(),
      })
      .returning();
    const { reprocessWebhookEventRow } = await import("@/lib/payments/webhook-handler.server");
    expect(await reprocessWebhookEventRow(ev.id)).toMatchObject({ ok: false, status: "locked" });
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
    expect(await subscriptions()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  test("PAYMENT_CONFIRMED (cartão) com customerEmail → ativa + magic link", async () => {
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({
      request: asaasReq({
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
      }),
    });
    expect(r.status).toBe(200);
    expect(await subBy("sub_asaas_1")).toMatchObject({
      provider: "asaas",
      stripeCustomerId: null,
      providerCustomerId: "cus_asaas_1",
      plan: "starter",
      status: "active",
    });
    expect(magicLinkCalls.map((c) => c.email)).toEqual(["carlos@exemplo.com"]);
  });

  test("PAYMENT_RECEIVED (boleto/PIX) sem customerEmail → faz lookup de email", async () => {
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({
      request: asaasReq({
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_2",
          subscription: "sub_asaas_2",
          customer: "cus_asaas_2",
          externalReference: "pro",
          value: 199.0,
        },
      }),
    });
    expect(r.status).toBe(200);
    expect(magicLinkCalls.at(-1)?.email).toBe("lookup@asaas.test");
    expect((await subBy("sub_asaas_2")).plan).toBe("pro");
  });

  test("SUBSCRIPTION_DELETED → cancela assinatura", async () => {
    await seedSubscription("a@x.com", "sub_asaas_del");
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({
      request: asaasReq({
        event: "SUBSCRIPTION_DELETED",
        subscription: { id: "sub_asaas_del", customer: "cus_asaas_del" },
      }),
    });
    expect(r.status).toBe(200);
    expect((await subBy("sub_asaas_del")).status).toBe("canceled");
  });

  test("PAYMENT_OVERDUE → past_due, sem reativar magic link", async () => {
    await seedSubscription("o@x.com", "sub_pd_asaas");
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({
      request: asaasReq({
        event: "PAYMENT_OVERDUE",
        payment: { id: "pay_pd", customer: "cus_pd", subscription: "sub_pd_asaas" },
      }),
    });
    expect(r.status).toBe(200);
    expect((await subBy("sub_pd_asaas")).status).toBe("past_due");
    expect(magicLinkCalls).toHaveLength(0);
  });

  test("evento desconhecido → skipped, 200", async () => {
    const POST = await loadPost("@/routes/api/public/payments/webhook.asaas");
    const r = await POST({ request: asaasReq({ event: "ACCOUNT_STATUS_UPDATED" }) });
    expect(r.status).toBe(200);
    expect((await events()).at(-1)?.status).toBe("skipped");
    expect(await subscriptions()).toHaveLength(0);
  });
});
