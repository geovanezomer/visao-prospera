// ============================================================================
// Testes end-to-end (integração) do fluxo de checkout:
//   checkout → página de sucesso → intent-status → resend-magic-link
//
// Cobrimos:
//   1. HMAC do token `i=` (assinatura, verificação, tamper, formato).
//   2. Endpoint /intent-status: token inválido (400), rate-limit (429),
//      intent inexistente (404), happy path (paid + email mascarado).
//   3. Endpoint /resend-magic-link: HMAC inválido (400), rate-limit por
//      minuto (429 com Retry-After), intent não paga (409), happy path.
//   4. Endpoint /checkout: payload inválido (400), token assinado na URL.
//
// Banco real em memória (PGlite). Mockamos só o magic link, o mailer, o
// fetch do provedor e — quando o teste precisa forçar 429 — o rate limit.
// O HMAC é real (CHECKOUT_INTENT_HMAC_SECRET injetada no setup).
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";

// ─── Setup global: secret HMAC + APP_URL ────────────────────────────────────
process.env.CHECKOUT_INTENT_HMAC_SECRET ??= "test-secret-do-nao-use-em-prod-32+chars";
process.env.APP_URL ??= "https://app.example.com";

// ─── Rate limit controlável (o real usa o banco; aqui forçamos negações) ────
type RlOutcome = { allowed: boolean; remaining: number; retryAfter: number };
const rlQueue: RlOutcome[] = [];
vi.mock("@/lib/rateLimit.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rateLimit.server")>();
  return {
    ...real,
    rlConsume: async (...args: Parameters<typeof real.rlConsume>) =>
      rlQueue.shift() ?? real.rlConsume(...args),
  };
});

// ─── Magic link + mailer ────────────────────────────────────────────────────
const mockState = {
  magicLinkCalls: [] as Array<{ email: string; callbackPath?: string }>,
  magicLinkFails: false,
  mailCalls: [] as Array<{ to: string; html: string }>,
  mailResult: { sent: true, via: "smtp" } as { sent: boolean; via: string },
};
vi.mock("@/lib/magicLink.server", () => ({
  generateMagicLink: async (email: string, callbackPath?: string) => {
    if (mockState.magicLinkFails) throw new Error("falhou");
    mockState.magicLinkCalls.push({ email, callbackPath });
    return "https://app.example.com/api/auth/magic-link/verify?token=xyz";
  },
}));
vi.mock("@/lib/mailer.server", () => ({
  sendMail: async (m: { to: string; html: string }) => {
    mockState.mailCalls.push(m);
    return mockState.mailResult;
  },
  isMailConfigured: () => mockState.mailResult.via !== "none",
}));

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

beforeEach(async () => {
  await t.client.exec(
    'TRUNCATE "checkout_intents", "rate_limit_buckets", "plans", "provider_credentials", "app_settings" CASCADE',
  );
  rlQueue.length = 0;
  mockState.magicLinkCalls = [];
  mockState.magicLinkFails = false;
  mockState.mailCalls = [];
  mockState.mailResult = { sent: true, via: "smtp" };
});

type IntentSeed = Partial<typeof schema.checkoutIntents.$inferInsert> & {
  idempotencyKey: string;
  email: string;
};
async function seedIntent(i: IntentSeed) {
  await t.db.insert(schema.checkoutIntents).values({
    planSlug: "starter",
    provider: "stripe",
    status: "created",
    ...i,
  });
}

