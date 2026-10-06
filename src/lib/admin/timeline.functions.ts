// ============================================================================
// getUserTimeline — visão 360° do cliente: agrega eventos de múltiplas fontes
// (webhooks, e-mails de lifecycle, auditoria admin, checkouts, assinaturas)
// em uma linha do tempo unificada, ordenada por data desc, limite 100.
//
// Fontes:
//   • webhook_events  → tipo "webhook"    (por customer_email OU subscription_id)
//   • email_log       → tipo "email"      (filtrado por sent_to_hash = SHA-256(email))
//   • admin_audit_log → tipo "admin"      (target_id = userId) — mesma query da AuditTab
//   • checkout_intents→ tipo "checkout"   (por email)
//   • subscriptions   → tipo "assinatura" (created + canceled quando aplicável)
//
// Cada item é normalizado para { at, kind, title, detail?, tone, refId? }
// para simplificar a renderização e o filtro por tipo na UI.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./assertAdmin";
import type { AdminClient } from "./_types";

export type TimelineKind = "webhook" | "email" | "admin" | "checkout" | "assinatura";
export type TimelineTone = "ok" | "warn" | "bad" | "neutral";

export type TimelineItem = {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  tone: TimelineTone;
  /** Referência para ações contextuais (ex.: id do webhook_event para replay). */
  refId?: string;
};

