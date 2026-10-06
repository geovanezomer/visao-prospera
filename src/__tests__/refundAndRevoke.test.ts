// ============================================================================
// Testes: refundAndRevoke — estorno + revogar acesso.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks módulos importados dinamicamente por refund.server.ts
const cancelSpy = vi.fn();
vi.mock("@/lib/payments/cancelCore.server", () => ({
  cancelSubscriptionNow: (...args: unknown[]) => cancelSpy(...args),
}));

const loadCfg = vi.fn().mockResolvedValue({ apiKey: "sk_test", mode: "sandbox" });
vi.mock("@/lib/payments/index", () => ({
  loadProviderConfig: (...a: unknown[]) => loadCfg(...a),
}));

const emailCfg = vi.fn().mockResolvedValue(null);
const getTpl = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/payments/lifecycleEmails.server", () => ({
  getEmailConfig: (...a: unknown[]) => emailCfg(...a),
  getTemplate: (...a: unknown[]) => getTpl(...a),
  renderTemplate: (s: string) => s,
}));

// Admin client mock — capturamos updates e inserts.
const dbUpdates: Array<Record<string, unknown>> = [];
const dbInserts: Array<{ table: string; row: Record<string, unknown> }> = [];

function makeQuery(table: string) {
  const chain = {
    update(patch: Record<string, unknown>) {
      dbUpdates.push({ table, patch });
      return chain;
    },
    insert(row: Record<string, unknown>) {
      dbInserts.push({ table, row });
      return Promise.resolve({ error: null });
    },
    eq() {
      return chain;
    },
    select() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    maybeSingle() {
      return Promise.resolve({
        data: { user_id: "u1", plan: "pro", stripe_subscription_id: "sub_1" },
      });
    },
    then(fn: (v: unknown) => unknown) {
      return Promise.resolve({ error: null }).then(fn);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { email: "c@x.com", user_metadata: {} } },
        }),
      },
    },
  },
}));

// Mock global fetch — refundStripe faz GET /subscriptions e /invoices e POST /refunds
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/subscriptions/sub_1") && (!init || init.method === undefined)) {
    return new Response(JSON.stringify({ id: "sub_1", latest_invoice: "in_1" }), { status: 200 });
  }
  if (u.includes("/invoices/in_1")) {
    return new Response(JSON.stringify({ id: "in_1", payment_intent: "pi_1" }), { status: 200 });
  }
  if (u.endsWith("/refunds")) {
    return new Response(JSON.stringify({ id: "re_1", amount: 4990, status: "succeeded" }), {
      status: 200,
    });
  }
  return new Response("{}", { status: 200 });
});

beforeEach(() => {
  dbUpdates.length = 0;
  dbInserts.length = 0;
  cancelSpy.mockReset();
  cancelSpy.mockResolvedValue({
    ok: true,
    provider: "stripe",
    subscriptionId: "sub_1",
    providerStatus: "canceled",
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("refundAndRevoke", () => {
  const baseInput = {
    provider: "stripe",
    subscriptionId: "sub_1",
    customerId: "cus_1",
    userId: "u1",
    actorId: "admin1",
  };

  it("revoke=true: cancela no provedor, atualiza banco e loga evento sintético", async () => {
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput, revoke: true });
    expect(r.refund.ok).toBe(true);
    expect(r.revoke.ok).toBe(true);
    expect(r.dbUpdate.ok).toBe(true);
    expect(cancelSpy).toHaveBeenCalledOnce();
    // banco: update em subscriptions com status=canceled
    const subUpd = dbUpdates.find((u) => u.table === "subscriptions");
    expect(subUpd).toBeDefined();
    expect((subUpd?.patch as Record<string, unknown>).status).toBe("canceled");
    // evento sintético
    const ev = dbInserts.find((i) => i.table === "webhook_events");
    expect(ev).toBeDefined();
    expect(ev?.row.provider).toBe("admin");
    expect(ev?.row.event_type).toBe("admin.refund_revoke");
    expect((ev?.row.payload as Record<string, unknown>).actorId).toBe("admin1");
    expect((ev?.row.payload as Record<string, unknown>).refundId).toBe("re_1");
  });

  it("revoke=false: apenas estorna, NÃO cancela nem atualiza banco", async () => {
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput, revoke: false });
    expect(r.refund.ok).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(dbUpdates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(dbInserts.find((i) => i.table === "webhook_events")).toBeUndefined();
    if (r.revoke.ok) expect(r.revoke.detail).toBe("skipped");
  });

  it("falha no cancelamento preserva o estorno e reporta revoke.failed", async () => {
    cancelSpy.mockRejectedValueOnce(new Error("provider down"));
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput, revoke: true });
    expect(r.refund.ok).toBe(true); // estorno preservado
    expect(r.revoke.ok).toBe(false);
    if (!r.revoke.ok) expect(r.revoke.error).toContain("provider down");
    // ainda assim: banco atualizado + evento gravado (admin vê o quadro completo)
    expect(dbUpdates.find((u) => u.table === "subscriptions")).toBeDefined();
    expect(dbInserts.find((i) => i.table === "webhook_events")).toBeDefined();
  });
});
