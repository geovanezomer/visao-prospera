// Limpeza diária: apaga só o que venceu ou passou do prazo de guarda.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testDb";
import { runRetention } from "@/lib/ops/retention.server";
import { queryRows } from "@/db/client.server";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

const conta = async (tabela: string) =>
  Number(
    (await queryRows<{ n: number }>(sql.raw(`select count(*)::int as n from ${tabela}`)))[0].n,
  );

describe("runRetention", () => {
  it("remove contadores vencidos e webhooks finalizados antigos; mantém o resto", async () => {
    await t.db.execute(sql`
      insert into rate_limit_buckets (bucket_key, count, reset_at) values
        ('velho', 3, now() - interval '2 days'),
        ('ativo', 1, now() + interval '1 hour')`);
    await t.db.execute(sql`
      insert into webhook_events (provider, event_type, status, received_at) values
        ('stripe', 'x', 'processed', now() - interval '200 days'),
        ('stripe', 'x', 'failed', now() - interval '200 days'),
        ('stripe', 'x', 'processed', now() - interval '10 days')`);
    const r = await runRetention();
    expect(r.rate_limit_buckets).toBe(1);
    expect(r.webhook_events).toBe(1);
    expect(await conta("rate_limit_buckets")).toBe(1);
    expect(await conta("webhook_events")).toBe(2); // falho antigo fica para análise
    for (const v of Object.values(r)) expect(String(v)).not.toMatch(/^erro/);
  });
});
