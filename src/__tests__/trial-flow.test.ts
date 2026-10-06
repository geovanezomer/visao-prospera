// ============================================================================
// Trial flow E2E (server-side), com PostgreSQL real em memória (PGlite).
//
// Cobre:
//  1. POST /api/public/trial/request — feliz, honeypot, descartável, desativado,
//     já-usado (inclusive maiúsculas), falha de envio (rollback do usuário +
//     trial_requests), envio não configurado.
//  2. POST /api/public/trial/activate — marca consumed_at para usuário em trial
//     (sessão por cookie).
//  3. Flags de trial: só o servidor grava (colunas do `user`); o leitor ignora
//     qualquer coisa fora delas.
//  4. POST /api/public/hooks/trial-cleanup — remove trial vencido sem
//     assinatura, mantém o lock de 1 teste por e-mail, protege convertidos.
// ============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";

process.env.BETTER_AUTH_SECRET ??= "better-auth-secret-de-teste-com-mais-de-32-chars";
process.env.APP_URL ??= "https://app.example.com";

// ─── Mocks ──────────────────────────────────────────────────────────────────
const cap = {
  magicLinks: [] as Array<{ email: string; callbackPath?: string }>,
  mails: [] as Array<{ to: string; subject: string; html: string }>,
};
let mailResult: { sent: boolean; via: "smtp" | "resend" | "none"; error?: string } = {
  sent: true,
  via: "smtp",
};

vi.mock("@/lib/magicLink.server", () => ({
  generateMagicLink: async (email: string, callbackPath?: string) => {
    cap.magicLinks.push({ email, callbackPath });
    return "https://app.example.com/api/auth/magic-link/verify?token=stub";
  },
}));

vi.mock("@/lib/mailer.server", () => ({
  sendMail: async (m: { to: string; subject: string; html: string }) => {
    cap.mails.push(m);
    return mailResult;
  },
  isMailConfigured: () => mailResult.via !== "none",
}));

// Sessão: o resto do auth.server é real (createAppUser usa o adapter interno).
let sessionUserId: string | null = null;
vi.mock("@/lib/auth.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth.server")>();
  return {
    ...real,
    getSessionFromHeaders: async () =>
      sessionUserId ? { user: { id: sessionUserId }, session: { id: "s1" } } : null,
  };
});

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

async function resetDb() {
  const res = await t.client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = res.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await t.client.exec(`TRUNCATE ${names} CASCADE`);
}

