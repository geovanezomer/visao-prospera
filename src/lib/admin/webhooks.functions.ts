// ============================================================================
// Server fns: webhook_events (consulta e replay).
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

export const listWebhookEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      page?: number;
      perPage?: number;
      search?: string;
      provider?: "all" | "stripe" | "asaas" | "admin";
      status?: "all" | "processed" | "failed" | "skipped" | "replayed";
    }) =>
      z
        .object({
          page: z.number().int().min(1).max(10000).optional(),
          perPage: z.number().int().min(1).max(200).optional(),
          search: z.string().max(120).optional(),
          provider: z.enum(["all", "stripe", "asaas", "admin"]).optional(),
          status: z.enum(["all", "processed", "failed", "skipped", "replayed"]).optional(),
        })
        .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = data.page ?? 1;
    const perPage = data.perPage ?? 50;
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    let q = supabaseAdmin
      .from("webhook_events")
      .select("id, provider, event_type, subscription_id, customer_email, status, error, received_at", {
        count: "exact",
      })
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
    const k = { total: kpiRows?.length ?? 0, ok: 0, failed: 0 };
    for (const r of kpiRows ?? []) {
      if (r.status === "failed") k.failed++;
      else if (r.status === "processed" || r.status === "replayed") k.ok++;
    }
    return { rows: rows ?? [], total: count ?? 0, page, perPage, kpi24h: k };
  });

export const getWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
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
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ev, error } = await supabaseAdmin
      .from("webhook_events")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !ev) throw new Error("Evento não encontrado.");
    // Reexecuta o handler com o payload normalizado salvo.
    const { handleNormalizedEvent } = await import("@/lib/payments/webhook-handler.server");
    try {
      await handleNormalizedEvent(ev.provider as any, ev.payload as any);
      await supabaseAdmin
        .from("webhook_events")
        .update({ status: "replayed", error: null })
        .eq("id", ev.id);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro";
      await supabaseAdmin.from("webhook_events").update({ status: "failed", error: msg }).eq("id", ev.id);
      throw new Error(msg);
    }
  });
