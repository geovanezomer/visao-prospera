// ============================================================================
// Preparação do banco na subida do servidor:
//   1. aplica as migrations pendentes (db/migrations);
//   2. cria o administrador inicial se não houver nenhum admin.
//
// Roda uma vez por processo, na primeira requisição (ver src/server.ts).
// Falha alta: se a migration quebrar, o servidor responde erro em vez de
// subir com esquema inconsistente (o entrypoint antigo seguia em silêncio).
// ============================================================================
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, migrationClient, schema, type Db } from "./client.server";

/** Credencial provisória do primeiro acesso. A troca é exigida no app. */
export const INITIAL_ADMIN = {
  username: "admin",
  email: "admin@localhost",
  password: "admin",
} as const;

export async function runMigrations(target?: Db): Promise<void> {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? "db/migrations";
  if (target) return void (await migrate(target, { migrationsFolder }));
  // Produção: conexão própria, sem o statement_timeout do pool (criar índice
  // numa tabela grande pode passar de 60 s).
  const app = db();
  const dedicated = migrationClient();
  try {
    await migrate(dedicated?.db ?? app, { migrationsFolder });
  } finally {
    await dedicated?.end();
  }
}

/** Cria admin/admin quando o banco ainda não tem nenhum administrador. */
export async function seedInitialAdmin(target: Db = db()): Promise<boolean> {
  const existing = await target
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.role, "admin"))
    .limit(1);
  if (existing.length > 0) return false;

  const passwordHash = await hashPassword(INITIAL_ADMIN.password);
  await target.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.user)
      .values({
        name: "Administrador",
        email: INITIAL_ADMIN.email,
        emailVerified: true,
        username: INITIAL_ADMIN.username,
        displayUsername: INITIAL_ADMIN.username,
        role: "admin",
        mustChangePassword: true,
      })
      .returning({ id: schema.user.id });
    await tx.insert(schema.account).values({
      accountId: created.id,
      providerId: "credential",
      userId: created.id,
      password: passwordHash,
    });
  });
  console.warn(
    "[bootstrap] Administrador inicial criado (usuário: admin / senha: admin). Troque a senha no primeiro acesso.",
  );
  return true;
}

let ready: Promise<void> | null = null;

/** Migrations + seed, uma vez por processo. */
export function ensureDatabaseReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await runMigrations();
      await seedInitialAdmin();
    })().catch((e) => {
      ready = null; // permite nova tentativa no próximo request
      throw e;
    });
  }
  return ready;
}
