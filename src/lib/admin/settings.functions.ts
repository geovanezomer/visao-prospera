// ============================================================================
// Server fns: app_settings (branding, login_texts, footer, active_provider)
// Leitura é pública (só PUBLIC_KEYS); escrita exige admin.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { inArray } from "drizzle-orm";
import type { Json } from "./_types";

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

/** Formato do JSON gravado em app_settings.branding. */
export type BrandingSetting = {
  favicon_url?: string;
  colors?: { primary?: string; accent?: string };
};

/** Formato do JSON gravado em app_settings.tracking. */
export type TrackingSetting = { head?: string; body_start?: string; body_end?: string };

export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.data;
  }
  if (settingsInFlight) return settingsInFlight;
  settingsInFlight = (async () => {
    const { db, schema } = await import("@/db/client.server");
    const rows = await db()
      .select({ key: schema.appSettings.key, value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(inArray(schema.appSettings.key, [...PUBLIC_KEYS]));
    const out: Partial<Record<SettingKey, Json>> = {};
    for (const row of rows) out[row.key as SettingKey] = row.value as Json;
    settingsCache = { at: Date.now(), data: out };
    return out;
  })().finally(() => {
    settingsInFlight = null;
  });
  return settingsInFlight;
});

export const updateAppSetting = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { key: SettingKey; value: unknown }) =>
    z.object({ key: z.enum(KEYS), value: z.any() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const row = {
      value: (data.value ?? {}) as Json,
      updatedBy: context.userId,
      updatedAt: new Date().toISOString(),
    };
    await db()
      .insert(schema.appSettings)
      .values({ key: data.key, ...row })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: row });
    // Invalida cache em memória para refletir mudança imediatamente.
    settingsCache = null;
    return { ok: true };
  });
