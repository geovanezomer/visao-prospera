import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";
import { loadProviderConfig } from "@/lib/payments";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

describe("loadProviderConfig — modo da credencial", () => {
  test('"test" vira sandbox (antes caía em null e o Asaas usava produção)', async () => {
    await t.db.insert(schema.providerCredentials).values({
      provider: "asaas",
      mode: "test",
      apiKey: "chave-teste",
    });
    expect((await loadProviderConfig("asaas"))?.mode).toBe("sandbox");
  });

  test('"live" continua live', async () => {
    await t.db.insert(schema.providerCredentials).values({
      provider: "stripe",
      mode: "live",
      apiKey: "chave-live",
    });
    expect((await loadProviderConfig("stripe"))?.mode).toBe("live");
  });
});
