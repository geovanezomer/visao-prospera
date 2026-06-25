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
// Mockamos Supabase (admin client) e o resolver de provider para que o
// teste rode 100% offline e determinístico. O HMAC é real — usamos a
// var de ambiente CHECKOUT_INTENT_HMAC_SECRET injetada no setup.
// ============================================================================

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Setup global: secret HMAC + APP_URL + Supabase envs ────────────────────
process.env.CHECKOUT_INTENT_HMAC_SECRET ??= "test-secret-do-nao-use-em-prod-32+chars";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key-stub";
process.env.APP_URL ??= "https://app.example.com";

// ─── Mock de @supabase/supabase-js ──────────────────────────────────────────
// Tabela em memória + RPC controlável via `mockState` que os testes ajustam
// turno a turno (intents, allowed do rate-limit, email_settings, etc.).
type RlOutcome = { allowed: boolean; remaining: number; retry_after_seconds: number };
const mockState = {
  intents: new Map<string, any>(),
  rlOutcomes: [] as RlOutcome[],
  rlDefaultAllowed: true,
  emailSettings: null as any,
  generateLinkResult: {
    data: { properties: { action_link: "https://magic.example.com/xyz" } },
    error: null as { message: string } | null,
  },
  // Captura chamadas para asserts
  generateLinkCalls: [] as Array<{ type: string; email: string }>,
  resendFetchCalls: 0,
};

function makeClient() {
  const from = (table: string) => ({
    select: (_cols?: string) => ({
      eq: (_col: string, val: string) => ({
        maybeSingle: async () => {
          if (table === "checkout_intents") {
            const row = mockState.intents.get(val);
            return { data: row ?? null, error: null };
          }
          if (table === "email_settings") {
            return { data: mockState.emailSettings, error: null };
          }
          return { data: null, error: null };
        },
      }),
      limit: (_n: number) => ({
        maybeSingle: async () => ({ data: mockState.emailSettings, error: null }),
      }),
    }),
    update: (_patch: any) => ({
      eq: async (_c: string, _v: string) => ({ data: null, error: null }),
    }),
    insert: async (_row: any) => ({ data: null, error: null }),
  });

  return {
    from,
    rpc: async (name: string, _args: any) => {
      if (name === "rl_consume") {
        const next = mockState.rlOutcomes.shift();
        const out =
          next ??
          (mockState.rlDefaultAllowed
            ? { allowed: true, remaining: 99, retry_after_seconds: 0 }
            : { allowed: false, remaining: 0, retry_after_seconds: 30 });
        return { data: [out], error: null };
      }
      return { data: null, error: null };
    },
    auth: {
      admin: {
        generateLink: async (args: { type: string; email: string }) => {
          mockState.generateLinkCalls.push({ type: args.type, email: args.email });
          return mockState.generateLinkResult;
        },
      },
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => makeClient(),
}));

// Mock global fetch para Resend (não dispara rede real).
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (...args: any[]) => {
    const url = String(args[0] ?? "");
    if (url.includes("api.resend.com")) {
      mockState.resendFetchCalls++;
      return new Response(JSON.stringify({ id: "em_stub" }), { status: 200 });
    }
    return realFetch(...(args as Parameters<typeof realFetch>));
  }) as typeof fetch;
});

beforeEach(() => {
  mockState.intents.clear();
  mockState.rlOutcomes = [];
  mockState.rlDefaultAllowed = true;
  mockState.emailSettings = null;
  mockState.generateLinkResult = {
    data: { properties: { action_link: "https://magic.example.com/xyz" } },
    error: null,
  };
  mockState.generateLinkCalls = [];
  mockState.resendFetchCalls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    mockState.rlOutcomes = [{ allowed: false, remaining: 0, retry_after_seconds: 42 }];
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
    mockState.intents.set(k, {
      status: "paid",
      plan_slug: "starter",
      with_upsell: false,
      currency: "BRL",
      plan_amount_cents: 9900,
      upsell_amount_cents: null,
      provider: "stripe",
      confirmed_at: "2026-06-25T10:00:00Z",
      updated_at: "2026-06-25T10:00:00Z",
      last_error: null,
      email: "geovane@exemplo.com",
    });
    const t = await signIntentKey(k);
    const h = await loadHandler("@/routes/api/public/payments/intent-status", "GET");
    const r = await h({ request: req(`https://x.test/?i=${encodeURIComponent(t)}`) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("paid");
    expect(body.planAmountCents).toBe(9900);
    // Email original NÃO deve aparecer (mascarado).
    expect(body.emailMasked).toMatch(/^g\*\*\*e@exemplo\.com$/);
    expect(JSON.stringify(body)).not.toContain("geovane@exemplo.com");
  });

  test("failed → expõe last_error", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "1111111111111111aaaaaaaaaaaaaaaa";
    mockState.intents.set(k, {
      status: "failed",
      plan_slug: "pro",
      with_upsell: false,
      currency: "BRL",
      plan_amount_cents: 0,
      upsell_amount_cents: null,
      provider: "asaas",
      confirmed_at: null,
      updated_at: "2026-06-25T10:00:00Z",
      last_error: "auto-reconciled (janela: asaas 72h)",
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
    mockState.rlOutcomes = [{ allowed: false, remaining: 0, retry_after_seconds: 30 }];
    const r = await call({ i: t });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect(await r.json()).toMatchObject({ error: "rate_limited", retryAfter: 30 });
  });

  test("intent não paga → 409", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "2222222222222222bbbbbbbbbbbbbbbb";
    mockState.intents.set(k, { email: "u@x.com", status: "created", plan_slug: "starter" });
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

  test("happy path: gera link + chama Resend quando configurado", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "4444444444444444dddddddddddddddd";
    mockState.intents.set(k, { email: "alice@exemplo.com", status: "paid", plan_slug: "pro" });
    mockState.emailSettings = {
      resend_api_key: "re_stub",
      from_email: "no-reply@exemplo.com",
      from_name: "Finnance",
    };
    const t = await signIntentKey(k);
    const r = await call({ i: t });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sent: true });
    expect(mockState.generateLinkCalls).toHaveLength(1);
    expect(mockState.generateLinkCalls[0]).toMatchObject({
      type: "magiclink",
      email: "alice@exemplo.com",
    });
    expect(mockState.resendFetchCalls).toBe(1);
  });

  test("happy path sem config Resend → ok:true, sent:false", async () => {
    const { signIntentKey } = await import("@/lib/intentToken.server");
    const k = "5555555555555555eeeeeeeeeeeeeeee";
    mockState.intents.set(k, { email: "bob@x.com", status: "paid", plan_slug: "starter" });
    // emailSettings = null e nenhum RESEND_API_KEY no env → degrada bem.
    delete process.env.RESEND_API_KEY;
    const t = await signIntentKey(k);
    const r = await call({ i: t });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, sent: false });
    expect(mockState.resendFetchCalls).toBe(0);
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
    mockState.rlOutcomes = [{ allowed: false, remaining: 0, retry_after_seconds: 60 }];
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
