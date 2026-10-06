// ============================================================================
// Server fns: app_settings (branding, login_texts, footer, active_provider)
// Leitura é pública (anon); escrita exige admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";
import type { Json } from "@/integrations/supabase/types";

const KEYS = [
  "branding",
  "login_texts",
  "footer",
  "active_provider",
  "tracking",
  "legal",
  "landing_video",
  "trial",
] as const;
export type SettingKey = (typeof KEYS)[number];

/** Leitura pública — só chaves seguras para anon. `trial` é público para a landing saber se exibe o CTA. */
const PUBLIC_KEYS = [
  "branding",
  "login_texts",
  "footer",
  "tracking",
  "legal",
  "landing_video",
  "trial",
] as const;

// Cache em memória do worker (TTL 60s) — reduz drasticamente as queries ao
// banco em SSR de alto volume (Black Friday). Mudanças do admin propagam em
// até 60s sem invalidação explícita. Dedupe de in-flight evita thundering
// herd em picos concorrentes.
const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; data: Partial<Record<SettingKey, Json>> } | null = null;
let settingsInFlight: Promise<Partial<Record<SettingKey, Json>>> | null = null;

export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.data;
  }
  if (settingsInFlight) return settingsInFlight;
  settingsInFlight = (async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
    const key =
      process.env.SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const sb = createClient(url!, key!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb
      .from("app_settings")
      .select("key, value")
      .in("key", PUBLIC_KEYS as unknown as string[]);
    const out: Partial<Record<SettingKey, Json>> = {};
    for (const row of data ?? []) out[row.key as SettingKey] = row.value as Json;
    settingsCache = { at: Date.now(), data: out };
    return out;
  })().finally(() => {
    settingsInFlight = null;
  });
  return settingsInFlight;
});

export const updateAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { key: SettingKey; value: unknown }) =>
    z.object({ key: z.enum(KEYS), value: z.any() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        {
          key: data.key,
          value: data.value,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    // Invalida cache em memória para refletir mudança imediatamente.
    settingsCache = null;
    return { ok: true };
  });
