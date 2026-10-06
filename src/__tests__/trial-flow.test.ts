// ============================================================================
// Trial flow E2E (server-side)
//
// Cobre:
//  1. POST /api/public/trial/request — feliz, honeypot, descartável, desativado,
//     já-usado, falha de envio (rollback de auth.users + trial_requests), falha
//     de configuração de e-mail.
//  2. POST /api/public/trial/activate — marca consumed_at para usuário is_trial.
//  3. Garantia de redirectTo /auth/callback no magic link (evita cair em /login).
//
// Toda a infraestrutura é mockada em memória.
// ============================================================================
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-stub";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "anon-stub";
process.env.APP_URL ??= "https://app.example.com";

// ─── Estado mockado ─────────────────────────────────────────────────────────
type Row = Record<string, any>;
const db: {
  trial_requests: Row[];
  app_settings: Record<string, any>;
  email_settings: Row | null;
  email_templates: Row[];
  users: Map<string, Row>;
} = {
  trial_requests: [],
  app_settings: {
    trial: { enabled: true, duration_hours: 2 },
    branding: { system_name: "Finnance" },
  },
  email_settings: {
    resend_api_key: "re_test",
    from_email: "no-reply@x.com",
    from_name: "Finnance",
  },
  email_templates: [
    {
      kind: "trial_magic_link",
      subject: "Olá {{name}}",
      html: "{{link}}",
      text: "{{link}}",
      enabled: true,
    },
  ],
  users: new Map(),
};

const cap = {
  generateLinkCalls: [] as Array<{ email: string; redirectTo?: string }>,
  resendCalls: [] as Array<{ to: string }>,
};

function reset() {
  db.trial_requests.length = 0;
  db.app_settings = {
    trial: { enabled: true, duration_hours: 2 },
    branding: { system_name: "Finnance" },
  };
  db.email_settings = {
    resend_api_key: "re_test",
    from_email: "no-reply@x.com",
    from_name: "Finnance",
  };
  db.email_templates = [
    {
      kind: "trial_magic_link",
      subject: "Olá {{name}}",
      html: "{{link}}",
      text: "{{link}}",
      enabled: true,
    },
  ];
  db.users.clear();
  cap.generateLinkCalls.length = 0;
  cap.resendCalls.length = 0;
}