/** SHA-256 do e-mail normalizado (mesma função usada em lifecycleEmails). */
async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function tableExists(admin: AdminClient, name: string): Promise<boolean> {
  try {
    const { error } = await admin
      .from(name as never)
      .select("*", { head: true, count: "exact" })
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ─── Coletores por fonte (retornam TimelineItem[]) ──────────────────────────

async function collectSubscriptions(
  admin: AdminClient,
  userId: string,
): Promise<{
  items: TimelineItem[];
  subIds: string[];
}> {
  const { data } = await admin
    .from("subscriptions")
    .select(
      "id, plan, status, provider, stripe_subscription_id, created_at, updated_at, cancel_at_period_end",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const items: TimelineItem[] = [];
  const subIds: string[] = [];
  for (const s of data ?? []) {
    if (s.stripe_subscription_id) subIds.push(s.stripe_subscription_id);
    items.push({
      id: `sub-created-${s.id}`,
      at: s.created_at,
      kind: "assinatura",
      title: `Assinatura criada · ${s.plan ?? "—"}`,
      detail: `provider=${s.provider ?? "—"} status=${s.status ?? "—"}`,
      tone:
        s.status === "active" || s.status === "trialing" || s.status === "lifetime"
          ? "ok"
          : "neutral",
    });
    // Schema não tem canceled_at — usamos updated_at quando status=canceled.
    if (s.status === "canceled") {
      items.push({
        id: `sub-canceled-${s.id}`,
        at: s.updated_at,
        kind: "assinatura",
        title: `Assinatura cancelada · ${s.plan ?? "—"}`,
        tone: "warn",
      });
    }
  }
  return { items, subIds };
}

async function collectWebhooks(
  admin: AdminClient,
  email: string | null,
  subIds: string[],
): Promise<TimelineItem[]> {
  if (!email && subIds.length === 0) return [];
  let q = admin
    .from("webhook_events")
    .select("id, provider, event_type, status, subscription_id, received_at, error")
    .order("received_at", { ascending: false })
    .limit(100);
  if (email && subIds.length > 0) {
    const ors = [
      `customer_email.eq.${email}`,
      ...subIds.map((id) => `subscription_id.eq.${id}`),
    ].join(",");
    q = q.or(ors);
  } else if (email) {
    q = q.eq("customer_email", email);
  } else {
    q = q.in("subscription_id", subIds);
  }
  const { data } = await q;
  return (data ?? []).map((e) => {
    const tone: TimelineTone =
      e.status === "processed" || e.status === "replayed"
        ? "ok"
        : e.status === "failed" || e.status === "dead_letter"
          ? "bad"
          : e.status === "pending_retry"
            ? "warn"
            : "neutral";
    const detail = [
      `provider=${e.provider}`,
      e.subscription_id ? `sub=${e.subscription_id}` : null,
      e.error ? `erro=${e.error}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: `wh-${e.id}`,
      at: e.received_at,
      kind: "webhook",
      title: `${e.event_type} · ${e.status}`,
      detail,
      tone,
      refId: e.id,
    };
  });
}

async function collectEmails(admin: AdminClient, email: string | null): Promise<TimelineItem[]> {
  if (!email) return [];
  // Fonte opcional: se a tabela email_log não existir (schemas antigos), omite.
  if (!(await tableExists(admin, "email_log"))) return [];
  const hash = await hashEmail(email);
  const { data } = await admin
    .from("email_log")
    .select("id, kind, subscription_id, sent_at")
    .eq("sent_to_hash", hash)
    .order("sent_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => ({
    id: `em-${r.id}`,
    at: r.sent_at,
    kind: "email" as const,
    title: `E-mail enviado · ${r.kind}`,
    detail: r.subscription_id ? `sub=${r.subscription_id}` : undefined,
    tone: "ok" as const,
  }));
}

async function collectAudit(admin: AdminClient, userId: string): Promise<TimelineItem[]> {
  // Mesma query da AuditTab (listAuditLog) filtrando target_id = userId.
  const { data } = await admin
    .from("admin_audit_log")
    .select("id, action, resource, actor_email, created_at, metadata")
    .eq("target_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((a) => ({
    id: `au-${a.id}`,
    at: a.created_at,
    kind: "admin" as const,
    title: `${a.action} · ${a.actor_email ?? "sistema"}`,
    detail: `recurso=${a.resource}`,
    tone: /fail|error|revoke|ban/i.test(a.action) ? "warn" : "neutral",
  }));
}

async function collectCheckouts(admin: AdminClient, email: string | null): Promise<TimelineItem[]> {
  if (!email) return [];
  const { data } = await admin
    .from("checkout_intents")
    .select("id, status, plan_slug, provider, created_at, updated_at, confirmed_at, last_error")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((c) => {
    const tone: TimelineTone =
      c.status === "paid" || c.status === "confirmed"
        ? "ok"
        : c.status === "failed"
          ? "bad"
          : c.status === "redirected" || c.status === "created"
            ? "neutral"
            : "warn";
    return {
      id: `co-${c.id}`,
      at: c.confirmed_at ?? c.updated_at ?? c.created_at,
      kind: "checkout" as const,
      title: `Checkout ${c.status} · ${c.plan_slug}`,
      detail: [`provider=${c.provider}`, c.last_error ? `erro=${c.last_error}` : null]
        .filter(Boolean)
        .join(" · "),
      tone,
    };
  });
}

// ─── Server fn ──────────────────────────────────────────────────────────────

export const getUserTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { userId: string; email?: string | null }) =>
    z
      .object({
        userId: z.string().uuid(),
        email: z.string().email().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: TimelineItem[] }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { items: await aggregateTimeline(supabaseAdmin, data.userId, data.email ?? null) };
  });

/**
 * Núcleo puro (testável) — orquestra as fontes e ordena.
 * Exportado para permitir testes com admin mockado.
 */
export async function aggregateTimeline(
  admin: AdminClient,
  userId: string,
  email: string | null,
): Promise<TimelineItem[]> {
  const [subsBundle, audit] = await Promise.all([
    collectSubscriptions(admin, userId),
    collectAudit(admin, userId),
  ]);
  const [webhooks, emails, checkouts] = await Promise.all([
    collectWebhooks(admin, email, subsBundle.subIds),
    collectEmails(admin, email),
    collectCheckouts(admin, email),
  ]);
  const all: TimelineItem[] = [...subsBundle.items, ...webhooks, ...emails, ...audit, ...checkouts];
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, 100);
}
