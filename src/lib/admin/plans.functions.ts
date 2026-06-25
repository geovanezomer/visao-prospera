// ============================================================================
// Admin · Plans CRUD — configuração de planos via UI.
// Leitura pública (plans ativos) é livre via RLS; escrita exige admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";

function assertAdmin(claims: any) {
  if (!isAdminEmail((claims?.email as string) ?? "")) throw new Error("Acesso negado.");
}

export type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  features: string[];
  limits: Record<string, any>;
  stripePriceId: string | null;
  asaasPlanRef: string | null;
  active: boolean;
  sortOrder: number;
  upsellEnabled: boolean;
  upsellName: string | null;
  upsellDescription: string | null;
  upsellPriceCents: number;
  upsellStripePriceId: string | null;
  upsellAsaasRef: string | null;
};

function rowToPlan(r: any): PlanRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    priceCents: r.price_cents,
    currency: r.currency,
    interval: r.interval,
    features: Array.isArray(r.features) ? r.features : [],
    limits: (r.limits as Record<string, any>) ?? {},
    stripePriceId: r.stripe_price_id,
    asaasPlanRef: r.asaas_plan_ref,
    active: r.active,
    sortOrder: r.sort_order,
    upsellEnabled: !!r.upsell_enabled,
    upsellName: r.upsell_name ?? null,
    upsellDescription: r.upsell_description ?? null,
    upsellPriceCents: r.upsell_price_cents ?? 0,
    upsellStripePriceId: r.upsell_stripe_price_id ?? null,
    upsellAsaasRef: r.upsell_asaas_ref ?? null,
  };
}


// Listagem admin (todos, ativos e inativos).
export const listPlansAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("plans")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { plans: (data ?? []).map(rowToPlan) };
  });

// Listagem pública (apenas ativos) — usado pela landing/pricing.
export const listPlansPublic = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb
    .from("plans")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return { plans: (data ?? []).map(rowToPlan) };
});

const planSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  priceCents: z.number().int().min(0),
  currency: z.string().min(3).max(3),
  interval: z.enum(["month", "year", "week", "day", "lifetime", "one_time"]),
  features: z.array(z.string().max(200)).max(40),
  limits: z.record(z.any()).default({}),
  stripePriceId: z.string().nullable().optional(),
  asaasPlanRef: z.string().nullable().optional(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  upsellEnabled: z.boolean().optional().default(false),
  upsellName: z.string().max(120).nullable().optional(),
  upsellDescription: z.string().max(500).nullable().optional(),
  upsellPriceCents: z.number().int().min(0).optional().default(0),
  upsellStripePriceId: z.string().nullable().optional(),
  upsellAsaasRef: z.string().nullable().optional(),
});

export const upsertPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof planSchema>) => planSchema.parse(data))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      price_cents: data.priceCents,
      currency: data.currency,
      interval: data.interval,
      features: data.features,
      limits: data.limits as any,
      stripe_price_id: data.stripePriceId ?? null,
      asaas_plan_ref: data.asaasPlanRef ?? null,
      active: data.active,
      sort_order: data.sortOrder,
      upsell_enabled: data.upsellEnabled ?? false,
      upsell_name: data.upsellName ?? null,
      upsell_description: data.upsellDescription ?? null,
      upsell_price_cents: data.upsellPriceCents ?? 0,
      upsell_stripe_price_id: data.upsellStripePriceId ?? null,
      upsell_asaas_ref: data.upsellAsaasRef ?? null,
    };
    const q = data.id
      ? supabaseAdmin.from("plans").update(payload).eq("id", data.id).select().maybeSingle()
      : supabaseAdmin.from("plans").insert(payload).select().maybeSingle();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as any)?.email,
      action: data.id ? "plan.update" : "plan.create",
      resource: "plan",
      targetId: row?.id ?? null,
      targetLabel: data.slug,
      metadata: { priceCents: data.priceCents, active: data.active },
    });
    return { plan: row ? rowToPlan(row) : null };
  });

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.from("plans").select("slug").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as any)?.email,
      action: "plan.delete",
      resource: "plan",
      targetId: data.id,
      targetLabel: existing?.slug ?? null,
    });
    return { ok: true };
  });