beforeEach(async () => {
  await resetDb();
  cap.magicLinks.length = 0;
  cap.mails.length = 0;
  mailResult = { sent: true, via: "smtp" };
  sessionUserId = null;
  await t.db.insert(schema.appSettings).values([
    { key: "trial", value: { enabled: true, duration_hours: 2 } },
    { key: "branding", value: { system_name: "FinnancePRO" } },
  ]);
  await t.db.insert(schema.emailTemplates).values({
    kind: "trial_magic_link",
    subject: "Olá {{name}} — {{system_name}}",
    html: "{{link}} ({{hours}}h)",
    text: "{{link}}",
    enabled: true,
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────
type Handler = (ctx: { request: Request }) => Promise<Response>;
async function loadPost(modPath: string): Promise<Handler> {
  const mod = (await import(modPath)) as {
    Route: { options: { server: { handlers: { POST: Handler } } } };
  };
  return mod.Route.options.server.handlers.POST;
}

const POST_REQUEST = () => loadPost("../routes/api/public/trial/request");
const POST_ACTIVATE = () => loadPost("../routes/api/public/trial/activate");
const POST_CLEANUP = () => loadPost("../routes/api/public/hooks/trial-cleanup");

function jsonReq(body: unknown) {
  return new Request("https://app.example.com/api/public/trial/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const activateReq = () => new Request("https://x/api/public/trial/activate", { method: "POST" });

const users = () => t.db.select().from(schema.user);
const trialRequests = () => t.db.select().from(schema.trialRequests);

// ─── Testes ─────────────────────────────────────────────────────────────────
describe("POST /api/public/trial/request", () => {
  test("feliz: cria usuário em trial, registra o lock e envia o magic link", async () => {
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "A@B.com" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: true, hours: 2 });

    const [u] = await users();
    expect(u.email).toBe("a@b.com");
    expect(u.isTrial).toBe(true);
    const ms = u.trialExpiresAt!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(1.9 * 3600_000);
    expect(ms).toBeLessThanOrEqual(2 * 3600_000);

    const [tr] = await trialRequests();
    expect(tr).toMatchObject({ email: "a@b.com", userId: u.id, consumedAt: null });

    // Conta só por magic link: nenhuma senha cadastrada.
    expect(await t.db.select().from(schema.account)).toHaveLength(0);

    expect(cap.magicLinks).toEqual([{ email: "a@b.com", callbackPath: "/app" }]);
    expect(cap.mails).toHaveLength(1);
    expect(cap.mails[0].to).toBe("a@b.com");
    expect(cap.mails[0].subject).toBe("Olá a — FinnancePRO");
    expect(cap.mails[0].html).toContain("magic-link/verify");
    expect(cap.mails[0].html).toContain("(2h)");
  });

  test("honeypot retorna ok sem efeito colateral", async () => {
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "a@b.com", website: "spam" }) });
    expect(res.status).toBe(200);
    expect(await trialRequests()).toHaveLength(0);
    expect(await users()).toHaveLength(0);
  });

  test("e-mail descartável bloqueado", async () => {
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "x@mailinator.com" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("disposable_email");
  });

  test("trial desativado → 403", async () => {
    await t.db
      .update(schema.appSettings)
      .set({ value: { enabled: false } })
      .where(eq(schema.appSettings.key, "trial"));
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "a@b.com" }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("trial_disabled");
  });

  test("já testou (lock permanente, sem diferenciar maiúsculas) → 409 e não cria nada", async () => {
    await t.db.insert(schema.trialRequests).values({
      email: "A@B.com",
      expiresAt: new Date().toISOString(),
    });
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "a@b.com" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_used");
    expect(await users()).toHaveLength(0);
  });

  test("segundo pedido do mesmo e-mail → 409 (UNIQUE em lower(email))", async () => {
    const handler = await POST_REQUEST();
    expect((await handler({ request: jsonReq({ email: "x@y.com" }) })).status).toBe(200);
    expect((await handler({ request: jsonReq({ email: "X@Y.com" }) })).status).toBe(409);
    expect(await users()).toHaveLength(1);
    expect(await trialRequests()).toHaveLength(1);
  });

  test("e-mail que já tem conta → 409 e não deixa lock", async () => {
    const { createAppUser } = await import("@/lib/users.server");
    await createAppUser({ email: "cliente@b.com" });
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "cliente@b.com" }) });
    expect(res.status).toBe(409);
    expect(await trialRequests()).toHaveLength(0);
    const [u] = await users();
    expect(u.isTrial).toBe(false);
  });

  test("falha de envio → 502 e rollback (usuário + trial_requests)", async () => {
    mailResult = { sent: false, via: "smtp", error: "550 recusado" };
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "a@b.com" }) });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("email_send_failed");
    expect(await trialRequests()).toHaveLength(0);
    expect(await users()).toHaveLength(0);
  });

  test("envio de e-mail não configurado → 500 e rollback", async () => {
    mailResult = { sent: false, via: "none" };
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "a@b.com" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("email_config_missing");
    expect(await trialRequests()).toHaveLength(0);
    expect(await users()).toHaveLength(0);
  });

  test("template de trial desativado → 500 sem criar nada", async () => {
    await t.db
      .update(schema.emailTemplates)
      .set({ enabled: false })
      .where(eq(schema.emailTemplates.kind, "trial_magic_link"));
    const handler = await POST_REQUEST();
    const res = await handler({ request: jsonReq({ email: "a@b.com" }) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("email_config_missing");
    expect(await users()).toHaveLength(0);
    expect(cap.mails).toHaveLength(0);
  });
});

describe("POST /api/public/trial/activate", () => {
  test("marca consumed_at quando usuário é trial", async () => {
    const handler = await POST_REQUEST();
    await handler({ request: jsonReq({ email: "a@b.com" }) });
    const [u] = await users();
    sessionUserId = u.id;

    const res = await (await POST_ACTIVATE())({ request: activateReq() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, activated: true });
    const [tr] = await trialRequests();
    expect(tr.consumedAt).not.toBeNull();
  });

  test("sem sessão → 401", async () => {
    const res = await (await POST_ACTIVATE())({ request: activateReq() });
    expect(res.status).toBe(401);
  });

  test("usuário não-trial → ok mas activated=false e não altera nada", async () => {
    const { createAppUser } = await import("@/lib/users.server");
    const u = await createAppUser({ email: "z@b.com" });
    await t.db.insert(schema.trialRequests).values({
      email: "z@b.com",
      userId: u.id,
      expiresAt: new Date().toISOString(),
    });
    sessionUserId = u.id;
    const res = await (await POST_ACTIVATE())({ request: activateReq() });
    expect(res.status).toBe(200);
    expect((await res.json()).activated).toBe(false);
    const [tr] = await trialRequests();
    expect(tr.consumedAt).toBeNull();
  });
});

