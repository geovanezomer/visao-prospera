// ============================================================================
// Server fns: provider_credentials (Stripe / Asaas).
// Apenas admin. Apenas 1 ativo por vez (constraint do banco).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { eq, ne } from "drizzle-orm";

function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export type ProviderRow = {
  id: string;
  provider: "stripe" | "asaas";
  mode: "test" | "live";
  apiKeyMasked: string | null;
  webhookSecretMasked: string | null;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  isActive: boolean;
  updatedAt: string;
};

export const listProviders = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const data = await db().select().from(schema.providerCredentials);
    const rows: ProviderRow[] = data.map((r) => ({
      id: r.id,
      provider: r.provider as ProviderRow["provider"],
      mode: r.mode as ProviderRow["mode"],
      apiKeyMasked: mask(r.apiKey),
      webhookSecretMasked: mask(r.webhookSecret),
      hasApiKey: !!r.apiKey,
      hasWebhookSecret: !!r.webhookSecret,
      isActive: r.isActive,
      updatedAt: r.updatedAt,
    }));
    // Garante slots para ambos (mesmo sem registro ainda)
    for (const p of ["stripe", "asaas"] as const) {
      if (!rows.find((x) => x.provider === p)) {
        rows.push({
          id: "",
          provider: p,
          mode: "test",
          apiKeyMasked: null,
          webhookSecretMasked: null,
          hasApiKey: false,
          hasWebhookSecret: false,
          isActive: false,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return { rows };
  });

export const upsertProvider = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (data: {
      provider: "stripe" | "asaas";
      mode: "test" | "live";
      apiKey?: string;
      webhookSecret?: string;
    }) =>
      z
        .object({
          provider: z.enum(["stripe", "asaas"]),
          mode: z.enum(["test", "live"]),
          apiKey: z.string().min(8).optional(),
          webhookSecret: z.string().min(8).optional(),
        })
        .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    // Upsert preservando campos não enviados (não sobrescreve secret com null).
    const patch: Partial<typeof schema.providerCredentials.$inferInsert> = {
      mode: data.mode,
      updatedBy: context.userId,
      updatedAt: new Date().toISOString(),
    };
    if (data.apiKey) patch.apiKey = data.apiKey;
    if (data.webhookSecret) patch.webhookSecret = data.webhookSecret;
    await db()
      .insert(schema.providerCredentials)
      .values({ provider: data.provider, ...patch })
      .onConflictDoUpdate({ target: schema.providerCredentials.provider, set: patch });
    return { ok: true };
  });

export const setActiveProvider = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { provider: "stripe" | "asaas" }) =>
    z.object({ provider: z.enum(["stripe", "asaas"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const now = new Date().toISOString();
    await db().transaction(async (tx) => {
      const pc = schema.providerCredentials;
      // Desativa os outros e ativa o escolhido (índice único: só 1 ativo).
      await tx.update(pc).set({ isActive: false }).where(ne(pc.provider, data.provider));
      await tx
        .update(pc)
        .set({ isActive: true, updatedAt: now, updatedBy: context.userId })
        .where(eq(pc.provider, data.provider));
      // Espelha em app_settings.active_provider (resolução rápida).
      const setting = {
        value: { provider: data.provider },
        updatedBy: context.userId,
        updatedAt: now,
      };
      await tx
        .insert(schema.appSettings)
        .values({ key: "active_provider", ...setting })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: setting });
    });
    // Invalida cache do seletor de provider (evita janela de 60s servindo o antigo).
    const { invalidateProviderCache } = await import("@/lib/payments");
    invalidateProviderCache();
    return { ok: true };
  });

export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: { provider: "stripe" | "asaas" }) =>
    z.object({ provider: z.enum(["stripe", "asaas"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const pc = schema.providerCredentials;
    const [cred] = await db()
      .select({ apiKey: pc.apiKey, mode: pc.mode })
      .from(pc)
      .where(eq(pc.provider, data.provider))
      .limit(1);
    if (!cred?.apiKey) return { ok: false, message: "API Key não configurada." };

    const key = cred.apiKey.trim();

    // Validação de prefixo: bloqueia teste cruzado entre provedores.
    // Stripe Secret Key: sk_test_ / sk_live_  |  Asaas: $aact_ (ou access token alfanumérico).
    if (data.provider === "stripe") {
      if (key.startsWith("$aact_")) {
        return {
          ok: false,
          message:
            "Esta chave parece ser do Asaas ($aact_...). Cole a Secret Key do Stripe (sk_test_... ou sk_live_...) no slot do Stripe.",
        };
      }
      if (key.startsWith("whsec_")) {
        return {
          ok: false,
          message:
            "Isto é um Webhook Secret do Stripe (whsec_...), não a Secret Key. Use sk_test_... ou sk_live_...",
        };
      }
      if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_") && !key.startsWith("rk_")) {
        return {
          ok: false,
          message: "Formato de chave Stripe inválido. Esperado sk_test_... ou sk_live_...",
        };
      }
    } else {
      // Asaas
      if (
        key.startsWith("sk_test_") ||
        key.startsWith("sk_live_") ||
        key.startsWith("whsec_") ||
        key.startsWith("rk_")
      ) {
        return {
          ok: false,
          message:
            "Esta chave parece ser do Stripe. Cole o access_token do Asaas ($aact_...) no slot do Asaas.",
        };
      }
      if (!key.startsWith("$aact_") && key.length < 40) {
        return {
          ok: false,
          message: "Formato de access_token do Asaas inválido. Esperado começar com $aact_...",
        };
      }
    }

    try {
      if (data.provider === "stripe") {
        const r = await fetch("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!r.ok) {
          const msg =
            r.status === 401
              ? "Stripe 401: chave inválida ou sem permissão. Verifique a Secret Key (sk_...) e o modo (test/live)."
              : `Stripe ${r.status}: falha ao validar credenciais.`;
          return { ok: false, message: msg };
        }
      } else {
        const base =
          cred.mode === "live" ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/api/v3";
        const r = await fetch(`${base}/myAccount`, { headers: { access_token: key } });
        if (!r.ok) {
          const msg =
            r.status === 401
              ? "Asaas 401: access_token inválido. Verifique a chave e o ambiente (sandbox/live)."
              : `Asaas ${r.status}: falha ao validar credenciais.`;
          return { ok: false, message: msg };
        }
      }
      return { ok: true, message: "Conexão OK." };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Falha na conexão." };
    }
  });
