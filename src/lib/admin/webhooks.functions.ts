// ============================================================================
// Server fns: webhook_events (consulta e replay).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { and, count, desc, eq, gte, ilike, or } from "drizzle-orm";
import { actorEmail, toSnake, type Json } from "./_types";

export const listWebhookEvents = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (d: {
      page?: number;
      perPage?: number;
      search?: string;
      provider?: "all" | "stripe" | "asaas" | "admin";
      status?:
        | "all"
        | "processed"
        | "failed"
        | "skipped"
        | "replayed"
        | "pending_retry"
        | "dead_letter";
    }) =>
      z
        .object({
          page: z.number().int().min(1).max(10000).optional(),
          perPage: z.number().int().min(1).max(200).optional(),
          search: z.string().max(120).optional(),
          provider: z.enum(["all", "stripe", "asaas", "admin"]).optional(),
          status: z
            .enum([
              "all",
              "processed",
              "failed",
              "skipped",
              "replayed",
              "pending_retry",
              "dead_letter",
            ])
            .optional(),
        })
        .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.webhookEvents;
    const page = data.page ?? 1;
    const perPage = data.perPage ?? 50;

    const conds = [];
    if (data.provider && data.provider !== "all") conds.push(eq(t.provider, data.provider));
    if (data.status && data.status !== "all") conds.push(eq(t.status, data.status));
    if (data.search?.trim()) {
      const like = `%${data.search.trim()}%`;
      conds.push(
        or(ilike(t.customerEmail, like), ilike(t.subscriptionId, like), ilike(t.eventType, like)),
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    // KPIs últimas 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [rows, [{ total }], kpiRows] = await Promise.all([
      db()
        .select({
          id: t.id,
          provider: t.provider,
          eventType: t.eventType,
          subscriptionId: t.subscriptionId,
          customerEmail: t.customerEmail,
          status: t.status,
          error: t.error,
          receivedAt: t.receivedAt,
          attempts: t.attempts,
          lastAttemptAt: t.lastAttemptAt,
          nextAttemptAt: t.nextAttemptAt,
          replayedAt: t.replayedAt,
        })
        .from(t)
        .where(where)
        .orderBy(desc(t.receivedAt))
        .limit(perPage)
        .offset((page - 1) * perPage),
      db().select({ total: count() }).from(t).where(where),
      db().select({ status: t.status }).from(t).where(gte(t.receivedAt, since)),
    ]);
    const k = { total: kpiRows.length, ok: 0, failed: 0, pending: 0, dead: 0 };
    for (const r of kpiRows) {
      if (r.status === "failed") k.failed++;
      else if (r.status === "dead_letter") k.dead++;
      else if (r.status === "pending_retry") k.pending++;
      else if (r.status === "processed" || r.status === "replayed") k.ok++;
    }
    return { rows: rows.map(toSnake), total: Number(total), page, perPage, kpi24h: k };
  });

export const getWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const [ev] = await db()
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, data.id))
      .limit(1);
    return {
      event: ev
        ? toSnake({
            ...ev,
            payload: ev.payload as Json,
            attemptHistory: ev.attemptHistory as Json,
          })
        : null,
    };
  });

export const replayWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { id: string; force?: boolean }) =>
    z.object({ id: z.string().uuid(), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const { reprocessWebhookEventRow } = await import("@/lib/payments/webhook-handler.server");
    const { logAudit } = await import("./audit.server");

    // Em "force": destrava lock e zera next_attempt_at para reentrada imediata.
    if (data.force) {
      await db()
        .update(schema.webhookEvents)
        .set({ lockedAt: null, nextAttemptAt: new Date(0).toISOString() })
        .where(eq(schema.webhookEvents.id, data.id));
    }

    const result = await reprocessWebhookEventRow(data.id, {
      manual: true,
      actorId: context.userId,
    });
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: result.ok ? "webhook.replay.ok" : "webhook.replay.fail",
      resource: "webhook_event",
      targetId: data.id,
      metadata: { status: result.status, error: result.error ?? null, forced: !!data.force },
    });
    if (!result.ok)
      throw new Error(result.error ?? `Reprocessamento falhou (status=${result.status}).`);
    return { ok: true, status: result.status };
  });

/**
 * Disparo manual do worker de retry (útil para testar fora do cron).
 */
export const runWebhookRetryNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { limit?: number }) =>
    z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runRetryBatch } = await import("@/lib/payments/webhook-handler.server");
    const { logAudit } = await import("./audit.server");
    const r = await runRetryBatch(data.limit ?? 25);
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "webhook.retry.batch",
      resource: "webhook_event",
      metadata: r,
    });
    return r;
  });
