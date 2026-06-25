// ============================================================================
// Server fns: provider_credentials (Stripe / Asaas).
// Apenas admin. Apenas 1 ativo por vez (constraint do banco).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";

function assertAdmin(claims: any) {
  if (!isAdminEmail((claims?.email as string) ?? "")) {
    throw new Error("Acesso negado: apenas administrador.");
  }
}

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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("provider_credentials").select("*");
    if (error) throw new Error(error.message);
    const rows: ProviderRow[] = (data ?? []).map((r: any) => ({
      id: r.id,
      provider: r.provider,
      mode: r.mode,
      apiKeyMasked: mask(r.api_key),
      webhookSecretMasked: mask(r.webhook_secret),
      hasApiKey: !!r.api_key,
      hasWebhookSecret: !!r.webhook_secret,
      isActive: r.is_active,
      updatedAt: r.updated_at,
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
  .middleware([requireSupabaseAuth])
  .inputValidator(
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
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Upsert preservando campos não enviados (não sobrescreve secret com null).
    const patch: any = {
      provider: data.provider,
      mode: data.mode,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (data.apiKey) patch.api_key = data.apiKey;
    if (data.webhookSecret) patch.webhook_secret = data.webhookSecret;
    const { error } = await supabaseAdmin
      .from("provider_credentials")
      .upsert(patch, { onConflict: "provider" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setActiveProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: "stripe" | "asaas" }) =>
    z.object({ provider: z.enum(["stripe", "asaas"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Desativa todos e ativa o escolhido (transação implícita não é crítica aqui).
    await supabaseAdmin.from("provider_credentials").update({ is_active: false }).neq("provider", "");
    const { error } = await supabaseAdmin
      .from("provider_credentials")
      .update({ is_active: true, updated_at: new Date().toISOString(), updated_by: context.userId })
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    // Espelha em app_settings.active_provider (para resolução rápida sem service-role).
    await supabaseAdmin
      .from("app_settings")
      .upsert(
        { key: "active_provider", value: { provider: data.provider }, updated_by: context.userId, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    // Invalida cache do seletor de provider (evita janela de 60s servindo o antigo).
    const { invalidateProviderCache } = await import("@/lib/payments");
    invalidateProviderCache();
    return { ok: true };
  });

export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: "stripe" | "asaas" }) =>
    z.object({ provider: z.enum(["stripe", "asaas"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cred } = await supabaseAdmin
      .from("provider_credentials")
      .select("api_key, mode")
      .eq("provider", data.provider)
      .maybeSingle();
    if (!cred?.api_key) throw new Error("API Key não configurada.");
    try {
      if (data.provider === "stripe") {
        const r = await fetch("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${cred.api_key}` },
        });
        if (!r.ok) throw new Error(`Stripe ${r.status}`);
      } else {
        const base = cred.mode === "live" ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/api/v3";
        const r = await fetch(`${base}/myAccount`, { headers: { access_token: cred.api_key } });
        if (!r.ok) throw new Error(`Asaas ${r.status}`);
      }
      return { ok: true, message: "Conexão OK." };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Falha na conexão.");
    }
  });
