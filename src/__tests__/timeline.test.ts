// ============================================================================
// Testes de aggregateTimeline — visão 360° do cliente, contra um PostgreSQL
// real em memória (PGlite) com as migrations da aplicação.
//
// Cobre:
//   • Agregação de fontes mistas → normaliza para o mesmo shape
//   • Ordenação por data desc, limite de 100
//   • Cruzamento de webhooks por e-mail OU subscription_id
//   • Sem e-mail: só fontes ligadas ao userId
// ============================================================================
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";
import { aggregateTimeline } from "@/lib/admin/timeline.server";

let t: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;
const EMAIL = "u@x.com";

beforeEach(async () => {
  t = await createTestDb();
  const [u] = await t.db
    .insert(schema.user)
    .values({ name: "U", email: EMAIL })
    .returning({ id: schema.user.id });
  userId = u.id;
});
afterEach(async () => t.close());

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("aggregateTimeline", () => {
  test("normaliza fontes mistas e ordena por data desc", async () => {
    await t.db.insert(schema.subscriptions).values([
      {
        userId,
        plan: "pro",
        status: "active",
        provider: "stripe",
        priceId: "pro_monthly",
        stripeSubscriptionId: "sub_1",
        createdAt: "2026-01-01T10:00:00Z",
        updatedAt: "2026-01-01T10:00:00Z",
      },
      {
        userId,
        plan: "starter",
        status: "canceled",
        provider: "stripe",
        priceId: "starter_monthly",
        stripeSubscriptionId: "sub_0",
        createdAt: "2025-06-01T10:00:00Z",
        updatedAt: "2025-12-01T10:00:00Z",
      },
    ]);
    await t.db.insert(schema.webhookEvents).values([
      // casa por subscription_id
      {
        provider: "stripe",
        eventType: "invoice.paid",
        status: "processed",
        subscriptionId: "sub_1",
        receivedAt: "2026-06-15T09:00:00Z",
      },
      // casa por e-mail
      {
        provider: "asaas",
        eventType: "PAYMENT_OVERDUE",
        status: "failed",
        customerEmail: EMAIL,
        error: "boom",
        receivedAt: "2026-06-16T09:00:00Z",
      },
      // de outro cliente — não pode aparecer
      {
        provider: "stripe",
        eventType: "invoice.paid",
        status: "processed",
        subscriptionId: "sub_outro",
        customerEmail: "outro@x.com",
        receivedAt: "2026-06-17T09:00:00Z",
      },
    ]);
    await t.db.insert(schema.emailLog).values({
      kind: "payment_failed",
      subscriptionId: "sub_1",
      sentToHash: sha(EMAIL),
      sentAt: "2026-06-20T12:00:00Z",
    });
    await t.db.insert(schema.adminAuditLog).values({
      action: "plan.grant_manual",
      resource: "subscription",
      actorEmail: "root@x.com",
      targetId: userId,
      createdAt: "2026-07-01T00:00:00Z",
    });
    await t.db.insert(schema.checkoutIntents).values({
      planSlug: "pro",
      email: EMAIL,
      provider: "stripe",
      status: "paid",
      createdAt: "2026-01-01T09:00:00Z",
      updatedAt: "2026-01-01T09:30:00Z",
      confirmedAt: "2026-01-01T09:30:00Z",
    });

    const items = await aggregateTimeline(userId, EMAIL);

    // Ordenação desc
    const dates = items.map((i) => i.at);
    expect(dates).toEqual([...dates].sort().reverse());

    // Kinds presentes
    const kinds = new Set(items.map((i) => i.kind));
    for (const k of ["webhook", "email", "admin", "checkout", "assinatura"] as const) {
      expect(kinds.has(k)).toBe(true);
    }

    // Webhooks: só os do cliente (por sub e por e-mail), com tom correto
    const hooks = items.filter((i) => i.kind === "webhook");
    expect(hooks.map((h) => h.title).sort()).toEqual([
      "PAYMENT_OVERDUE · failed",
      "invoice.paid · processed",
    ]);
    expect(hooks.find((h) => h.title.startsWith("PAYMENT"))?.tone).toBe("bad");
    expect(hooks.every((h) => h.refId)).toBe(true);

    // Assinatura cancelada gera dois eventos (criada + cancelada)
    const subs = items.filter((i) => i.kind === "assinatura");
    expect(subs).toHaveLength(3);
    expect(subs.some((s) => s.title.startsWith("Assinatura cancelada") && s.tone === "warn")).toBe(
      true,
    );

    // Checkout usa confirmed_at
    expect(items.find((i) => i.kind === "checkout")?.at).toBe("2026-01-01T09:30:00.000Z");

    for (const it of items) {
      expect(it).toHaveProperty("at");
      expect(it).toHaveProperty("title");
      expect(it).toHaveProperty("tone");
    }
  });

  test("sem e-mail: só fontes ligadas ao userId", async () => {
    await t.db.insert(schema.adminAuditLog).values({
      action: "x",
      resource: "y",
      targetId: userId,
    });
    await t.db.insert(schema.checkoutIntents).values({
      planSlug: "pro",
      email: EMAIL,
      provider: "stripe",
    });
    const items = await aggregateTimeline(userId, null);
    expect(items.some((i) => i.kind === "admin")).toBe(true);
    expect(items.some((i) => i.kind === "checkout" || i.kind === "email")).toBe(false);
  });

  test("limita a 100 itens", async () => {
    await t.db.insert(schema.adminAuditLog).values(
      Array.from({ length: 150 }, (_, i) => ({
        action: "x",
        resource: "y",
        targetId: userId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })),
    );
    const items = await aggregateTimeline(userId, null);
    expect(items.length).toBe(100);
    expect(items[0].at).toBe(new Date(Date.UTC(2026, 0, 1, 0, 2, 29)).toISOString());
  });
});