// ─── Utilitários ────────────────────────────────────────────────────────────
async function loadHandler(modPath: string, method: "GET" | "POST") {
  const mod: any = await import(modPath);
  return mod.Route.options.server.handlers[method] as (ctx: {
    request: Request;
  }) => Promise<Response>;
}

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. HMAC token (intentToken.server.ts)
// ════════════════════════════════════════════════════════════════════════════
describe("HMAC intent token", () => {
  test("assinatura e verificação roundtrip", async () => {
    const { signIntentKey, verifyIntentToken } = await import("@/lib/intentToken.server");
    const key = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const token = await signIntentKey(key);
    expect(token).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{32}$/);
    expect(await verifyIntentToken(token)).toBe(key);
  });

  test("assinatura adulterada → null", async () => {
    const { signIntentKey, verifyIntentToken } = await import("@/lib/intentToken.server");
    const token = await signIntentKey("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    const [k, sig] = token.split(".");
    // Flip do primeiro byte da assinatura.
    const tampered = `${k}.${sig[0] === "0" ? "1" : "0"}${sig.slice(1)}`;
    expect(await verifyIntentToken(tampered)).toBeNull();
  });

  test("key adulterada → null (assinatura não bate)", async () => {
    const { signIntentKey, verifyIntentToken } = await import("@/lib/intentToken.server");
    const token = await signIntentKey("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    const sig = token.split(".")[1];
    const fakeKey = "f0e1d2c3b4a5968778695a4b3c2d1e0f";
    expect(await verifyIntentToken(`${fakeKey}.${sig}`)).toBeNull();
  });

  test("formato inválido / vazio → null", async () => {
    const { verifyIntentToken } = await import("@/lib/intentToken.server");
    expect(await verifyIntentToken(null)).toBeNull();
    expect(await verifyIntentToken("")).toBeNull();
    expect(await verifyIntentToken("semponto")).toBeNull();
    expect(await verifyIntentToken("muitos.pontos.aqui")).toBeNull();
    expect(await verifyIntentToken("ZZZ.YYY")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. /api/public/payments/intent-status
// ════════════════════════════════════════════════════════════════════════════
describe("GET /intent-status", () => {
  test("token inválido → 400 invalid_key", async () => {
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req("https://x.test/?i=lixo.invalido") });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid_key" });
  });

  test("token ausente → 400", async () => {
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req("https://x.test/") });
    expect(r.status).toBe(400);
  });

  test("rate-limit excedido → 429 com Retry-After", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "abcdef0123456789abcdef0123456789";
    const t = await signIntentKey(k);
    rlQueue.push({ allowed: false, remaining: 0, retryAfter: 42 });
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req(`https://x.test/?i=${encodeURIComponent(t)}`) });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });

  test("intent inexistente → 404 unknown", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const t = await signIntentKey("abcdef0123456789abcdef0123456789");
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req(`https://x.test/?i=${encodeURIComponent(t)}`) });
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ status: "unknown" });
  });

  test("happy path: paid + email mascarado", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "abcdef0123456789abcdef0123456789";
    await seedIntent({
      idempotencyKey: k,
      status: "paid",
      planSlug: "starter",
      currency: "BRL",
      planAmountCents: 9900,
      provider: "stripe",
      confirmedAt: "2026-06-25T10:00:00Z",
      email: "geovane@exemplo.com",
    });
    const t = await signIntentKey(k);
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req(`https://x.test/?i=${encodeURIComponent(t)}`) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("paid");
    expect(body.planAmountCents).toBe(9900);
    expect(body.confirmedAt).toBe("2026-06-25T10:00:00.000Z");
    // Email original NÃO deve aparecer (mascarado).
    expect(body.emailMasked).toMatch(/^g\*\*\*e@exemplo\.com$/);
    expect(JSON.stringify(body)).not.toContain("geovane@exemplo.com");
  });

  test("failed → expõe last_error", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "1111111111111111aaaaaaaaaaaaaaaa";
    await seedIntent({
      idempotencyKey: k,
      status: "failed",
      planSlug: "pro",
      currency: "BRL",
      planAmountCents: 0,
      provider: "asaas",
      lastError: "auto-reconciled (janela: asaas 72h)",
      email: "u@x.com",
    });
    const t = await signIntentKey(k);
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req(`https://x.test/?i=${encodeURIComponent(t)}`) });
    const body = await r.json();
    expect(body.status).toBe("failed");
    expect(body.lastError).toContain("asaas 72h");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. /api/public/payments/resend-magic-link