describe("flags de trial só vêm das colunas do servidor", () => {
  test("readTrialFlags ignora qualquer campo fora de isTrial/trialExpiresAt", async () => {
    const { readTrialFlags } = await import("@/lib/trialFlags");
    // Formatos antigos (user_metadata/app_metadata do Supabase) e campos forjados não contam.
    const forged = {
      user_metadata: { is_trial: true, trial_expires_at: "2099-01-01T00:00:00Z" },
      app_metadata: { is_trial: true },
      is_trial: true,
      isTrial: "true",
    } as unknown as Parameters<typeof readTrialFlags>[0];
    expect(readTrialFlags(forged)).toEqual({ isTrial: false, trialExpiresAt: null });
    expect(
      readTrialFlags({ isTrial: true, trialExpiresAt: new Date("2099-01-01T00:00:00Z") }),
    ).toEqual({ isTrial: true, trialExpiresAt: "2099-01-01T00:00:00.000Z" });
  });

  test("Better Auth não aceita isTrial vindo do cliente (campo input:false)", async () => {
    const { auth } = await import("@/lib/auth.server");
    const opts = auth().options as {
      user?: { additionalFields?: Record<string, { input?: boolean }> };
    };
    expect(opts.user?.additionalFields?.isTrial?.input).toBe(false);
    expect(opts.user?.additionalFields?.trialExpiresAt?.input).toBe(false);
  });

  test("activate de usuário comum (flags não gravadas pelo servidor) não ativa", async () => {
    const { createAppUser } = await import("@/lib/users.server");
    const u = await createAppUser({ email: "forjado@b.com", name: "is_trial=true" });
    await t.db.insert(schema.trialRequests).values({
      email: "forjado@b.com",
      userId: u.id,
      expiresAt: new Date().toISOString(),
    });
    sessionUserId = u.id;
    const res = await (await POST_ACTIVATE())({ request: activateReq() });
    expect((await res.json()).activated).toBe(false);
    const [tr] = await trialRequests();
    expect(tr.consumedAt).toBeNull();
  });

  test("request grava o trial nas colunas do usuário (servidor)", async () => {
    await (
      await POST_REQUEST()
    )({ request: jsonReq({ email: "meta@ex.com" }) });
    const [u] = await t.db.select().from(schema.user).where(eq(schema.user.email, "meta@ex.com"));
    expect(u.isTrial).toBe(true);
    expect(u.trialExpiresAt).toBeInstanceOf(Date);
  });
});

describe("POST /api/public/hooks/trial-cleanup", () => {
  const SECRET = "c".repeat(40);
  const cronReq = () =>
    new Request("https://x/api/public/hooks/trial-cleanup", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });

  test("sem CRON_SECRET válido → nega", async () => {
    delete process.env.CRON_SECRET;
    const res = await (await POST_CLEANUP())({ request: cronReq() });
    expect(res.status).toBe(503);
  });

  test("remove trial vencido, preserva lock, protege convertido e trial vigente", async () => {
    process.env.CRON_SECRET = SECRET;
    const { createAppUser } = await import("@/lib/users.server");
    const past = new Date(Date.now() - 3600_000);
    const expired = await createAppUser({
      email: "old@x.com",
      isTrial: true,
      trialExpiresAt: past,
    });
    await t.db.insert(schema.trialRequests).values({
      email: "old@x.com",
      userId: expired.id,
      expiresAt: past.toISOString(),
    });
    const converted = await createAppUser({
      email: "paid@x.com",
      isTrial: true,
      trialExpiresAt: past,
    });
    await t.db.insert(schema.subscriptions).values({
      userId: converted.id,
      provider: "stripe",
      stripeSubscriptionId: "sub_paid",
      priceId: "pro",
      plan: "pro",
      status: "active",
    });
    const live = await createAppUser({
      email: "live@x.com",
      isTrial: true,
      trialExpiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await (await POST_CLEANUP())({ request: cronReq() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: 1, skippedConverted: 1 });

    const ids = (await users()).map((u) => u.id).sort();
    expect(ids).toEqual([converted.id, live.id].sort());
    const [conv] = await t.db.select().from(schema.user).where(eq(schema.user.id, converted.id));
    expect(conv.isTrial).toBe(false);
    // Lock de 1 teste por e-mail continua.
    const [tr] = await trialRequests();
    expect(tr).toMatchObject({ email: "old@x.com", userId: null });
    delete process.env.CRON_SECRET;
  });
});
