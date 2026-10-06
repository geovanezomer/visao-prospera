// ============================================================================
// Admin · Plans CRUD — configuração de planos via UI.
// Leitura pública (plans ativos) sem login; escrita exige admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { asc, eq } from "drizzle-orm";
import { actorEmail, type Json } from "./_types";

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

/** Linha da tabela `plans` como o Drizzle devolve (camelCase). */
type DbPlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  features: unknown;
  limits: unknown;
  stripePriceId: string | null;
  asaasPlanRef: string | null;
  active: boolean;
  sortOrder: number;
  upsellEnabled: boolean | null;
  upsellName: string | null;
  upsellDescription: string | null;
  upsellPriceCents: number | null;
  upsellStripePriceId: string | null;
  upsellAsaasRef: string | null;
};

function rowToPlan(r: DbPlanRow): PlanRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    priceCents: r.priceCents,
    currency: r.currency,
    interval: r.interval,
    features: Array.isArray(r.features) ? (r.features as string[]) : [],
    limits: (r.limits ?? {}) as Json,
    stripePriceId: r.stripePriceId,
    asaasPlanRef: r.asaasPlanRef,
    active: r.active,
    sortOrder: r.sortOrder,
    upsellEnabled: !!r.upsellEnabled,
    upsellName: r.upsellName ?? null,
    upsellDescription: r.upsellDescription ?? null,
    upsellPriceCents: r.upsellPriceCents ?? 0,
    upsellStripePriceId: r.upsellStripePriceId ?? null,
    upsellAsaasRef: r.upsellAsaasRef ?? null,
  };
}

// Listagem admin (todos, ativos e inativos).
export const listPlansAdmin = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const rows = await db().select().from(schema.plans).orderBy(asc(schema.plans.sortOrder));
    return { plans: rows.map(rowToPlan) };
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
    const { db, schema } = await import("@/db/client.server");
    const rows = await db()
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.active, true))
      .orderBy(asc(schema.plans.sortOrder));
    const out = { plans: rows.map(rowToPlan) };
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
  limits: z.record(z.string(), z.any()).default({}),
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
  .middleware([requireAuth])
  .validator((data: z.infer<typeof planSchema>) => planSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const payload = {
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      priceCents: data.priceCents,
      currency: data.currency,
      interval: data.interval,
      features: data.features,
      limits: data.limits,
      stripePriceId: data.stripePriceId ?? null,
      asaasPlanRef: data.asaasPlanRef ?? null,
      active: data.active,
      sortOrder: data.sortOrder,
      upsellEnabled: data.upsellEnabled ?? false,
      upsellName: data.upsellName ?? null,
      upsellDescription: data.upsellDescription ?? null,
      upsellPriceCents: data.upsellPriceCents ?? 0,
      upsellStripePriceId: data.upsellStripePriceId ?? null,
      upsellAsaasRef: data.upsellAsaasRef ?? null,
    };
    const [row] = data.id
      ? await db()
          .update(schema.plans)
          .set({ ...payload, updatedAt: new Date().toISOString() })
          .where(eq(schema.plans.id, data.id))
          .returning()
      : await db().insert(schema.plans).values(payload).returning();
    invalidatePublicPlansCache();
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: data.id ? "plan.update" : "plan.create",
      resource: "plan",
      targetId: row?.id ?? null,
      targetLabel: data.slug,
      metadata: { priceCents: data.priceCents, active: data.active },
    });
    return { plan: row ? rowToPlan(row) : null };
  });

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const [existing] = await db()
      .delete(schema.plans)
      .where(eq(schema.plans.id, data.id))
      .returning({ slug: schema.plans.slug });
    invalidatePublicPlansCache();
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "plan.delete",
      resource: "plan",
      targetId: data.id,
      targetLabel: existing?.slug ?? null,
    });
    return { ok: true };
  });