// ─── Mock do supabase-js ────────────────────────────────────────────────────
function makeClient(_token?: string) {
  const userFromToken = _token ? db.users.get(_token) : null;
  return {
    from(table: string) {
      const api: any = {
        _table: table,
        _filters: [] as Array<{ k: string; v: any; op: string }>,
        select() {
          return this;
        },
        eq(k: string, v: any) {
          this._filters.push({ k, v, op: "eq" });
          return this;
        },
        is(k: string, v: any) {
          this._filters.push({ k, v, op: "is" });
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          if (table === "trial_requests") {
            const row = db.trial_requests.find((r) =>
              this._filters.every((f: { k: string; v: any }) => r[f.k] === f.v),
            );
            return { data: row ?? null, error: null };
          }
          if (table === "app_settings") {
            const f = this._filters.find((x: { k: string }) => x.k === "key");
            const value = f ? db.app_settings[f.v] : null;
            return { data: value ? { value } : null, error: null };
          }
          if (table === "email_settings") return { data: db.email_settings, error: null };
          if (table === "email_templates") {
            const f = this._filters.find((x: { k: string }) => x.k === "kind");
            const row = db.email_templates.find((t) => t.kind === f?.v) ?? null;
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
        async insert(row: any) {
          if (table === "trial_requests") {
            if (db.trial_requests.some((r) => r.email === row.email)) {
              return { error: { message: "duplicate key" } };
            }
            db.trial_requests.push({ ...row, consumed_at: null });
            return { error: null };
          }
          return { error: null };
        },
        delete() {
          const filters: Array<{ k: string; v: any }> = [];
          const chain: any = {
            eq(k: string, v: any) {
              filters.push({ k, v });
              return chain;
            },
            then(resolve: any) {
              if (table === "trial_requests") {
                db.trial_requests = db.trial_requests.filter(
                  (r) => !filters.every((f) => r[f.k] === f.v),
                );
              }
              resolve({ error: null });
            },
          };
          return chain;
        },
        update(patch: any) {
          return {
            eq: (k: string, v: any) => ({
              is: async (_k2: string, _v2: any) => {
                if (table === "trial_requests") {
                  for (const r of db.trial_requests) {
                    if (r[k] === v && r.consumed_at == null) Object.assign(r, patch);
                  }
                }
                return { error: null };
              },
            }),
          };
        },
      };
      return api;
    },

    rpc: async () => ({
      data: [{ allowed: true, remaining: 100, retry_after_seconds: 0 }],
      error: null,
    }),
    auth: {
      async getUser(token: string) {
        const u = db.users.get(token);
        return u
          ? { data: { user: u }, error: null }
          : { data: { user: null }, error: { message: "no" } };
      },
      admin: {
        async createUser({ email, user_metadata }: any) {
          if ([...db.users.values()].some((u) => u.email === email)) {
            return { data: null, error: { message: "User already registered" } };
          }
          const id = `usr_${db.users.size + 1}`;
          const token = `tok_${id}`;
          db.users.set(token, { id, email, user_metadata });
          return { data: { user: { id, email, user_metadata } }, error: null };
        },
        async deleteUser(id: string) {
          for (const [k, v] of db.users) if (v.id === id) db.users.delete(k);
          return { error: null };
        },
        async generateLink({ email, options }: any) {
          cap.generateLinkCalls.push({ email, redirectTo: options?.redirectTo });
          return { data: { properties: { action_link: "https://magic.example/ok" } }, error: null };
        },
      },
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, opts?: any) => {
    const token = opts?.global?.headers?.Authorization?.replace(/^Bearer\s+/i, "");
    return makeClient(token);
  },
}));

// fetch — Resend
const realFetch = globalThis.fetch;
let resendStatus = 200;
beforeAll(() => {
  globalThis.fetch = (async (...args: any[]) => {
    const url = String(args[0] ?? "");
    if (url.includes("api.resend.com")) {
      const body = JSON.parse((args[1]?.body as string) ?? "{}");
      cap.resendCalls.push({ to: body.to });
      return new Response(JSON.stringify({ id: "em_1" }), { status: resendStatus });
    }
    return realFetch(...(args as Parameters<typeof realFetch>));
  }) as typeof fetch;
});

beforeEach(() => {
  reset();
  resendStatus = 200;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────
async function loadPost(modPath: string) {
  const mod: any = await import(modPath);
  return mod.Route.options.server.handlers.POST as (ctx: { request: Request }) => Promise<Response>;
}

const POST_REQUEST = () => loadPost("../routes/api/public/trial/request");
const POST_ACTIVATE = () => loadPost("../routes/api/public/trial/activate");

function jsonReq(url: string, body: any, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Testes ─────────────────────────────────────────────────────────────────
describe("POST /api/public/trial/request", () => {
  test("feliz: cria usuário, registra trial, envia magic link com redirect /auth/callback", async () => {
    const handler = await POST_REQUEST();
    const res = await handler({
      request: jsonReq("https://app.example.com/api/public/trial/request", { email: "a@b.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sent: true, hours: 2 });
    expect(db.trial_requests).toHaveLength(1);
    expect(db.users.size).toBe(1);
    expect(cap.generateLinkCalls[0].redirectTo).toBe("https://app.example.com/auth/callback");
    expect(cap.resendCalls[0].to).toBe("a@b.com");
  });

  test("honeypot retorna ok sem efeito colateral", async () => {
    const handler = await POST_REQUEST();
    const res = await handler({
      request: jsonReq("https://x/", { email: "a@b.com", website: "spam" }),
    });
    expect(res.status).toBe(200);
    expect(db.trial_requests).toHaveLength(0);
    expect(db.users.size).toBe(0);
  });

  test("e-mail descartável bloqueado", async () => {
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq("https://x/", { email: "x@mailinator.com" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("disposable_email");
  });

  test("trial desativado → 403", async () => {
    db.app_settings.trial = { enabled: false };
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq("https://x/", { email: "a@b.com" }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("trial_disabled");
  });

  test("já testou (lock permanente) → 409 e não cria nada", async () => {
    db.trial_requests.push({ email: "a@b.com", user_id: "usr_old" });
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq("https://x/", { email: "a@b.com" }) });
    expect(res.status).toBe(409);
    expect(db.users.size).toBe(0);
  });

  test("falha de envio do Resend → rollback (auth + trial_requests)", async () => {
    resendStatus = 500;
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq("https://x/", { email: "a@b.com" }) });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("email_send_failed");
    expect(db.trial_requests).toHaveLength(0);
    expect(db.users.size).toBe(0);
  });

  test("configuração de e-mail ausente → 500 e rollback", async () => {
    db.email_settings = null;
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq("https://x/", { email: "a@b.com" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("email_config_missing");
    expect(db.trial_requests).toHaveLength(0);
    expect(db.users.size).toBe(0);
  });
});

describe("POST /api/public/trial/activate", () => {
  test("marca consumed_at quando usuário é trial", async () => {
    // Seed: cria usuário trial + trial_requests pendente
    const token = "tok_usr_1";
    db.users.set(token, {
      id: "usr_1",
      email: "a@b.com",
      user_metadata: { is_trial: true },
    });
    db.trial_requests.push({ email: "a@b.com", user_id: "usr_1", consumed_at: null });

    const handler = await POST_ACTIVATE();
    const res = await handler({
      request: new Request("https://x/api/public/trial/activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    });
    expect(res.status).toBe(200);
    expect(db.trial_requests[0].consumed_at).not.toBeNull();
  });

  test("sem token → 401", async () => {
    const handler = await POST_ACTIVATE();
    const res = await handler({ request: new Request("https://x/", { method: "POST" }) });
    expect(res.status).toBe(401);
  });

  test("usuário não-trial → ok mas activated=false e não altera nada", async () => {
    const token = "tok_usr_9";
    db.users.set(token, { id: "usr_9", email: "z@b.com", user_metadata: {} });
    const handler = await POST_ACTIVATE();
    const res = await handler({
      request: new Request("https://x/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).activated).toBe(false);
  });
});

describe("magic link aponta para /auth/callback (evita /login)", () => {
  test("redirectTo termina em /auth/callback", async () => {
    const handler = await POST_REQUEST();
    await handler({
      request: jsonReq("https://meusite.com/api/public/trial/request", { email: "novo@ex.com" }),
    });
    expect(cap.generateLinkCalls[0].redirectTo).toMatch(/\/auth\/callback$/);
  });
});
