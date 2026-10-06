// Banco de teste: PostgreSQL de verdade em memória (PGlite), com o mesmo
// esquema e as mesmas migrations da produção. Cada `createTestDb()` é isolado.
//
//   const t = await createTestDb();   // injeta em db()
//   ...
//   await t.close();
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, setDbForTests } from "@/db/client.server";

export async function createTestDb() {
  const client = new PGlite();
  const testDb = drizzle(client, { schema });
  await migrate(testDb, { migrationsFolder: "db/migrations" });
  setDbForTests(testDb);
  return {
    db: testDb,
    client,
    close: async () => {
      setDbForTests(null);
      await client.close();
    },
  };
}
