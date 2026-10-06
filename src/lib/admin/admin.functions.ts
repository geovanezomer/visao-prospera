// ============================================================================
// Server fns do painel Admin.
//
// Toda fn aqui:
//   1) Exige sessão (requireSupabaseAuth).
//   2) Confere se o e-mail do caller == ADMIN_EMAIL (helper assertAdmin).
//   3) Só então carrega supabaseAdmin (service role) para listar/alterar
//      auth.users, subscriptions e disparar refunds.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./assertAdmin";

/**
 * `banned_until` é um campo admin-only do Supabase Auth e não vem
 * declarado no tipo `User` público. Tipamos localmente para não usar `any`.
 */
type AdminUser = User & { banned_until?: string | null };

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
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const page = data.page ?? 1;
    const perPage = data.perPage ?? 50;
    const sort = data.sort ?? "created_desc";
    const filters = data.filters ?? {};

    // Carrega usuários em lotes. Cap prático: 5000 (25 páginas × 200).
    // Acima disso a UI deve usar busca específica; logamos um aviso.
    const MAX_PAGES = 25;
    const all: AdminUser[] = [];
    let truncated = false;
    for (let p = 1; p <= MAX_PAGES; p++) {
      const { data: usersPage, error } = await supabaseAdmin.auth.admin.listUsers({
        page: p,
        perPage: 200,
      });
      if (error) throw new Error(error.message);
      all.push(...((usersPage.users ?? []) as AdminUser[]));
      if ((usersPage.users ?? []).length < 200) break;
      if (p === MAX_PAGES) truncated = true;
    }
    if (truncated) {
      console.warn(
        `[admin] listAdminUsers atingiu cap de ${MAX_PAGES * 200} usuários; refine a busca.`,
      );
    }

    const ids = all.map((u) => u.id);
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "user_id, plan, status, current_period_end, provider, provider_customer_id, stripe_customer_id, stripe_subscription_id, created_at",
      )
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });
    type SubRow = NonNullable<typeof subs>[number];
    const subByUser = new Map<string, SubRow>();
    for (const s of subs ?? []) if (!subByUser.has(s.user_id)) subByUser.set(s.user_id, s);

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    type ProfRow = NonNullable<typeof profiles>[number];
    const profById = new Map<string, ProfRow>();
    for (const p of profiles ?? []) profById.set(p.id, p);

    // Admins via banco (RBAC SSOT). Substitui checagem por env var.
    const { data: adminRoleRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const adminIds = new Set<string>((adminRoleRows ?? []).map((r) => r.user_id));

    let rows: AdminUserRow[] = all.map((u) => {
      const s = subByUser.get(u.id);
      const p = profById.get(u.id);
      const bannedUntil = u.banned_until ?? null;
      const isBanned = bannedUntil ? new Date(bannedUntil).getTime() > Date.now() : false;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const displayName =
        (typeof meta.display_name === "string" && meta.display_name) ||
        (typeof meta.full_name === "string" && meta.full_name) ||
        p?.display_name ||
        (u.email ? u.email.split("@")[0] : null);
      return {
        id: u.id,
        email: u.email ?? "",
        phone: u.phone ?? null,
        displayName,
        createdAt: u.created_at,
        bannedUntil,
        isActive: !isBanned,
        plan: s?.plan ?? null,
        planStatus: s?.status ?? null,
        currentPeriodEnd: s?.current_period_end ?? null,
        provider: s?.provider ?? null,
        subscriptionId: s?.stripe_subscription_id ?? null,
        customerId: s?.provider_customer_id ?? s?.stripe_customer_id ?? null,
        isAdmin: adminIds.has(u.id),
        aiEnabled: (meta as Record<string, unknown>).ai_enabled !== false,
      } as AdminUserRow;
    });

    // Filtros
    const q = (data.search ?? "").trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.email.toLowerCase().includes(q) ||
          (r.displayName ?? "").toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q) ||
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
// setUserActive — bane (ban_duration: "100000h") ou reativa ("none").
// ----------------------------------------------------------------------------
export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string; active: boolean }) =>
    z.object({ userId: z.string().uuid(), active: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Bloqueio: o próprio admin não pode se desativar.
    if (data.userId === context.userId && !data.active) {
      throw new Error("Você não pode desativar a própria conta de administrador.");
    }

    // `ban_duration` é parte da API admin do Supabase mas não está nos
    // tipos públicos. Cast estreito (apenas o campo necessário) em vez de `any`.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.active ? "none" : "100000h",
    } as { ban_duration: string });
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email,
      action: data.active ? "user.activate" : "user.deactivate",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// setUserAIEnabled — liga/desliga acesso ao Consultor IA (sidebar e rota).
