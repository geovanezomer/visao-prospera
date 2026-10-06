import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";
import { seedInitialAdmin } from "@/db/bootstrap.server";
import { rlConsume } from "@/lib/rateLimit.server";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

describe("fundação do banco", () => {
  test("seed cria admin/admin uma única vez, com troca de senha obrigatória", async () => {
    expect(await seedInitialAdmin(t.db as never)).toBe(true);
    expect(await seedInitialAdmin(t.db as never)).toBe(false);
    const [admin] = await t.db.select().from(schema.user).where(eq(schema.user.username, "admin"));
    expect(admin.role).toBe("admin");
    expect(admin.mustChangePassword).toBe(true);
    const accs = await t.db.select().from(schema.account).where(eq(schema.account.userId, admin.id));
    expect(accs[0].password).toBeTruthy();
    expect(accs[0].password).not.toBe("admin");
  });

  test("datas saem como ISO 8601", async () => {
    await t.db.insert(schema.appSettings).values({ key: "k", value: { a: 1 } });
    const [row] = await t.db.select().from(schema.appSettings);
    expect(row.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("rate limit atômico por janela", async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await rlConsume("t:ip:1", 3, 60));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false]);
    expect(r[3].retryAfter).toBeGreaterThan(0);
  });
});
