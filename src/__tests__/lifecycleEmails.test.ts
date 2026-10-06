// ============================================================================
// Testes de e-mails de ciclo de vida (past_due, trial_ending, canceled).
//
// Mocka:
//   • admin client (subset consumido pelo lifecycleEmails)
//   • fetch (Resend)
//   • buildProvider (evita I/O real ao Stripe/Asaas)
//
// Cobre:
//   • Disparo por evento — subscription resolvida via subscriptions→auth
//   • Dedupe de 24h por (kind, subscriptionId)
//   • Falha do Resend não propaga (sendLifecycleEmail devolve {sent:false})
//   • Ausência de config de e-mail é silenciosa
// ============================================================================

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "srk-stub";
process.env.APP_URL ??= "https://app.example.com";
process.env.RESEND_API_KEY ??= "re_stub";

// ─── Mock admin client (subset) ─────────────────────────────────────────────

type LogRow = { kind: string; subscription_id: string | null; sent_at: string };

function makeAdmin(opts: {
  emailLog?: LogRow[];
  subscribers?: Record<string, { userId: string; email: string; displayName?: string }>;
  emailConfig?: { apiKey: string; from_email: string; from_name?: string } | null;
  templates?: Record<string, { subject: string; html: string; enabled: boolean } | null>;
}) {
  const log = opts.emailLog ?? [];
  const inserts: any[] = [];

  const client: any = {
    _log: log,
    _inserts: inserts,
    from(table: string) {
      if (table === "email_log") {
        return {
          select: () => ({
            eq: (_c1: string, kind: string) => ({
              eq: (_c2: string, subId: string) => ({
                gte: (_c3: string, since: string) => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const found = log.find(
                        (r) => r.kind === kind && r.subscription_id === subId && r.sent_at >= since,
                      );
                      return { data: found ?? null, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
          insert: async (row: any) => {
            log.push({
              kind: row.kind,
              subscription_id: row.subscription_id,
              sent_at: row.sent_at,
            });
            inserts.push(row);
            return { data: null, error: null };
          },
        };
      }
      if (table === "email_settings") {
        return {
          select: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: opts.emailConfig
                  ? {
                      resend_api_key: opts.emailConfig.apiKey,
                      from_email: opts.emailConfig.from_email,
                      from_name: opts.emailConfig.from_name ?? "Finnance",
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "email_templates") {
        return {
          select: () => ({
            eq: (_c: string, kind: string) => ({
              maybeSingle: async () => ({
                data: opts.templates?.[kind] ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: (_c: string, subId: string) => ({
              maybeSingle: async () => {
                const s = opts.subscribers?.[subId];
                return { data: s ? { user_id: s.userId } : null, error: null };
              },
            }),
          }),
        };
      }
      return { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
    },
    auth: {
      admin: {
        getUserById: async (userId: string) => {
          const entry = Object.values(opts.subscribers ?? {}).find((s) => s.userId === userId);
          if (!entry) return { data: { user: null }, error: null };
          return {
            data: {
              user: {
                id: entry.userId,
                email: entry.email,
                user_metadata: entry.displayName ? { display_name: entry.displayName } : {},
              },
            },
            error: null,
          };
        },
      },
    },
  };
  return client;
}

// ─── Mock global fetch (Resend) ─────────────────────────────────────────────
let fetchCalls: Array<{ url: string; body: any }> = [];
let fetchResponse: { ok: boolean; status: number; body?: string } = { ok: true, status: 200 };

beforeEach(() => {
  fetchCalls = [];
  fetchResponse = { ok: true, status: 200 };
  (globalThis as any).fetch = vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      text: async () => fetchResponse.body ?? "",
    } as any;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("sendLifecycleEmail", () => {
  test("resolve e-mail via subscriptions→auth e envia via Resend", async () => {
    const { sendLifecycleEmail, resolveSubscriberEmail } =
      await import("@/lib/payments/lifecycleEmails.server");
    const admin = makeAdmin({
      subscribers: {
        sub_1: { userId: "usr_1", email: "cliente@example.com", displayName: "Ana" },
      },
      emailConfig: { apiKey: "re_test", from_email: "no-reply@finnance.app" },
    });

    const resolved = await resolveSubscriberEmail(admin, "sub_1");
    expect(resolved).toEqual({ email: "cliente@example.com", name: "Ana", userId: "usr_1" });

    const res = await sendLifecycleEmail(
      admin,
      "payment_failed",
      resolved!.email,
      { name: resolved!.name, plan: "pro", portal_url: "https://portal.example/x" },
      "sub_1",
    );
    expect(res.sent).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.resend.com/emails");
    expect(fetchCalls[0].body.to).toBe("cliente@example.com");
    expect(fetchCalls[0].body.subject).toContain("pagamento");
    expect(fetchCalls[0].body.html).toContain("https://portal.example/x");
  });

  test("dedupe: segundo envio dentro de 24h não chama Resend", async () => {
    const { sendLifecycleEmail } = await import("@/lib/payments/lifecycleEmails.server");
    const admin = makeAdmin({
      subscribers: { sub_1: { userId: "u1", email: "c@x.com" } },
      emailConfig: { apiKey: "re_x", from_email: "no@x.com" },
    });

    const first = await sendLifecycleEmail(admin, "payment_failed", "c@x.com", {}, "sub_1");
    const second = await sendLifecycleEmail(admin, "payment_failed", "c@x.com", {}, "sub_1");

    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe("deduped");
    expect(fetchCalls).toHaveLength(1);
  });

  test("dedupe é por (kind, subscriptionId) — kind diferente passa", async () => {
    const { sendLifecycleEmail } = await import("@/lib/payments/lifecycleEmails.server");
    const admin = makeAdmin({
      subscribers: { sub_1: { userId: "u1", email: "c@x.com" } },
      emailConfig: { apiKey: "re_x", from_email: "no@x.com" },
    });
    await sendLifecycleEmail(admin, "payment_failed", "c@x.com", {}, "sub_1");
    const other = await sendLifecycleEmail(admin, "trial_ending", "c@x.com", {}, "sub_1");
    expect(other.sent).toBe(true);
    expect(fetchCalls).toHaveLength(2);
  });

  test("falha do Resend não lança — devolve {sent:false}", async () => {
    const { sendLifecycleEmail } = await import("@/lib/payments/lifecycleEmails.server");
    const admin = makeAdmin({
      subscribers: { sub_1: { userId: "u1", email: "c@x.com" } },
      emailConfig: { apiKey: "re_x", from_email: "no@x.com" },
    });
    fetchResponse = { ok: false, status: 500, body: "boom" };
    const res = await sendLifecycleEmail(admin, "payment_failed", "c@x.com", {}, "sub_1");
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("resend-500");
  });

  test("sem configuração de e-mail → não envia, sem erro", async () => {
    const { sendLifecycleEmail } = await import("@/lib/payments/lifecycleEmails.server");
    // Sem RESEND_API_KEY nem from
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const admin = makeAdmin({
      subscribers: { sub_1: { userId: "u1", email: "c@x.com" } },
      emailConfig: null,
    });
    const res = await sendLifecycleEmail(admin, "trial_ending", "c@x.com", {}, "sub_1");
    expect(res.sent).toBe(false);
    expect(res.reason).toBe("no-config");
    expect(fetchCalls).toHaveLength(0);
    if (prev) process.env.RESEND_API_KEY = prev;
  });

  test("template customizado no banco tem prioridade sobre fallback", async () => {
    const { sendLifecycleEmail } = await import("@/lib/payments/lifecycleEmails.server");
    const admin = makeAdmin({
      subscribers: { sub_1: { userId: "u1", email: "c@x.com" } },
      emailConfig: { apiKey: "re_x", from_email: "no@x.com" },
      templates: {
        trial_ending: {
          subject: "CUSTOM {{name}}",
          html: "<p>fim em {{trial_end}}</p>",
          enabled: true,
        },
      },
    });
    await sendLifecycleEmail(
      admin,
      "trial_ending",
      "c@x.com",
      { name: "Zé", trial_end: "10/07" },
      "sub_1",
    );
    expect(fetchCalls[0].body.subject).toBe("CUSTOM Zé");
    expect(fetchCalls[0].body.html).toContain("fim em 10/07");
  });

  test("resolveSubscriberEmail retorna null para subscription desconhecida", async () => {
    const { resolveSubscriberEmail } = await import("@/lib/payments/lifecycleEmails.server");
    const admin = makeAdmin({ subscribers: {} });
    const res = await resolveSubscriberEmail(admin, "sub_unknown");
    expect(res).toBeNull();
  });
});
