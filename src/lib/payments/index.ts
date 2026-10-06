// ============================================================================
// Seletor do provedor de pagamentos.
//
// Resolução em camadas:
//   1) Tenta ler app_settings.active_provider + provider_credentials no banco
//      (configurado via Painel Admin > Provider). [Async; cache 60s]
//   2) Fallback: PAYMENT_PROVIDER do .env / detecção por env keys.
//
// IMPORTANTE: este módulo NÃO muta `process.env`. Credenciais carregadas
// do banco são passadas por construtor (ProviderConfig) — cada instância
// fica isolada, evitando vazamento entre requisições concorrentes em edge.
// ============================================================================

import type { PaymentProvider, ProviderConfig, ProviderName } from "./types";

let _cached: { name: ProviderName; instance: PaymentProvider; until: number } | null = null;
let _activeName: ProviderName | null = null;
const TTL_MS = 60_000;

async function resolveFromDb(): Promise<{ provider: ProviderName } | null> {
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
    const chosen = (active?.value as { provider?: ProviderName } | null)?.provider;
    if (!chosen) return null;
    return { provider: chosen };
  } catch {
    return null;
  }
}

async function instantiate(name: ProviderName, config?: ProviderConfig): Promise<PaymentProvider> {
  if (name === "stripe") {
    const mod = await import("./stripe");
    return new mod.StripeProvider(config);
  }
  const mod = await import("./asaas");
  return new mod.AsaasProvider(config);
}

function pickFromEnv(): ProviderName | null {
  const explicit = (process.env.PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (explicit === "stripe" || explicit === "asaas") return explicit as ProviderName;
  if (process.env.STRIPE_SECRET_KEY) return "stripe";
  if (process.env.ASAAS_API_KEY) return "asaas";
  return null;
}

/**
 * Carrega credenciais do provider a partir do banco (provider_credentials).
 * Retorna `null` se não houver registro. **Não muta `process.env`.**
 *
 * Usado por webhooks e operações administrativas (refund) que precisam de
 * uma instância configurada com a chave certa para o provider escolhido.
 */
export async function loadProviderConfig(provider: ProviderName): Promise<ProviderConfig | null> {
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
    if (!cred?.api_key) return null;
    return {
      apiKey: cred.api_key as string,
      webhookSecret: (cred.webhook_secret as string | null) ?? null,
      mode: cred.mode === "live" ? "live" : cred.mode === "sandbox" ? "sandbox" : null,
    };
  } catch {
    return null;
  }
}

/**
 * Constrói uma instância do provider já com a config do banco (ou cai para
 * process.env como fallback de compatibilidade — sem mutar env global).
 */
export async function buildProvider(provider: ProviderName): Promise<PaymentProvider> {
  const cfg = (await loadProviderConfig(provider)) ?? undefined;
  return instantiate(provider, cfg);
}

/** Resolve provider preferindo o banco; fallback para .env. */
export async function resolveProvider(): Promise<PaymentProvider> {
  if (_cached && _cached.until > Date.now()) return _cached.instance;
  const fromDb = await resolveFromDb();
  const choice = fromDb?.provider ?? pickFromEnv();
  if (!choice) {
    throw new Error(
      "Nenhum provedor de pagamento configurado. Configure no Painel Admin > Provider ou defina PAYMENT_PROVIDER/chaves no .env.",
    );
  }
  const cfg = fromDb ? ((await loadProviderConfig(choice)) ?? undefined) : undefined;
  const instance = await instantiate(choice, cfg);
  _cached = { name: choice, instance, until: Date.now() + TTL_MS };
  _activeName = choice;
  return instance;
}

/** Invalida cache (chamar após mudança no Admin). */
export function invalidateProviderCache(): void {
  _cached = null;
  _activeName = null;
}

export function getProviderPlanRef(plan: string): string {
  const name = _activeName ?? pickFromEnv();
  if (!name) throw new Error("Provider não inicializado.");
  const isStarter = plan === "starter";
  const key =
    name === "stripe"
      ? isStarter
        ? "STRIPE_PRICE_STARTER"
        : "STRIPE_PRICE_PRO"
      : isStarter
        ? "ASAAS_PLAN_STARTER"
        : "ASAAS_PLAN_PRO";
  const value = process.env[key];
  if (!value) throw new Error(`Variável ${key} não configurada no .env`);
  return value;
}

export type {
  PaymentProvider,
  NormalizedEvent,
  PlanId,
  ProviderName,
  ProviderConfig,
} from "./types";
