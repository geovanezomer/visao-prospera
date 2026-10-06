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
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AdminClient, AuthClaims } from "./_types";

// Procura usuário por e-mail paginando auth.admin.listUsers (até 5k usuários).
async function findUserByEmail(supabaseAdmin: AdminClient, email: string) {
  const target = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < perPage) break;
  }
  return null;
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
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<UserDetail> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: u, error: uerr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (uerr || !u?.user) throw new Error(uerr?.message ?? "Usuário não encontrado.");
    const au = u.user;

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", data.userId)
      .maybeSingle();

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
      .map((s) => s.stripe_subscription_id)
      .filter((v): v is string => !!v);
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
        bannedUntil: (au as { banned_until?: string | null }).banned_until ?? null,
        emailConfirmedAt: au.email_confirmed_at ?? null,
        provider: (au.app_metadata as { provider?: string } | undefined)?.provider ?? null,
        metadata: meta as Json,
      },
      subscriptions: (subs ?? []).map((s) => ({
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
      webhookEvents: (wh ?? []).map((e) => ({
        id: e.id,
        provider: e.provider,
        eventType: e.event_type,
        status: e.status,
        subscriptionId: e.subscription_id,
        receivedAt: e.received_at,
        error: e.error,
      })),
      auditEntries: (audit ?? []).map((a) => ({
        id: a.id,
        action: a.action,
        resource: a.resource,
        actorEmail: a.actor_email,
        createdAt: a.created_at,
        metadata: a.metadata as Json | null,
      })),
    };
  });

// ---------------------------------------------------------------------------
// grantManualPlan — concede/estende plano sem passar por gateway.
// Útil para cortesia, parceria, beta-testers, reativações pontuais.
// ---------------------------------------------------------------------------
export const grantManualPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const days =
      data.mode === "lifetime" ? null : (data.durationDays ?? (data.mode === "trial" ? 14 : 30));
    const periodEnd = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
    const status =
      data.mode === "lifetime" ? "lifetime" : data.mode === "trial" ? "trialing" : "active";

    const { error } = await supabaseAdmin.from("subscriptions").insert({
      user_id: data.userId,
      plan: data.plan,
      price_id: `manual_${data.plan}`,
      status,
      provider: "manual",
      current_period_end: periodEnd,
      cancel_at_period_end: false,
    });
    if (error) throw new Error(error.message);

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
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
  .validator((d: { userId: string; reason?: string }) =>
    z.object({ userId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d),
  )
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

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "user.impersonate",
      resource: "user",
      targetId: data.userId,
      targetLabel: u.user.email,
      metadata: { reason: data.reason ?? null },
    });
    return { ok: true, email: u.user.email, link: actionLink };
  });

// ---------------------------------------------------------------------------
// createManualUser — cria um usuário manualmente no painel admin.
// Caso de uso: presentear acesso (curso/parceria), beta-testers, suporte
// (alguém que pagou fora do checkout). Opcionalmente já concede plano e
// dispara magic link para o convidado definir senha / entrar.
// ---------------------------------------------------------------------------
export const createManualUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Verifica duplicidade paginando todos os usuários (listUsers não filtra por email).
    const dup = await findUserByEmail(supabaseAdmin, data.email);
    if (dup) {
      throw new Error(
        `Já existe um usuário com este e-mail (id ${dup.id}). Use o drawer para conceder plano.`,
      );
    }

    // 2) Cria usuário (e-mail já confirmado para evitar bloqueio).
    const { data: created, error: cerr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      email_confirm: true,
      user_metadata: data.displayName ? { display_name: data.displayName } : undefined,
    });
    if (cerr || !created?.user) {
      throw new Error(cerr?.message ?? "Falha ao criar usuário.");
    }
    const newUserId = created.user.id;

    // 3) Garante linha em profiles (o trigger handle_new_user normalmente cuida,
    //    mas reforçamos de forma idempotente).
    if (data.displayName) {
      await supabaseAdmin
        .from("profiles")
        .upsert({ id: newUserId, display_name: data.displayName }, { onConflict: "id" });
    }

    // 4) Concessão opcional de plano (mesma lógica do grantManualPlan).
    let grantInfo: { status: string; currentPeriodEnd: string | null } | null = null;
    if (data.grant) {
      const g = data.grant;
      const days =
        g.mode === "lifetime" ? null : (g.durationDays ?? (g.mode === "trial" ? 14 : 30));
      const periodEnd = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
      const status =
        g.mode === "lifetime" ? "lifetime" : g.mode === "trial" ? "trialing" : "active";

      const { error: serr } = await supabaseAdmin.from("subscriptions").insert({
        user_id: newUserId,
        plan: g.plan,
        price_id: `manual_${g.plan}`,
        status,
        provider: "manual",
        current_period_end: periodEnd,
        cancel_at_period_end: false,
      });
      if (serr) throw new Error(serr.message);
      grantInfo = { status, currentPeriodEnd: periodEnd };
    }

    // 5) Magic link opcional (convite para o usuário entrar).
    let magicLink: string | null = null;
    if (data.sendMagicLink) {
      const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
      const { data: link, error: lerr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: data.email,
        options: appUrl ? { redirectTo: `${appUrl}/app` } : undefined,
      });
      if (lerr) throw new Error(lerr.message);
      magicLink = (link?.properties?.action_link as string | undefined) ?? null;
    }

    // 6) Auditoria.
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
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
// admin.createUser.
// ---------------------------------------------------------------------------
export const checkEmailAvailable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { email: string }) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(255) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hit = await findUserByEmail(supabaseAdmin, data.email);
    return hit
      ? { available: false as const, userId: hit.id as string, email: data.email }
      : { available: true as const, email: data.email };
  });
