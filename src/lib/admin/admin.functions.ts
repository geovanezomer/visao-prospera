// ============================================================================
// Server fns do painel Admin.
//
// Toda fn aqui:
//   1) Exige sessão (requireAuth).
//   2) Confere o papel admin no banco (helper assertAdmin).
//   3) Só então carrega o banco (Drizzle) / helpers de usuário para
//      listar/alterar usuários, assinaturas e disparar refunds.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/requireAuth";
import { assertAdmin } from "./assertAdmin";
import { actorEmail } from "./_types";

// ----------------------------------------------------------------------------
// listAdminUsers — devolve a página com usuários + assinatura + ban status.
// ----------------------------------------------------------------------------
export type AdminUserRow = {
  id: string;
  email: string;
  phone: string | null;
  displayName: string | null;
  createdAt: string;
  bannedUntil: string | null;
  isActive: boolean;
  plan: string | null;
  planStatus: string | null;
  currentPeriodEnd: string | null;
  provider: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  isAdmin: boolean;
  /** Acesso ao Consultor IA na sidebar. Default = true. */
  aiEnabled: boolean;
};

export type AdminUserFilters = {
  plan?: "all" | "free" | "starter" | "pro" | "lifetime";
  status?: "all" | "active" | "trialing" | "past_due" | "canceled" | "none";
  provider?: "all" | "stripe" | "asaas";
};
export type AdminUserSort =
  | "created_desc"
  | "created_asc"
  | "expires_desc"
  | "expires_asc"
  | "name_asc"
  | "name_desc";

export const listAdminUsers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (data: {
      page?: number;
      perPage?: number;
      search?: string;
      sort?: AdminUserSort;
      filters?: AdminUserFilters;
    }) =>
      z
        .object({
          page: z.number().int().min(1).max(1000).optional(),
          perPage: z.number().int().min(1).max(200).optional(),
          search: z.string().max(120).optional(),
          sort: z
            .enum([
              "created_desc",
              "created_asc",
              "expires_desc",
              "expires_asc",
              "name_asc",
              "name_desc",
            ])
            .optional(),
          filters: z
            .object({
              plan: z.enum(["all", "free", "starter", "pro", "lifetime"]).optional(),
              status: z
                .enum(["all", "active", "trialing", "past_due", "canceled", "none"])
                .optional(),
              provider: z.enum(["all", "stripe", "asaas"]).optional(),
            })
            .optional(),
        })
        .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { listAppUsers } = await import("@/lib/users.server");
    const { db, schema } = await import("@/db/client.server");

    const page = data.page ?? 1;
    const perPage = data.perPage ?? 50;
    const sort = data.sort ?? "created_desc";
    const filters = data.filters ?? {};

    const all = await listAppUsers();
    const ids = all.map((u) => u.id);
    const subs = ids.length
      ? await db()
          .select({
            userId: schema.subscriptions.userId,
            plan: schema.subscriptions.plan,
            status: schema.subscriptions.status,
            currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
            provider: schema.subscriptions.provider,
            providerCustomerId: schema.subscriptions.providerCustomerId,
            stripeCustomerId: schema.subscriptions.stripeCustomerId,
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
          })
          .from(schema.subscriptions)
          .where(inArray(schema.subscriptions.userId, ids))
          .orderBy(desc(schema.subscriptions.createdAt))
      : [];
    type SubRow = (typeof subs)[number];
    const subByUser = new Map<string, SubRow>();
    for (const s of subs) if (!subByUser.has(s.userId)) subByUser.set(s.userId, s);

    let rows: AdminUserRow[] = all.map((u) => {
      const s = subByUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        phone: null,
        displayName: u.name || u.email.split("@")[0] || null,
        createdAt: u.createdAt,
        bannedUntil: u.bannedUntil,
        isActive: !u.banned,
        plan: s?.plan ?? null,
        planStatus: s?.status ?? null,
        currentPeriodEnd: s?.currentPeriodEnd ?? null,
        provider: s?.provider ?? null,
        subscriptionId: s?.stripeSubscriptionId ?? null,
        customerId: s?.providerCustomerId ?? s?.stripeCustomerId ?? null,
        isAdmin: u.role === "admin",
        aiEnabled: u.aiEnabled,
      };
    });

    // Filtros
    const q = (data.search ?? "").trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.email.toLowerCase().includes(q) ||
          (r.displayName ?? "").toLowerCase().includes(q) ||
          (r.subscriptionId ?? "").toLowerCase().includes(q),
      );
    }
    if (filters.plan && filters.plan !== "all") {
      rows =
        filters.plan === "free"
          ? rows.filter((r) => !r.plan)
          : rows.filter((r) => r.plan === filters.plan);
    }
    if (filters.status && filters.status !== "all") {
      rows =
        filters.status === "none"
          ? rows.filter((r) => !r.planStatus)
          : rows.filter((r) => r.planStatus === filters.status);
    }
    if (filters.provider && filters.provider !== "all") {
      rows = rows.filter((r) => r.provider === filters.provider);
    }

    // Ordenação
    const cmpDate = (a?: string | null, b?: string | null) => {
      const A = a ? new Date(a).getTime() : 0;
      const B = b ? new Date(b).getTime() : 0;
      return A - B;
    };
    rows.sort((a, b) => {
      switch (sort) {
        case "created_asc":
          return cmpDate(a.createdAt, b.createdAt);
        case "created_desc":
          return cmpDate(b.createdAt, a.createdAt);
        case "expires_asc":
          return cmpDate(a.currentPeriodEnd, b.currentPeriodEnd);
        case "expires_desc":
          return cmpDate(b.currentPeriodEnd, a.currentPeriodEnd);
        case "name_asc":
          return (a.displayName ?? "").localeCompare(b.displayName ?? "");
        case "name_desc":
          return (b.displayName ?? "").localeCompare(a.displayName ?? "");
        default:
          return 0;
      }
    });

    const total = rows.length;
    const from = (page - 1) * perPage;
    const paged = rows.slice(from, from + perPage);
    return { users: paged, page, perPage, total };
  });