// ════════════════════════════════════════════════════════════════════════════
describe("POST /resend-magic-link", () => {
  async function call(body: any) {
    const h = await loadHandler("@/routes/api/public/payments/resend-magic-link", "POST");
    return h({
      request: req("https://x.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  }

  test("HMAC inválido → 400 invalid_key", async () => {
    const r = await call({ i: "lixo.invalido" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid_key" });
  });

  test("rate-limit por minuto → 429 com Retry-After", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const t = await signIntentKey("abcdef0123456789abcdef0123456789");
    rlQueue.push({ allowed: false, remaining: 0, retryAfter: 30 });
    const r = await call({ i: t });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect(await r.json()).toMatchObject({ error: "rate_limited", retryAfter: 30 });
  });

  test("intent não paga → 409", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "2222222222222222bbbbbbbbbbbbbbbb";
    await seedIntent({ idempotencyKey: k, email: "u@x.com", status: "created" });
    const t = await signIntentKey(k);
    const r = await call({ i: t });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "not_paid", status: "created" });
  });

  test("intent não encontrada → 404", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const t = await signIntentKey("3333333333333333cccccccccccccccc");
    const r = await call({ i: t });
    expect(r.status).toBe(404);
  });

  test("happy path: gera link e envia pelo mailer", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "4444444444444444dddddddddddddddd";
    await seedIntent({ idempotencyKey: k, email: "alice@exemplo.com", status: "paid" });
    const t2 = await signIntentKey(k);
    const r = await call({ i: t2 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sent: true });
    expect(mockState.magicLinkCalls).toEqual([
      { email: "alice@exemplo.com", callbackPath: "/app" },
    ]);
    expect(mockState.mailCalls).toHaveLength(1);
    expect(mockState.mailCalls[0].to).toBe("alice@exemplo.com");
    expect(mockState.mailCalls[0].html).toContain("magic-link/verify");
  });

  test("sem envio configurado → ok:true, sent:false", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "5555555555555555eeeeeeeeeeeeeeee";
    await seedIntent({ idempotencyKey: k, email: "bob@x.com", status: "paid" });
    mockState.mailResult = { sent: false, via: "none" };
    const r = await call({ i: await signIntentKey(k) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sent: false });
  });

  test("falha ao gerar link → 500 link_failed", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "6666666666666666ffffffffffffffff";
    await seedIntent({ idempotencyKey: k, email: "c@x.com", status: "paid" });
    mockState.magicLinkFails = true;
    const r = await call({ i: await signIntentKey(k) });
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ error: "link_failed" });
    expect(mockState.mailCalls).toHaveLength(0);
  });

  test("limite real por minuto (banco): segundo reenvio → 429", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "7777777777777777aaaaaaaaaaaaaaaa";
    await seedIntent({ idempotencyKey: k, email: "d@x.com", status: "paid" });
    const tok = await signIntentKey(k);
    expect((await call({ i: tok })).status).toBe(200);
    const second = await call({ i: tok });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. /api/public/payments/checkout — apenas guardas que não exigem provider
// ════════════════════════════════════════════════════════════════════════════
describe("POST /checkout (guardas)", () => {
  test("payload inválido (email faltando) → 400 invalid_payload", async () => {
    const h = await loadHandler("@/routes/api/public/payments/checkout", "POST");
    const r = await h({
      request: req("https://x.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "starter" }),
      }),
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "invalid_payload" });
  });

  test("slug com caracteres inválidos → 400", async () => {
    const h = await loadHandler("@/routes/api/public/payments/checkout", "POST");
    const r = await h({
      request: req("https://x.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: "Plano Top!", email: "u@x.com" }),
      }),
    });
    expect(r.status).toBe(400);
  });

  test("rate-limit por IP excedido → 429", async () => {
    rlQueue.push({ allowed: false, remaining: 0, retryAfter: 60 });
    const h = await loadHandler("@/routes/api/public/payments/checkout", "POST");
    const r = await h({
      request: req("https://x.test/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        body: JSON.stringify({ plan: "starter", email: "u@x.com" }),
      }),
    });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. /api/public/payments/checkout — fluxo completo com o banco
// ════════════════════════════════════════════════════════════════════════════
describe("POST /checkout (intenção persistida)", () => {
  const realFetch = globalThis.fetch;
  let stripeCalls = 0;
  let stripeFails = false;

  beforeEach(async () => {
    stripeCalls = 0;
    stripeFails = false;
    const { invalidateProviderCache } = await import("@/lib/payments");
    invalidateProviderCache();
    await t.db.insert(schema.appSettings).values({
      key: "active_provider",
      value: { provider: "stripe" },
    });
    await t.db.insert(schema.providerCredentials).values({
      provider: "stripe",
      apiKey: "sk_test_x",
      isActive: true,
    });
    await t.db.insert(schema.plans).values({
      slug: "starter",
      name: "Starter",
      priceCents: 4990,
      currency: "brl",
      interval: "month",
      stripePriceId: "price_starter",
    });
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0] ?? "");
      if (url.startsWith("https://api.stripe.com/v1/checkout/sessions")) {
        stripeCalls++;
        if (stripeFails) {
          return new Response(JSON.stringify({ error: { message: "cartão recusado" } }), {
            status: 400,
          });
        }
        return new Response(
          JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1", customer: null }),
          { status: 200 },
        );
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  async function checkout(body: Record<string, unknown>) {
    const h = await loadHandler("@/routes/api/public/payments/checkout", "POST");
    return h({
      request: req("https://x.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  }

  test("cria intenção redirected com token assinado na success_url; reenvio reutiliza", async () => {
    const r = await checkout({ plan: "starter", email: "Novo@X.com", name: "Fulano Silva" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      url: "https://checkout.stripe.com/c/cs_1",
      provider: "stripe",
    });
    const [intent] = await t.db.select().from(schema.checkoutIntents);
    expect(intent).toMatchObject({
      email: "novo@x.com",
      planSlug: "starter",
      status: "redirected",
      checkoutUrl: "https://checkout.stripe.com/c/cs_1",
      providerSessionId: "cs_1",
      planAmountCents: 4990,
      currency: "BRL",
    });
    expect(intent.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);

    const again = await checkout({ plan: "starter", email: "novo@x.com", name: "Fulano Silva" });
    expect(await again.json()).toMatchObject({ reused: true });
    expect(stripeCalls).toBe(1);
    expect(await t.db.select().from(schema.checkoutIntents)).toHaveLength(1);
  });

  test("provedor recusa → 422 e intenção registrada como failed", async () => {
    stripeFails = true;
    const r = await checkout({ plan: "starter", email: "f@x.com", name: "Fulano Silva" });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: "provider_error" });
    const [intent] = await t.db.select().from(schema.checkoutIntents);
    expect(intent.status).toBe("failed");
    expect(intent.lastError).toContain("cartão recusado");
  });

  test("plano inexistente → 404", async () => {
    const r = await checkout({ plan: "nao_existe", email: "f@x.com", name: "Fulano Silva" });
    expect(r.status).toBe(404);
  });
});
