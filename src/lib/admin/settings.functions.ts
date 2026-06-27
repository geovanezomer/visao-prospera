// ============================================================================
// Server fns: app_settings (branding, login_texts, footer, active_provider)
// Leitura é pública (anon); escrita exige admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";
import type { AuthClaims } from "./_types";
import type { Json } from "@/integrations/supabase/types";

function assertAdmin(claims: AuthClaims | undefined | null) {
  if (!isAdminEmail((claims?.email as string) ?? "")) {
    throw new Error("Acesso negado: apenas administrador.");
  }
}

const KEYS = ["branding", "login_texts", "footer", "active_provider", "tracking", "legal", "landing_video"] as const;
export type SettingKey = (typeof KEYS)[number];

/** Leitura pública — só chaves seguras para anon (branding/login/footer/tracking/legal/landing_video). */
const PUBLIC_KEYS = ["branding", "login_texts", "footer", "tracking", "legal", "landing_video"] as const;

export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb
    .from("app_settings")
    .select("key, value")
    .in("key", PUBLIC_KEYS as unknown as string[]);
  const out: Partial<Record<SettingKey, Json>> = {};
  for (const row of data ?? []) out[row.key as SettingKey] = row.value as Json;
  return out;
});

export const updateAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { key: SettingKey; value: unknown }) =>
    z.object({ key: z.enum(KEYS), value: z.any() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      { key: data.key, value: data.value, updated_by: context.userId, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
