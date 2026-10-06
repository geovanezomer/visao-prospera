// ============================================================================
// Server fns: leitura do admin_audit_log (apenas admin).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { page?: number; perPage?: number; search?: string; action?: string; resource?: string }) =>
      z
        .object({
          page: z.number().int().min(1).max(10000).optional(),
          perPage: z.number().int().min(1).max(200).optional(),
          search: z.string().max(120).optional(),
          action: z.string().max(80).optional(),
          resource: z.string().max(80).optional(),
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
      .from("admin_audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.action) q = q.eq("action", data.action);
    if (data.resource) q = q.eq("resource", data.resource);
    if (data.search) {
      const s = data.search.trim();
      q = q.or(`actor_email.ilike.%${s}%,target_id.ilike.%${s}%,target_label.ilike.%${s}%`);
    }
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page, perPage };
  });
