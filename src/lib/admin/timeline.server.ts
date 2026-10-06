// ============================================================================
// Coletores da linha do tempo do cliente (server-only). Ver
// timeline.functions.ts para a descrição das fontes.
// ============================================================================
import { desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import type { TimelineItem, TimelineTone } from "./timeline.functions";

/** SHA-256 do e-mail normalizado (mesma função usada em lifecycleEmails). */
async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function collectSubscriptions(
  userId: string,
): Promise<{ items: TimelineItem[]; subIds: string[] }> {
  const t = schema.subscriptions;
  const rows = await db()
    .select({
      id: t.id,
      plan: t.plan,
      status: t.status,
      provider: t.provider,
      stripeSubscriptionId: t.stripeSubscriptionId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .where(eq(t.userId, userId))
    .orderBy(desc(t.createdAt))
    .limit(50);

  const items: TimelineItem[] = [];
  const subIds: string[] = [];
  for (const s of rows) {
    if (s.stripeSubscriptionId) subIds.push(s.stripeSubscriptionId);
    items.push({
      id: `sub-created-${s.id}`,
      at: s.createdAt,
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
        at: s.updatedAt,
        kind: "assinatura",
        title: `Assinatura cancelada · ${s.plan ?? "—"}`,
        tone: "warn",
      });
    }
  }
  return { items, subIds };
}

async function collectWebhooks(email: string | null, subIds: string[]): Promise<TimelineItem[]> {
  const t = schema.webhookEvents;
  const conds: SQL[] = [];
  if (email) conds.push(eq(t.customerEmail, email));
  if (subIds.length > 0) conds.push(inArray(t.subscriptionId, subIds));
  if (conds.length === 0) return [];
  const rows = await db()
    .select({
      id: t.id,
      provider: t.provider,
      eventType: t.eventType,
      status: t.status,
      subscriptionId: t.subscriptionId,
      receivedAt: t.receivedAt,
      error: t.error,
    })
    .from(t)
    .where(or(...conds))
    .orderBy(desc(t.receivedAt))
    .limit(100);
  return rows.map((e) => {
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
      e.subscriptionId ? `sub=${e.subscriptionId}` : null,
      e.error ? `erro=${e.error}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: `wh-${e.id}`,
      at: e.receivedAt,
      kind: "webhook" as const,
      title: `${e.eventType} · ${e.status}`,
      detail,
      tone,
      refId: e.id,
    };
  });
}

async function collectEmails(email: string | null): Promise<TimelineItem[]> {
  if (!email) return [];
  const t = schema.emailLog;
  try {
    const rows = await db()
      .select({ id: t.id, kind: t.kind, subscriptionId: t.subscriptionId, sentAt: t.sentAt })
      .from(t)
      .where(eq(t.sentToHash, await hashEmail(email)))
      .orderBy(desc(t.sentAt))
      .limit(100);
    return rows.map((r) => ({
      id: `em-${r.id}`,
      at: r.sentAt,
      kind: "email" as const,
      title: `E-mail enviado · ${r.kind}`,
      detail: r.subscriptionId ? `sub=${r.subscriptionId}` : undefined,
      tone: "ok" as const,
    }));
  } catch (e) {
    // Fonte opcional: falha aqui não derruba a linha do tempo.
    console.error("[timeline] email_log indisponível:", e instanceof Error ? e.message : e);
    return [];
  }
}

async function collectAudit(userId: string): Promise<TimelineItem[]> {
  // Mesma fonte da AuditTab (listAuditLog) filtrando target_id = userId.
  const t = schema.adminAuditLog;
  const rows = await db()
    .select({
      id: t.id,
      action: t.action,
      resource: t.resource,
      actorEmail: t.actorEmail,
      createdAt: t.createdAt,
    })
    .from(t)
    .where(eq(t.targetId, userId))
    .orderBy(desc(t.createdAt))
    .limit(100);
  return rows.map((a) => ({
    id: `au-${a.id}`,
    at: a.createdAt,
    kind: "admin" as const,
    title: `${a.action} · ${a.actorEmail ?? "sistema"}`,
    detail: `recurso=${a.resource}`,
    tone: /fail|error|revoke|ban/i.test(a.action) ? ("warn" as const) : ("neutral" as const),
  }));
}

async function collectCheckouts(email: string | null): Promise<TimelineItem[]> {
  if (!email) return [];
  const t = schema.checkoutIntents;
  const rows = await db()
    .select({
      id: t.id,
      status: t.status,
      planSlug: t.planSlug,
      provider: t.provider,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      confirmedAt: t.confirmedAt,
      lastError: t.lastError,
    })
    .from(t)
    .where(eq(t.email, email))
    .orderBy(desc(t.createdAt))
    .limit(100);
  return rows.map((c) => {
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
      at: c.confirmedAt ?? c.updatedAt ?? c.createdAt,
      kind: "checkout" as const,
      title: `Checkout ${c.status} · ${c.planSlug}`,
      detail: [`provider=${c.provider}`, c.lastError ? `erro=${c.lastError}` : null]
        .filter(Boolean)
        .join(" · "),
      tone,
    };
  });
}

/** Orquestra as fontes e ordena por data desc (máx. 100 itens). */
export async function aggregateTimeline(
  userId: string,
  email: string | null,
): Promise<TimelineItem[]> {
  const [subsBundle, audit] = await Promise.all([
    collectSubscriptions(userId),
    collectAudit(userId),
  ]);
  const [webhooks, emails, checkouts] = await Promise.all([
    collectWebhooks(email, subsBundle.subIds),
    collectEmails(email),
    collectCheckouts(email),
  ]);
  const all: TimelineItem[] = [...subsBundle.items, ...webhooks, ...emails, ...audit, ...checkouts];
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, 100);
}