// ----------------------------------------------------------------------------
// setUserActive — bloqueia sem prazo (derrubando as sessões) ou reativa.
// ----------------------------------------------------------------------------
export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string; active: boolean }) =>
    z.object({ userId: z.string().uuid(), active: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    // Bloqueio: o próprio admin não pode se desativar.
    if (data.userId === context.userId && !data.active) {
      throw new Error("Você não pode desativar a própria conta de administrador.");
    }

    const { getAppUser, setUserBan } = await import("@/lib/users.server");
    if (!(await getAppUser(data.userId))) throw new Error("Usuário não encontrado.");
    await setUserBan(data.userId, data.active ? null : "forever");
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: data.active ? "user.activate" : "user.deactivate",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// setUserAIEnabled — liga/desliga acesso ao Consultor IA (sidebar e rota).
// Persistido em user.ai_enabled (gravado só pelo servidor).
// ----------------------------------------------------------------------------
export const setUserAIEnabled = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string; enabled: boolean }) =>
    z.object({ userId: z.string().uuid(), enabled: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // Bloqueio simétrico ao setUserActive: admin não pode se auto-bloquear
    // do Consultor IA (evita lockout silencioso da própria conta).
    if (data.userId === context.userId && !data.enabled) {
      throw new Error("Você não pode desativar a I.A. da própria conta de administrador.");
    }
    const { getAppUser, updateAppUser } = await import("@/lib/users.server");
    if (!(await getAppUser(data.userId))) throw new Error("Usuário não encontrado.");
    await updateAppUser(data.userId, { aiEnabled: data.enabled });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: data.enabled ? "user.ai_enable" : "user.ai_disable",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// sendPasswordReset — gera link de recuperação e dispara via Better Auth
// (e-mail enviado pelo `sendResetPassword` configurado em auth.server).
// ----------------------------------------------------------------------------
export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getAppUser } = await import("@/lib/users.server");
    const u = await getAppUser(data.userId);
    if (!u?.email) throw new Error("Usuário sem e-mail.");

    const { auth } = await import("@/lib/auth.server");
    await auth().api.requestPasswordReset({
      body: { email: u.email, redirectTo: "/reset-password" },
      headers: new Headers(),
    });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "user.password_reset",
      resource: "user",
      targetId: data.userId,
      targetLabel: u.email,
    });
    return { ok: true, email: u.email };
  });

