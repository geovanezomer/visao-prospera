// ============================================================================
// Testes: refundAndRevoke — estorno + revogar acesso (banco real em memória).
// ============================================================================
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";

const cancelSpy = vi.fn();
vi.mock("@/lib/payments/cancelCore.server", () => ({
  cancelSubscriptionNow: (...args: unknown[]) => cancelSpy(...args),
}));

const mails: Array<{ to: string; subject: string; html: string }> = [];
vi.mock("@/lib/mailer.server", () => ({
  sendMail: async (m: { to: string; subject: string; html: string }) => {
    mails.push(m);
    return { sent: true, via: "smtp" };
  },
  isMailConfigured: () => true,
}));

// Stripe: GET /subscriptions e /invoices e POST /refunds
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
  return new Response("{}", { status: 404 });
});

let t: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

beforeEach(async () => {
  await t.client.exec(
    'TRUNCATE "user", "subscriptions", "webhook_events", "email_templates", "provider_credentials" CASCADE',
  );
  mails.length = 0;
  const [u] = await t.db
    .insert(schema.user)
    .values({ email: "c@x.com", name: "Carla" })
    .returning();
  userId = u.id;
  await t.db.insert(schema.subscriptions).values({
    userId,
    provider: "stripe",
    stripeSubscriptionId: "sub_1",
    priceId: "pro",
    plan: "pro",
    status: "active",
    cancelAtPeriodEnd: true,
  });
  await t.db.insert(schema.providerCredentials).values({ provider: "stripe", apiKey: "sk_test" });
  cancelSpy.mockReset();
  cancelSpy.mockResolvedValue({
    ok: true,
    provider: "stripe",
    subscriptionId: "sub_1",
    providerStatus: "canceled",
  });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const baseInput = () => ({
  provider: "stripe",
  subscriptionId: "sub_1",
  customerId: "cus_1",
  userId,
  actorId: "admin1",
});

async function sub() {
  const [row] = await t.db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.stripeSubscriptionId, "sub_1"));
  return row;
}

describe("refundAndRevoke", () => {
  it("revoke=true: cancela no provedor, atualiza banco e loga evento sintético", async () => {
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput(), revoke: true });
    expect(r.refund.ok).toBe(true);
    expect(r.revoke.ok).toBe(true);
    expect(r.dbUpdate.ok).toBe(true);
    expect(r.audit.ok).toBe(true);
    expect(cancelSpy).toHaveBeenCalledOnce();
    // Usou a chave do banco (provider_credentials) no Stripe.
    const auth = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization;
    expect(auth).toBe("Bearer sk_test");

    expect(await sub()).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false });

    const [ev] = await t.db.select().from(schema.webhookEvents);
    expect(ev).toMatchObject({
      provider: "admin",
      eventType: "admin.refund_revoke",
      subscriptionId: "sub_1",
      status: "processed",
    });
    expect(ev.payload).toMatchObject({ actorId: "admin1", refundId: "re_1", amount: 4990 });
  });

  it("revoke=false: apenas estorna, NÃO cancela nem atualiza banco", async () => {
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput(), revoke: false });
    expect(r.refund.ok).toBe(true);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect((await sub()).status).toBe("active");
    expect(await t.db.select().from(schema.webhookEvents)).toHaveLength(0);
    if (r.revoke.ok) expect(r.revoke.detail).toBe("skipped");
  });

  it("falha no cancelamento preserva o estorno e reporta revoke.failed", async () => {
    cancelSpy.mockRejectedValueOnce(new Error("provider down"));
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput(), revoke: true });
    expect(r.refund.ok).toBe(true); // estorno preservado
    expect(r.revoke.ok).toBe(false);
    if (!r.revoke.ok) expect(r.revoke.error).toContain("provider down");
    // ainda assim: banco atualizado + evento gravado (admin vê o quadro completo)
    expect((await sub()).status).toBe("canceled");
    expect(await t.db.select().from(schema.webhookEvents)).toHaveLength(1);
  });

  it("e-mail de estorno usa o template 'refund' do painel", async () => {
    await t.db.insert(schema.emailTemplates).values({
      kind: "refund",
      subject: "Estorno {{plan}}",
      html: "Olá {{name}}, devolvemos {{amount}}.",
      enabled: true,
    });
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput(), revoke: true });
    expect(r.email.ok).toBe(true);
    expect(mails).toEqual([
      { to: "c@x.com", subject: "Estorno pro", html: "Olá Carla, devolvemos 4990." },
    ]);
  });

  it("sem template 'refund' → e-mail não enviado e reportado", async () => {
    const { refundAndRevoke } = await import("../lib/payments/refund.server");
    const r = await refundAndRevoke({ ...baseInput(), revoke: true });
    expect(r.email.ok).toBe(false);
    expect(mails).toHaveLength(0);
  });
});
