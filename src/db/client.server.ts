// ============================================================================
// Conexão com o PostgreSQL (servidor). Nunca importar no navegador.
//
// Produção: DATABASE_URL (postgres://usuario:senha@host:5432/banco).
// Testes: `setDbForTests` injeta um banco em memória (PGlite) com o mesmo
// esquema — ver src/__tests__/helpers/testDb.ts.
// ============================================================================
import type { SQL } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let _db: Db | null = null;
let _client: postgres.Sql | null = null;

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  _client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  return drizzle(_client, { schema });
}

/** Banco da aplicação (criado na primeira chamada). */
export function db(): Db {
  if (!_db) _db = createDb();
  return _db;
}

/** Só para testes: substitui a conexão (ex.: PGlite em memória). */
export function setDbForTests(instance: unknown): void {
  _db = instance as Db;
  _client = null;
}

/**
 * Conexão dedicada do pool (para travas de sessão, como pg_advisory_lock).
 * null quando não há cliente postgres-js (testes com PGlite).
 */
export async function reserveConnection(): Promise<postgres.ReservedSql | null> {
  db();
  return _client ? _client.reserve() : null;
}

/**
 * SQL cru devolvendo as linhas. Normaliza a diferença entre drivers
 * (postgres-js devolve um array; PGlite, `{ rows }`).
 */
export async function queryRows<T>(query: SQL): Promise<T[]> {
  const res = (await db().execute(query)) as unknown;
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

export { schema };