// ----------------------------------------------------------------------------
// revalidatePlan — re-executa a leitura do plano corrente do usuário.
// Retorna a linha mais recente de subscriptions; útil após webhook atrasar.
// ----------------------------------------------------------------------------
export const revalidatePlan = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.subscriptions;
    const [row] = await db()
      .select({
        plan: t.plan,
        status: t.status,
        current_period_end: t.currentPeriodEnd,
        provider: t.provider,
        cancel_at_period_end: t.cancelAtPeriodEnd,
        updated_at: t.updatedAt,
      })
      .from(t)
      .where(eq(t.userId, data.userId))
      .orderBy(desc(t.createdAt))
      .limit(1);
    return { sub: row ?? null };
  });

// ----------------------------------------------------------------------------
// refundPayment — estorno total ou parcial via provedor ativo.
// `amount` em centavos para Stripe; em reais para Asaas (adapter normaliza).
// ----------------------------------------------------------------------------
export const refundPayment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string; amount?: number; reason?: string; revoke?: boolean }) =>
    z
      .object({
        userId: z.string().uuid(),
        amount: z.number().positive().optional(),
        reason: z.string().max(500).optional(),
        revoke: z.boolean().optional().default(true),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.subscriptions;
    const [sub] = await db()
      .select({
        provider: t.provider,
        stripeSubscriptionId: t.stripeSubscriptionId,
        providerCustomerId: t.providerCustomerId,
        stripeCustomerId: t.stripeCustomerId,
      })
      .from(t)
      .where(eq(t.userId, data.userId))
      .orderBy(desc(t.createdAt))
      .limit(1);
    if (!sub) throw new Error("Usuário sem assinatura.");

    const { refundAndRevoke } = await import("@/lib/payments/refund.server");
    const result = await refundAndRevoke({
      provider: sub.provider ?? "stripe",
      subscriptionId: sub.stripeSubscriptionId,
      customerId: sub.providerCustomerId ?? sub.stripeCustomerId,
      amount: data.amount,
      reason: data.reason,
      revoke: data.revoke ?? true,
      userId: data.userId,
      actorId: context.userId,
    });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "payment.refund",
      resource: "subscription",
      targetId: data.userId,
      metadata: {
        amount: data.amount,
        reason: data.reason,
        provider: sub.provider,
        revoke: data.revoke ?? true,
        result,
      },
    });
    return result;
  });

// ----------------------------------------------------------------------------
// resendMagicLink — gera novo magic link e envia pelo mailer (SMTP/Resend,
// conforme configurado). Útil quando o e-mail inicial (pós-checkout) se
// perdeu. Sem envio configurado, devolve o link para o admin copiar.
// ----------------------------------------------------------------------------
export const resendMagicLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getAppUser } = await import("@/lib/users.server");
    const u = await getAppUser(data.userId);
    if (!u?.email) throw new Error("Usuário sem e-mail.");

    const { generateMagicLink } = await import("@/lib/magicLink.server");
    const actionLink = await generateMagicLink(u.email, "/app");

    const { sendMail } = await import("@/lib/mailer.server");
    const name = (u.name || u.email.split("@")[0]).replace(
      /[&<>"']/g,
      (c) => `&#${c.charCodeAt(0)};`,
    );
    const res = await sendMail({
      to: u.email,
      subject: "Seu acesso ao FinnancePRO",
      html: `<p>Olá ${name}, acesse novamente clicando <a href="${actionLink}">aqui</a>.</p>`,
      text: `Olá ${name}, acesse novamente: ${actionLink}`,
    });
    if (!res.sent) {
      if (res.error) console.error("[admin] resendMagicLink envio falhou", res.error);
      return { ok: true, email: u.email, link: actionLink, sent: false };
    }
    return { ok: true, email: u.email, sent: true };
  });
