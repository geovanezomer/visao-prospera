// ============================================================================
// Server fns do "drill-down" de usuário no painel Admin.
//
// - getUserDetail: agrega usuário + histórico de subscriptions
//   + últimos webhook_events do cliente + entradas de auditoria onde o usuário
//   é alvo.
// - grantManualPlan: concede plano manual (trial, ativo ou lifetime) inserindo
//   uma linha em subscriptions com provider='manual'.
// - impersonateUser: gera um magic link de uso único para o admin colar no
//   navegador (modo "logar como"). NÃO altera a sessão atual do admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { actorEmail, type Json } from "./_types";

/** Status/fim de período de uma concessão manual de plano. */
function manualGrant(mode: "trial" | "ativo" | "lifetime", durationDays?: number) {
  const days = mode === "lifetime" ? null : (durationDays ?? (mode === "trial" ? 14 : 30));
  const periodEnd = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
  const status = mode === "lifetime" ? "lifetime" : mode === "trial" ? "trialing" : "active";
  return { days, periodEnd, status };
}

// ---------------------------------------------------------------------------
// getUserDetail
// ---------------------------------------------------------------------------
export type UserDetail = {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    displayName: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    /** Bloqueio ativo (com ou sem prazo). */
    banned: boolean;
    bannedUntil: string | null;
    emailVerified: boolean;
    /** "senha" (conta credential) ou "magic link". */
    provider: string | null;
    role: string;
    metadata: Json;
  };
  subscriptions: Array<{
    id: string;
    plan: string | null;
    status: string | null;
    provider: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean | null;
    stripeSubscriptionId: string | null;
    customerId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  webhookEvents: Array<{
    id: string;
    provider: string;
    eventType: string;
    status: string;
    subscriptionId: string | null;
    receivedAt: string;
    error: string | null;
  }>;
  auditEntries: Array<{
    id: string;
    action: string;
    resource: string;
    actorEmail: string | null;
    createdAt: string;
    metadata: Json | null;
  }>;
};

export const getUserDetail = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<UserDetail> => {
    await assertAdmin(context);
    const { getAppUser } = await import("@/lib/users.server");
    const { db, schema } = await import("@/db/client.server");

    const au = await getAppUser(data.userId);
    if (!au) throw new Error("Usuário não encontrado.");

    const [cred] = await db()
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(
        and(eq(schema.account.userId, data.userId), eq(schema.account.providerId, "credential")),
      )
      .limit(1);

    const subs = await db()
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, data.userId))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(50);

    // webhook_events não tem user_id; cruzamos por customer_email + subscription_id.
    const wt = schema.webhookEvents;
    const subIds = subs.map((s) => s.stripeSubscriptionId).filter((v): v is string => !!v);
    const whConds: SQL[] = [];
    if (au.email) whConds.push(eq(wt.customerEmail, au.email));
    if (subIds.length > 0) whConds.push(inArray(wt.subscriptionId, subIds));
    const wh = whConds.length
      ? await db()
          .select({
            id: wt.id,
            provider: wt.provider,
            eventType: wt.eventType,
            status: wt.status,
            subscriptionId: wt.subscriptionId,
            receivedAt: wt.receivedAt,
            error: wt.error,
          })
          .from(wt)
          .where(or(...whConds))
          .orderBy(desc(wt.receivedAt))
          .limit(30)
      : [];

    const at = schema.adminAuditLog;
    const audit = await db()
      .select({
        id: at.id,
        action: at.action,
        resource: at.resource,
        actorEmail: at.actorEmail,
        createdAt: at.createdAt,
        metadata: at.metadata,
      })
      .from(at)
      .where(eq(at.targetId, data.userId))
      .orderBy(desc(at.createdAt))
      .limit(30);

    return {
      user: {
        id: au.id,
        email: au.email,
        phone: null,
        displayName: au.name || au.email.split("@")[0] || null,
        createdAt: au.createdAt,
        lastSignInAt: au.lastSignInAt,
        banned: au.banned,
        bannedUntil: au.bannedUntil,
        emailVerified: au.emailVerified,
        provider: cred ? "senha" : "magic link",
        role: au.role,
        metadata: {
          username: au.username,
          aiEnabled: au.aiEnabled,
          isTrial: au.isTrial,
          trialExpiresAt: au.trialExpiresAt,
          mustChangePassword: au.mustChangePassword,
        },
      },
      subscriptions: subs.map((s) => ({
        id: s.id,
        plan: s.plan,
        status: s.status,
        provider: s.provider,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        stripeSubscriptionId: s.stripeSubscriptionId,
        customerId: s.providerCustomerId ?? s.stripeCustomerId ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      webhookEvents: wh,
      auditEntries: audit.map((a) => ({ ...a, metadata: (a.metadata ?? null) as Json | null })),
    };
  });

// ---------------------------------------------------------------------------
// grantManualPlan — concede/estende plano sem passar por gateway.
// Útil para cortesia, parceria, beta-testers, reativações pontuais.
// ---------------------------------------------------------------------------
export const grantManualPlan = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (d: {
      userId: string;
      plan: "starter" | "pro" | "lifetime";
      mode: "trial" | "ativo" | "lifetime";
      durationDays?: number;
      reason?: string;
    }) =>
      z
        .object({
          userId: z.string().uuid(),
          plan: z.enum(["starter", "pro", "lifetime"]),
          mode: z.enum(["trial", "ativo", "lifetime"]),
          durationDays: z.number().int().min(1).max(3650).optional(),
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const { days, periodEnd, status } = manualGrant(data.mode, data.durationDays);

    await db()
      .insert(schema.subscriptions)
      .values({
        userId: data.userId,
        plan: data.plan,
        priceId: `manual_${data.plan}`,
        status,
        provider: "manual",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      });

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "plan.grant_manual",
      resource: "subscription",
      targetId: data.userId,
      metadata: {
        plan: data.plan,
        mode: data.mode,
        durationDays: days,
        reason: data.reason ?? null,
      },
    });
    return { ok: true, status, currentPeriodEnd: periodEnd };
  });

