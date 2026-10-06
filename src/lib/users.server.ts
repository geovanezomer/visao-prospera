// ============================================================================
// Usuários — leitura e administração no servidor.
//
// Substitui `supabaseAdmin.auth.admin.*`. Leituras vão direto na tabela
// `user` (Drizzle); escritas que envolvem sessão/senha passam pelo adapter
// interno do Better Auth, para manter hash e sessões consistentes.
// ============================================================================
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db, schema } from "@/db/client.server";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  /** Último login (criação da sessão mais recente), ou null. */
  lastSignInAt: string | null;
  banned: boolean;
  /** Fim do bloqueio; null = sem bloqueio ou bloqueio sem prazo. */
  bannedUntil: string | null;
  aiEnabled: boolean;
  isTrial: boolean;
  trialExpiresAt: string | null;
  mustChangePassword: boolean;
};

type UserRow = typeof schema.user.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function toAppUser(u: UserRow, lastSignInAt: Date | string | null = null): AppUser {
  const bannedActive = Boolean(u.banned) && (!u.banExpires || u.banExpires.getTime() > Date.now());
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    username: u.username ?? null,
    role: u.role,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
    lastSignInAt: lastSignInAt ? new Date(lastSignInAt).toISOString() : null,
    banned: bannedActive,
    bannedUntil: bannedActive ? iso(u.banExpires) : null,
    aiEnabled: u.aiEnabled,
    isTrial: u.isTrial,
    trialExpiresAt: iso(u.trialExpiresAt),
    mustChangePassword: u.mustChangePassword,
  };
}

async function lastSignInMap(ids: string[]): Promise<Map<string, Date | string>> {
  if (ids.length === 0) return new Map();
  const rows = await db()
    .select({ userId: schema.session.userId, last: max(schema.session.createdAt) })
    .from(schema.session)
    .where(inArray(schema.session.userId, ids))
    .groupBy(schema.session.userId);
  return new Map(rows.filter((r) => r.last).map((r) => [r.userId, r.last as Date]));
}

/** Todos os usuários, mais recentes primeiro (volume de PME: cabe em memória). */
export async function listAppUsers(): Promise<AppUser[]> {
  const rows = await db().select().from(schema.user).orderBy(desc(schema.user.createdAt));
  const last = await lastSignInMap(rows.map((r) => r.id));
  return rows.map((r) => toAppUser(r, last.get(r.id) ?? null));
}

export async function getAppUser(id: string): Promise<AppUser | null> {
  const [row] = await db().select().from(schema.user).where(eq(schema.user.id, id)).limit(1);
  if (!row) return null;
  const last = await lastSignInMap([id]);
  return toAppUser(row, last.get(id) ?? null);
}

export async function findAppUserByEmail(email: string): Promise<AppUser | null> {
  const [row] = await db()
    .select()
    .from(schema.user)
    .where(eq(sql`lower(${schema.user.email})`, email.trim().toLowerCase()))
    .limit(1);
  return row ? toAppUser(row) : null;
}

export async function isAdminUser(id: string): Promise<boolean> {
  const [row] = await db()
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(and(eq(schema.user.id, id), eq(schema.user.role, "admin")))
    .limit(1);
  return Boolean(row);
}

/**
 * Cria usuário. Sem `password`, a conta só entra por magic link.
 * E-mail já existente → lança "USER_EXISTS".
 */
export async function createAppUser(input: {
  email: string;
  name?: string;
  password?: string;
  emailVerified?: boolean;
  isTrial?: boolean;
  trialExpiresAt?: Date | null;
}): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  if (await findAppUserByEmail(email)) throw new Error("USER_EXISTS");
  const { auth } = await import("@/lib/auth.server");
  const ctx = await auth().$context;
  const created = await ctx.internalAdapter.createUser({
    email,
    name: input.name?.trim() || email.split("@")[0],
    emailVerified: input.emailVerified ?? true,
    isTrial: input.isTrial ?? false,
    trialExpiresAt: input.trialExpiresAt ?? null,
  });
  if (input.password) {
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await ctx.password.hash(input.password),
    });
  }
  const user = await getAppUser(created.id);
  if (!user) throw new Error("Falha ao criar usuário.");
  return user;
}

export type AppUserPatch = Partial<{
  name: string;
  email: string;
  role: "admin" | "user";
  aiEnabled: boolean;
  isTrial: boolean;
  trialExpiresAt: Date | null;
  trialConvertedAt: Date | null;
  trialConvertedPlan: string | null;
  mustChangePassword: boolean;
}>;

export async function updateAppUser(id: string, patch: AppUserPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db()
    .update(schema.user)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.user.id, id));
}

/** Bloqueia (até `until`, ou sem prazo) e derruba as sessões; `null` desbloqueia. */
export async function setUserBan(id: string, until: Date | null | "forever"): Promise<void> {
  if (until === null) {
    await db()
      .update(schema.user)
      .set({ banned: false, banExpires: null, banReason: null, updatedAt: new Date() })
      .where(eq(schema.user.id, id));
    return;
  }
  await db()
    .update(schema.user)
    .set({ banned: true, banExpires: until === "forever" ? null : until, updatedAt: new Date() })
    .where(eq(schema.user.id, id));
  await revokeUserSessions(id);
}

export async function revokeUserSessions(id: string): Promise<void> {
  await db().delete(schema.session).where(eq(schema.session.userId, id));
}

export async function deleteAppUser(id: string): Promise<void> {
  // Cascata: sessões, contas, assinaturas, notas, backups e links do usuário.
  await db().delete(schema.user).where(eq(schema.user.id, id));
}

/** Define (ou troca) a senha de um usuário sem exigir a anterior — uso do admin. */
export async function setUserPassword(id: string, password: string): Promise<void> {
  const { auth } = await import("@/lib/auth.server");
  const ctx = await auth().$context;
  const hash = await ctx.password.hash(password);
  const [acc] = await db()
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, id), eq(schema.account.providerId, "credential")))
    .limit(1);
  if (acc) {
    await db()
      .update(schema.account)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(schema.account.id, acc.id));
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: id,
      providerId: "credential",
      accountId: id,
      password: hash,
    });
  }
}

/** Sessões ativas do usuário (painel admin). */
export async function listUserSessions(id: string) {
  return db()
    .select({
      id: schema.session.id,
      createdAt: schema.session.createdAt,
      expiresAt: schema.session.expiresAt,
      ipAddress: schema.session.ipAddress,
      userAgent: schema.session.userAgent,
    })
    .from(schema.session)
    .where(eq(schema.session.userId, id))
    .orderBy(desc(schema.session.createdAt));
}
