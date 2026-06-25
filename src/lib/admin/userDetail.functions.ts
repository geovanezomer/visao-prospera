// ============================================================================
// Server fns do "drill-down" de usuário no painel Admin.
//
// - getUserDetail: agrega auth.user + profile + histórico de subscriptions
//   + últimos webhook_events do cliente + entradas de auditoria onde o usuário
//   é alvo.
// - grantManualPlan: concede plano manual (trial, ativo ou lifetime) inserindo
//   uma linha em subscriptions com provider='manual'.
// - impersonateUser: gera um magic link de uso único para o admin colar no
//   navegador (modo "logar como"). NÃO altera a sessão atual do admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";

function assertAdmin(claims: any) {
  if (!isAdminEmail((claims?.email as string) ?? "")) {
    throw new Error("Acesso negado: apenas administrador.");
  }
}

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

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
    bannedUntil: string | null;
    emailConfirmedAt: string | null;
    provider: string | null;
    metadata: Record<string, unknown>;
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
    metadata: Record<string, unknown> | null;
  }>;
};

export const getUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<UserDetail> => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: u, error: uerr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (uerr || !u?.user) throw new Error(uerr?.message ?? "Usuário não encontrado.");
    const au = u.user as any;

    const { data: prof } = await supabaseAdmin
      .from("profiles").select("display_name").eq("id", data.userId).maybeSingle();

    const meta = (au.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      (typeof meta.display_name === "string" && meta.display_name) ||
      (typeof meta.full_name === "string" && meta.full_name) ||
      prof?.display_name ||
      (au.email ? au.email.split("@")[0] : null);

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    // webhook_events não tem user_id; cruzamos por customer_email + subscription_id.
    const subIds = (subs ?? [])
      .map((s: any) => s.stripe_subscription_id)
      .filter((v: any): v is string => !!v);
    let whQuery = supabaseAdmin
      .from("webhook_events")
      .select("id, provider, event_type, status, subscription_id, received_at, error")
      .order("received_at", { ascending: false })
      .limit(30);
    if (au.email && subIds.length > 0) {
      const ors = [
        `customer_email.eq.${au.email}`,
        ...subIds.map((id) => `subscription_id.eq.${id}`),
      ].join(",");
      whQuery = whQuery.or(ors);
    } else if (au.email) {
      whQuery = whQuery.eq("customer_email", au.email);
    } else if (subIds.length > 0) {
      whQuery = whQuery.in("subscription_id", subIds);
    } else {
      whQuery = whQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { data: wh } = await whQuery;

    const { data: audit } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id, action, resource, actor_email, created_at, metadata")
      .eq("target_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(30);

    return {
      user: {
        id: au.id,
        email: au.email ?? null,
        phone: au.phone ?? null,
        displayName,
        createdAt: au.created_at,
        lastSignInAt: au.last_sign_in_at ?? null,
        bannedUntil: au.banned_until ?? null,
        emailConfirmedAt: au.email_confirmed_at ?? null,
        provider: au.app_metadata?.provider ?? null,
        metadata: meta,
      },
      subscriptions: (subs ?? []).map((s: any) => ({
        id: s.id,
        plan: s.plan,
        status: s.status,
        provider: s.provider,
        currentPeriodEnd: s.current_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        stripeSubscriptionId: s.stripe_subscription_id,
        customerId: s.provider_customer_id ?? s.stripe_customer_id ?? null,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
      webhookEvents: (wh ?? []).map((e: any) => ({
        id: e.id,
        provider: e.provider,
        eventType: e.event_type,
        status: e.status,
        subscriptionId: e.subscription_id,
        receivedAt: e.received_at,
        error: e.error,
      })),
      auditEntries: (audit ?? []).map((a: any) => ({
        id: a.id,
        action: a.action,
        resource: a.resource,
        actorEmail: a.actor_email,
        createdAt: a.created_at,
        metadata: a.metadata,
      })),
    };
  });

// ---------------------------------------------------------------------------
// grantManualPlan — concede/estende plano sem passar por gateway.
// Útil para cortesia, parceria, beta-testers, reativações pontuais.
// ---------------------------------------------------------------------------
export const grantManualPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
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
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const days =
      data.mode === "lifetime"
        ? null
        : data.durationDays ?? (data.mode === "trial" ? 14 : 30);
    const periodEnd = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
    const status =
      data.mode === "lifetime" ? "lifetime" : data.mode === "trial" ? "trialing" : "active";

    const { error } = await supabaseAdmin.from("subscriptions").insert({
      user_id: data.userId,
      plan: data.plan,
      status,
      provider: "manual",
      current_period_end: periodEnd,
      cancel_at_period_end: false,
    });
    if (error) throw new Error(error.message);

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as any)?.email,
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; reason?: string }) =>
    z.object({ userId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
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
    const actionLink = (link as any)?.properties?.action_link as string | undefined;
    if (!actionLink) throw new Error("Falha ao gerar link.");

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as any)?.email,
      action: "user.impersonate",
      resource: "user",
      targetId: data.userId,
      targetLabel: u.user.email,
      metadata: { reason: data.reason ?? null },
    });
    return { ok: true, email: u.user.email, link: actionLink };
  });
