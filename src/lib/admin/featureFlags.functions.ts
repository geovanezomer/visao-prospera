// ============================================================================
// Feature Flags — leitura pública (authenticated) + escrita admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { asc, eq } from "drizzle-orm";
import { actorEmail } from "./_types";

export type FeatureFlag = {
  key: string;
  description: string | null;
  enabled: boolean;
  rollout_percent: number;
  allowed_emails: string[];
  allowed_plans: string[];
  updated_at: string;
};

// ----------------------------------------------------------------------------
// listFeatureFlags (admin) — todas as flags.
// ----------------------------------------------------------------------------
export const listFeatureFlags = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const rows = await db()
      .select()
      .from(schema.featureFlags)
      .orderBy(asc(schema.featureFlags.key));
    const flags: FeatureFlag[] = rows.map((r) => ({
      key: r.key,
      description: r.description,
      enabled: r.enabled,
      rollout_percent: r.rolloutPercent,
      allowed_emails: r.allowedEmails,
      allowed_plans: r.allowedPlans,
      updated_at: r.updatedAt,
    }));
    return { flags };
  });

// ----------------------------------------------------------------------------
// upsertFeatureFlag (admin).
// ----------------------------------------------------------------------------
export const upsertFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (d: {
      key: string;
      description?: string;
      enabled: boolean;
      rollout_percent?: number;
      allowed_emails?: string[];
      allowed_plans?: string[];
    }) =>
      z
        .object({
          key: z
            .string()
            .min(2)
            .max(80)
            .regex(/^[a-z0-9_.-]+$/, "kebab/snake-case"),
          description: z.string().max(280).optional(),
          enabled: z.boolean(),
          rollout_percent: z.number().int().min(0).max(100).optional(),
          allowed_emails: z.array(z.string().email()).max(500).optional(),
          allowed_plans: z.array(z.string()).max(20).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const row = {
      description: data.description ?? null,
      enabled: data.enabled,
      rolloutPercent: data.rollout_percent ?? 0,
      allowedEmails: data.allowed_emails ?? [],
      allowedPlans: data.allowed_plans ?? [],
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
    };
    await db()
      .insert(schema.featureFlags)
      .values({ key: data.key, ...row })
      .onConflictDoUpdate({ target: schema.featureFlags.key, set: row });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "feature_flag.upsert",
      resource: "feature_flag",
      targetId: data.key,
      metadata: { enabled: data.enabled, rollout: data.rollout_percent ?? 0 },
    });
    return { ok: true };
  });

// ----------------------------------------------------------------------------
// deleteFeatureFlag (admin).
// ----------------------------------------------------------------------------
export const deleteFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    await db().delete(schema.featureFlags).where(eq(schema.featureFlags.key, data.key));
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "feature_flag.delete",
      resource: "feature_flag",
      targetId: data.key,
    });
    return { ok: true };
  });
