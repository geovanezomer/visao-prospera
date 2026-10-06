// ============================================================================
// Camada admin server-only contra PostgreSQL real em memória (PGlite):
// papel admin (rbac.server), auditoria, dedup de notificações e leitura de
// assinaturas para os dashboards.
// ============================================================================
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/__tests__/helpers/testDb";
import { schema } from "@/db/client.server";
import { applyAdminRole } from "./rbac.server";
import { logAudit } from "./audit.server";
import { notifyAdmin } from "./notify.server";
import { loadSubRows } from "./dashboardData.server";
import { mrrAt } from "./dashboard.functions";

let t: Awaited<ReturnType<typeof createTestDb>>;

async function addUser(email: string, role: "admin" | "user" = "user") {
  const [u] = await t.db
    .insert(schema.user)
    .values({ name: email, email, role })
    .returning({ id: schema.user.id });
  return u.id;
}
async function roleOf(id: string) {
  const [u] = await t.db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, id));
  return u.role;
}

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await t.close();
});

describe("applyAdminRole", () => {
  test("concede e revoga admin enquanto houver outro admin", async () => {
    const a = await addUser("a@x.com", "admin");
    const b = await addUser("b@x.com");

    expect(await applyAdminRole(b, true)).toMatchObject({ changed: true, role: "admin" });
    expect(await roleOf(b)).toBe("admin");

    // Idempotente
    expect((await applyAdminRole(b, true)).changed).toBe(false);

    // Com dois admins, um pode remover o próprio papel
    expect(await applyAdminRole(a, false)).toMatchObject({ changed: true, role: "user" });
    expect(await roleOf(a)).toBe("user");
  });

  test("recusa remover o último administrador", async () => {
    const a = await addUser("a@x.com", "admin");
    await addUser("b@x.com");
    await expect(applyAdminRole(a, false)).rejects.toThrow(/último administrador/);
    expect(await roleOf(a)).toBe("admin");
  });

  test("usuário inexistente", async () => {
    await expect(applyAdminRole("00000000-0000-0000-0000-000000000000", true)).rejects.toThrow(
      /não encontrado/,
    );
  });
});

describe("logAudit", () => {
  test("grava a entrada sem contexto HTTP", async () => {
    await logAudit({
      actorId: null,
      actorEmail: "root@x.com",
      action: "user.activate",
      resource: "user",
      targetId: "abc",
      metadata: { n: 1 },
    });
    const rows = await t.db.select().from(schema.adminAuditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorEmail: "root@x.com",
      action: "user.activate",
      targetId: "abc",
      metadata: { n: 1 },
    });
  });
});

describe("notifyAdmin", () => {
  test("sem configuração não envia", async () => {
    expect(await notifyAdmin({ event: "signup", title: "x", body: "y" })).toEqual({
      sent: false,
      reason: "no-config",
    });
  });

  test("envia ao Slack, respeita evento desligado e deduplica", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await t.db.insert(schema.notificationSettings).values({
      id: 1,
      slackWebhookUrl: "https://hooks.slack.test/x",
      events: { signup: true, churn: false, past_due: true, webhook_failure: true },
    });

    expect(await notifyAdmin({ event: "churn", title: "c", body: "b" })).toEqual({
      sent: false,
      reason: "event-disabled",
    });

    const first = await notifyAdmin({ event: "signup", title: "t", body: "b", dedupKey: "k1" });
    expect(first.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await notifyAdmin({ event: "signup", title: "t", body: "b", dedupKey: "k1" });
    expect(second).toEqual({ sent: false, reason: "dedup" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadSubRows", () => {
  test("devolve snake_case compatível com mrrAt", async () => {
    const u1 = await addUser("p@x.com");
    const u2 = await addUser("s@x.com");
    await t.db.insert(schema.subscriptions).values([
      { userId: u1, plan: "pro", status: "active", priceId: "pro_monthly" },
      { userId: u2, plan: "starter", status: "canceled", priceId: "starter_monthly" },
    ]);
    const rows = await loadSubRows("desc");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty("user_id");
    expect(rows[0]).toHaveProperty("price_id");
    expect(mrrAt(rows, new Date(Date.now() + 1000))).toBe(9900);
  });
});