// ---------------------------------------------------------------------------
// impersonateUser — gera magic link de uso único (10 min) para o admin
// abrir em aba anônima e navegar como o usuário. Tudo fica registrado.
// ---------------------------------------------------------------------------
export const impersonateUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { userId: string; reason?: string }) =>
    z.object({ userId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getAppUser } = await import("@/lib/users.server");
    const u = await getAppUser(data.userId);
    if (!u?.email) throw new Error("Usuário sem e-mail.");

    const { generateMagicLink } = await import("@/lib/magicLink.server");
    const actionLink = await generateMagicLink(u.email, "/app");

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "user.impersonate",
      resource: "user",
      targetId: data.userId,
      targetLabel: u.email,
      metadata: { reason: data.reason ?? null },
    });
    return { ok: true, email: u.email, link: actionLink };
  });

// ---------------------------------------------------------------------------
// createManualUser — cria um usuário manualmente no painel admin.
// Caso de uso: presentear acesso (curso/parceria), beta-testers, suporte
// (alguém que pagou fora do checkout). Opcionalmente já concede plano e
// dispara magic link para o convidado definir senha / entrar.
// ---------------------------------------------------------------------------
export const createManualUser = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (d: {
      email: string;
      displayName?: string;
      grant?: {
        plan: "starter" | "pro" | "lifetime";
        mode: "trial" | "ativo" | "lifetime";
        durationDays?: number;
      };
      sendMagicLink?: boolean;
      reason?: string;
    }) =>
      z
        .object({
          email: z.string().trim().toLowerCase().email("E-mail inválido").max(255),
          displayName: z.string().trim().max(120).optional(),
          grant: z
            .object({
              plan: z.enum(["starter", "pro", "lifetime"]),
              mode: z.enum(["trial", "ativo", "lifetime"]),
              durationDays: z.number().int().min(1).max(3650).optional(),
            })
            .optional(),
          sendMagicLink: z.boolean().optional(),
          reason: z.string().max(500).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { createAppUser, findAppUserByEmail } = await import("@/lib/users.server");
    const { db, schema } = await import("@/db/client.server");

    // 1) Verifica duplicidade.
    const dup = await findAppUserByEmail(data.email);
    if (dup) {
      throw new Error(
        `Já existe um usuário com este e-mail (id ${dup.id}). Use o drawer para conceder plano.`,
      );
    }

    // 2) Cria usuário (e-mail já confirmado; entra por magic link até definir senha).
    let newUserId: string;
    try {
      const created = await createAppUser({
        email: data.email,
        name: data.displayName,
        emailVerified: true,
      });
      newUserId = created.id;
    } catch (e) {
      if (e instanceof Error && e.message === "USER_EXISTS") {
        throw new Error("Já existe um usuário com este e-mail.");
      }
      throw e;
    }

    // 3) Concessão opcional de plano (mesma lógica do grantManualPlan).
    let grantInfo: { status: string; currentPeriodEnd: string | null } | null = null;
    if (data.grant) {
      const g = data.grant;
      const { periodEnd, status } = manualGrant(g.mode, g.durationDays);
      await db()
        .insert(schema.subscriptions)
        .values({
          userId: newUserId,
          plan: g.plan,
          priceId: `manual_${g.plan}`,
          status,
          provider: "manual",
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        });
      grantInfo = { status, currentPeriodEnd: periodEnd };
    }

    // 4) Magic link opcional (convite para o usuário entrar).
    let magicLink: string | null = null;
    if (data.sendMagicLink) {
      const { generateMagicLink } = await import("@/lib/magicLink.server");
      magicLink = await generateMagicLink(data.email, "/app");
    }

    // 5) Auditoria.
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "user.created_manually",
      resource: "user",
      targetId: newUserId,
      targetLabel: data.email,
      metadata: {
        displayName: data.displayName ?? null,
        grant: data.grant ?? null,
        sendMagicLink: !!data.sendMagicLink,
        reason: data.reason ?? null,
      },
    });

    return {
      ok: true,
      userId: newUserId,
      email: data.email,
      grant: grantInfo,
      magicLink,
    };
  });

// ---------------------------------------------------------------------------
// checkEmailAvailable — usada pelo dialog de "Novo usuário" para detectar
// duplicidade ANTES da etapa de confirmação, evitando 1 chamada perdida ao
// createAppUser.
// ---------------------------------------------------------------------------
export const checkEmailAvailable = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { email: string }) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(255) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { findAppUserByEmail } = await import("@/lib/users.server");
    const hit = await findAppUserByEmail(data.email);
    return hit
      ? { available: false as const, userId: hit.id, email: data.email }
      : { available: true as const, email: data.email };
  });
