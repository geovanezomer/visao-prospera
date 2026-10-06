// ============================================================================
// Admin · Plans CRUD — configuração de planos via UI.
// Leitura pública (plans ativos) é livre via RLS; escrita exige admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";
import type { Json } from "@/integrations/supabase/types";

export type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  features: string[];
  limits: Json;
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

/**
 * Shape mínimo de uma linha da tabela `plans` (subset consumido aqui).
 * Não usamos `Tables<'plans'>` direto para evitar ressentir cada coluna
 * nova do schema — só os campos que efetivamente lemos.
 */
type DbPlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  features: unknown;
  limits: unknown;
  stripe_price_id: string | null;
  asaas_plan_ref: string | null;
  active: boolean;
  sort_order: number;
  upsell_enabled: boolean | null;
  upsell_name: string | null;
  upsell_description: string | null;
  upsell_price_cents: number | null;
  upsell_stripe_price_id: string | null;
  upsell_asaas_ref: string | null;
};

function rowToPlan(r: DbPlanRow): PlanRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    priceCents: r.price_cents,
    currency: r.currency,
    interval: r.interval,
    features: Array.isArray(r.features) ? (r.features as string[]) : [],
    limits: (r.limits ?? {}) as Json,
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
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("plans")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { plans: (data ?? []).map(rowToPlan) };
  });

// Listagem pública (apenas ativos) — usado pela landing/pricing.
// Cache em memória (TTL 5 min): catálogo muda raramente, mas a landing
// é o endpoint mais visitado em campanhas pagas.
const PLANS_TTL_MS = 5 * 60_000;
let plansCache: { at: number; data: { plans: PlanRow[] } } | null = null;
let plansInFlight: Promise<{ plans: PlanRow[] }> | null = null;

export const listPlansPublic = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (plansCache && now - plansCache.at < PLANS_TTL_MS) return plansCache.data;
  if (plansInFlight) return plansInFlight;
  plansInFlight = (async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
    const key =
      process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const sb = createClient(url!, key!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb
      .from("plans")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const out = { plans: (data ?? []).map(rowToPlan) };
    plansCache = { at: Date.now(), data: out };
    return out;
  })().finally(() => {
    plansInFlight = null;
  });
  return plansInFlight;
});

// Invalida cache de planos públicos — chamado após upsert/delete admin.
export function invalidatePublicPlansCache() {
  plansCache = null;
}

export const PLAN_INTERVALS = ["month", "year", "week", "day", "lifetime", "one_time"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

const planSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  priceCents: z.number().int().min(0),
  currency: z.string().min(3).max(3),
  interval: z.enum(PLAN_INTERVALS),
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
  .validator((data: z.infer<typeof planSchema>) => planSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      price_cents: data.priceCents,
      currency: data.currency,
      interval: data.interval,
      features: data.features,
      // `limits` é jsonb no banco — Json é compatível mas o tipo gerado
      // do PostgREST exige cast explícito para `Json`.
      limits: data.limits as Json,
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
    invalidatePublicPlansCache();
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
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
  .validator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("plans")
      .select("slug")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidatePublicPlansCache();
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "plan.delete",
      resource: "plan",
      targetId: data.id,
      targetLabel: existing?.slug ?? null,
    });
    return { ok: true };
  });
