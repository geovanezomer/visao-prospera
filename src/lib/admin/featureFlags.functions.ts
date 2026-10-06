// ============================================================================
// Feature Flags — leitura pública (authenticated) + escrita admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("feature_flags").select("*").order("key");
    if (error) throw new Error(error.message);
    return { flags: (data ?? []) as FeatureFlag[] };
  });

// ----------------------------------------------------------------------------
// upsertFeatureFlag (admin).
// ----------------------------------------------------------------------------
export const upsertFeatureFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("feature_flags").upsert(
      {
        key: data.key,
        description: data.description ?? null,
        enabled: data.enabled,
        rollout_percent: data.rollout_percent ?? 0,
        allowed_emails: data.allowed_emails ?? [],
        allowed_plans: data.allowed_plans ?? [],
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
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
  .middleware([requireSupabaseAuth])
  .validator((d: { key: string }) => z.object({ key: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("feature_flags").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "feature_flag.delete",
      resource: "feature_flag",
      targetId: data.key,
    });
    return { ok: true };
  });