// Persistido em user_metadata.ai_enabled; lido pelo cliente em toAuthUser.
// ----------------------------------------------------------------------------
export const setUserAIEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: u, error: gerr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (gerr || !u?.user) throw new Error(gerr?.message ?? "Usuário não encontrado.");
    const meta = (u.user.user_metadata ?? {}) as Record<string, unknown>;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      user_metadata: { ...meta, ai_enabled: data.enabled },
    });
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email,
      action: data.enabled ? "user.ai_enable" : "user.ai_disable",
      resource: "user",
      targetId: data.userId,
    });
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// sendPasswordReset — gera link de recuperação e dispara via Supabase Auth.
// ----------------------------------------------------------------------------
export const sendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: u, error: gerr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (gerr || !u?.user?.email) throw new Error(gerr?.message ?? "Usuário sem e-mail.");

    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(u.user.email, {
      redirectTo: appUrl ? `${appUrl}/reset-password` : undefined,
    });
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email,
      action: "user.password_reset",
      resource: "user",
      targetId: data.userId,
      targetLabel: u.user.email,
    });
    return { ok: true, email: u.user.email };
  });

// ----------------------------------------------------------------------------
// revalidatePlan — re-executa a leitura do plano corrente do usuário.
// Retorna a linha mais recente de subscriptions; útil após webhook atrasar.
// ----------------------------------------------------------------------------
export const revalidatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status, current_period_end, provider, cancel_at_period_end, updated_at")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { sub };
  });

// ----------------------------------------------------------------------------
// refundPayment — estorno total ou parcial via provedor ativo.
// `amount` em centavos para Stripe; em reais para Asaas (adapter normaliza).
// ----------------------------------------------------------------------------
export const refundPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select("provider, stripe_subscription_id, provider_customer_id, stripe_customer_id")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Usuário sem assinatura.");

    const { refundAndRevoke } = await import("@/lib/payments/refund.server");
    const result = await refundAndRevoke({
      provider: sub.provider ?? "stripe",
      subscriptionId: sub.stripe_subscription_id,
      customerId: sub.provider_customer_id ?? sub.stripe_customer_id,
      amount: data.amount,
      reason: data.reason,
      revoke: data.revoke ?? true,
      userId: data.userId,
      actorId: context.userId,
    });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as { email?: string } | undefined)?.email,
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
// resendMagicLink — gera novo magic link Supabase e envia via Resend (usando
// templates/SMTP do banco quando configurado). Útil quando o e-mail inicial
// (pós-checkout) se perdeu.
// ----------------------------------------------------------------------------
export const resendMagicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (error || !u?.user?.email) throw new Error(error?.message ?? "Usuário sem e-mail.");

    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const { data: link, error: lerr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: u.user.email,
      options: appUrl ? { redirectTo: `${appUrl}/app` } : undefined,
    });
    if (lerr) throw new Error(lerr.message);
    const actionLink = link?.properties?.action_link as string | undefined;
    if (!actionLink) throw new Error("Falha ao gerar link.");

    // Tenta enviar via Resend (banco → env fallback). Se nada configurado,
    // devolve o link para o admin copiar manualmente.
    const { data: cfg } = await supabaseAdmin
      .from("email_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    const apiKey = cfg?.resend_api_key || process.env.RESEND_API_KEY;
    const fromEmail = cfg?.from_email || process.env.FEEDBACK_FROM || process.env.MAGICLINK_FROM;
    const fromName = cfg?.from_name || "Finnance";
    if (!apiKey || !fromEmail) {
      return { ok: true, email: u.user.email, link: actionLink, sent: false };
    }
    const name = u.user.email.split("@")[0];
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: u.user.email,
        subject: "Seu acesso ao Finnance",
        html: `<p>Olá ${name}, acesse novamente clicando <a href="${actionLink}">aqui</a>.</p>`,
      }),
    });
    if (!res.ok) {
      console.error("[admin] resendMagicLink Resend falhou", await res.text());
      return { ok: true, email: u.user.email, link: actionLink, sent: false };
    }
    return { ok: true, email: u.user.email, sent: true };
  });
