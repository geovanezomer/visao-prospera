// ============================================================================
// Server fns: webhook_events (consulta e replay).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

export const listWebhookEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = data.page ?? 1;
    const perPage = data.perPage ?? 50;
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    let q = supabaseAdmin
      .from("webhook_events")
      .select(
        "id, provider, event_type, subscription_id, customer_email, status, error, received_at, attempts, last_attempt_at, next_attempt_at, replayed_at",
        { count: "exact" },
      )
      .order("received_at", { ascending: false })
      .range(from, to);
    if (data.provider && data.provider !== "all") q = q.eq("provider", data.provider);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.search) {
      const s = data.search.trim();
      q = q.or(`customer_email.ilike.%${s}%,subscription_id.ilike.%${s}%,event_type.ilike.%${s}%`);
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    // KPIs últimas 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: kpiRows } = await supabaseAdmin
      .from("webhook_events")
      .select("status", { count: "exact", head: false })
      .gte("received_at", since);
    const k = { total: kpiRows?.length ?? 0, ok: 0, failed: 0, pending: 0, dead: 0 };
    for (const r of kpiRows ?? []) {
      if (r.status === "failed") k.failed++;
      else if (r.status === "dead_letter") k.dead++;
      else if (r.status === "pending_retry") k.pending++;
      else if (r.status === "processed" || r.status === "replayed") k.ok++;
    }
    return { rows: rows ?? [], total: count ?? 0, page, perPage, kpi24h: k };
  });

export const getWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ev, error } = await supabaseAdmin
      .from("webhook_events")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { event: ev };
  });

export const replayWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; force?: boolean }) =>
    z.object({ id: z.string().uuid(), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reprocessWebhookEventRow } = await import("@/lib/payments/webhook-handler.server");
    const { logAudit } = await import("./audit.server");

    // Em "force": destrava lock e zera next_attempt_at para reentrada imediata.
    if (data.force) {
      await supabaseAdmin
        .from("webhook_events")
        .update({ locked_at: null, next_attempt_at: new Date(0).toISOString() })
        .eq("id", data.id);
    }

    const result = await reprocessWebhookEventRow(data.id, {
      manual: true,
      actorId: context.userId,
    });
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
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
  .middleware([requireSupabaseAuth])
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
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "webhook.retry.batch",
      resource: "webhook_event",
      metadata: r,
    });
    return r;
  });
