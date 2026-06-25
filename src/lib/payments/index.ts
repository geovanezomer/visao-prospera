// ============================================================================
// Seletor do provedor de pagamentos.
//
// Resolução em camadas:
//   1) Tenta ler app_settings.active_provider + provider_credentials no banco
//      (configurado via Painel Admin > Provider). [Async; cache 60s]
//   2) Fallback: PAYMENT_PROVIDER do .env / detecção por env keys.
//
// As funções síncronas (`getProvider`) mantêm compatibilidade usando o env;
// código novo deve preferir `resolveProvider()` (async).
// ============================================================================

import type { PaymentProvider, ProviderName } from "./types";

let _cached: { name: ProviderName; instance: PaymentProvider; until: number } | null = null;
const TTL_MS = 60_000;

async function resolveFromDb(): Promise<{ provider: ProviderName; apiKey?: string; webhookSecret?: string; mode?: string } | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: active } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "active_provider")
      .maybeSingle();
    const chosen = (active?.value as any)?.provider as ProviderName | undefined;
    if (!chosen) return null;
    const { data: cred } = await sb
      .from("provider_credentials")
      .select("api_key, webhook_secret, mode")
      .eq("provider", chosen)
      .maybeSingle();
    if (!cred?.api_key) return null;
    return { provider: chosen, apiKey: cred.api_key, webhookSecret: cred.webhook_secret ?? undefined, mode: cred.mode ?? "test" };
  } catch {
    return null;
  }
}

async function instantiate(name: ProviderName): Promise<PaymentProvider> {
  // Dynamic import — funciona em Worker/Edge runtime (CJS require não é suportado).
  if (name === "stripe") {
    const mod = await import("./stripe");
    return new mod.StripeProvider();
  }
  const mod = await import("./asaas");
  return new mod.AsaasProvider();
}

/**
 * Hidrata `process.env` com credenciais salvas no banco para um provider
 * específico. Usado por webhooks e por operações administrativas (refund)
 * antes de qualquer chamada que dependa de `process.env.STRIPE_SECRET_KEY`
 * / `ASAAS_API_KEY`. Idempotente.
 */
export async function hydrateProviderEnv(provider: ProviderName): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: cred } = await sb
      .from("provider_credentials")
      .select("api_key, webhook_secret, mode")
      .eq("provider", provider)
      .maybeSingle();
    if (!cred?.api_key) return false;
    if (provider === "stripe") {
      process.env.STRIPE_SECRET_KEY = cred.api_key;
      if (cred.webhook_secret) process.env.STRIPE_WEBHOOK_SECRET = cred.webhook_secret;
    } else {
      process.env.ASAAS_API_KEY = cred.api_key;
      if (cred.webhook_secret) process.env.ASAAS_WEBHOOK_TOKEN = cred.webhook_secret;
      if (cred.mode) process.env.ASAAS_ENV = cred.mode === "live" ? "production" : "sandbox";
    }
    return true;
  } catch {
    return false;
  }
}

/** Resolve provider preferindo o banco; fallback para .env. Async. */
export async function resolveProvider(): Promise<PaymentProvider> {
  if (_cached && _cached.until > Date.now()) return _cached.instance;
  const fromDb = await resolveFromDb();
  if (fromDb) {
    await hydrateProviderEnv(fromDb.provider);
    const instance = await instantiate(fromDb.provider);
    _cached = { name: fromDb.provider, instance, until: Date.now() + TTL_MS };
    return instance;
  }
  return getProviderSync();
}

/** Versão síncrona (legacy): lê apenas do env. */
export function getProvider(): PaymentProvider {
  if (_cached && _cached.until > Date.now()) return _cached.instance;
  const explicit = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  const hasStripe = !!process.env.STRIPE_SECRET_KEY;
  const hasAsaas = !!process.env.ASAAS_API_KEY;
  let choice: ProviderName | null = null;
  if (explicit === "stripe" || explicit === "asaas") choice = explicit as ProviderName;
  else if (hasStripe) choice = "stripe";
  else if (hasAsaas) choice = "asaas";
  if (!choice) {
    throw new Error(
      "Nenhum provedor de pagamento configurado. Configure no Painel Admin > Provider ou defina PAYMENT_PROVIDER/chaves no .env.",
    );
  }
  const instance = instantiate(choice);
  _cached = { name: choice, instance, until: Date.now() + TTL_MS };
  return instance;
}

/** Invalida cache (chamar após mudança no Admin). */
export function invalidateProviderCache(): void {
  _cached = null;
}

export function getProviderPlanRef(plan: "starter" | "pro"): string {
  const provider = getProvider().name;
  const key =
    provider === "stripe"
      ? plan === "starter"
        ? "STRIPE_PRICE_STARTER"
        : "STRIPE_PRICE_PRO"
      : plan === "starter"
        ? "ASAAS_PLAN_STARTER"
        : "ASAAS_PLAN_PRO";
  const value = process.env[key];
  if (!value) throw new Error(`Variável ${key} não configurada no .env`);
  return value;
}

export type { PaymentProvider, NormalizedEvent, PlanId, ProviderName } from "./types";
