// ============================================================================
// Helper server-only para chamar a API Stripe.
//
// Modo de operação (auto-detectado):
//   1) DIRECT  → se STRIPE_SANDBOX_API_KEY/STRIPE_LIVE_API_KEY começa com
//                "sk_test_" ou "sk_live_", fala direto com api.stripe.com.
//                Use isto para rodar local (Docker) com sua própria conta Stripe.
//   2) GATEWAY → caso contrário, usa o Connector Gateway do Lovable
//                (exige LOVABLE_API_KEY). É o modo em produção no Lovable Cloud.
//
// IMPORTANTE: este arquivo SÓ deve ser importado dentro de handlers
// (server functions e server routes), nunca em código de cliente.
// ============================================================================

const STRIPE_API_BASE = "https://api.stripe.com";
const GATEWAY_BASE = "https://connector-gateway.lovable.dev/stripe";

/** Resolve a chave do ambiente. */
function getStripeKey(env: "sandbox" | "live"): string {
  const key =
    env === "live"
      ? process.env.STRIPE_LIVE_API_KEY
      : process.env.STRIPE_SANDBOX_API_KEY;
  if (!key) throw new Error(`Chave Stripe ausente para ambiente '${env}'. Configure STRIPE_${env.toUpperCase()}_API_KEY no .env.`);
  return key;
}

/** Detecta automaticamente o ambiente. */
export function getCurrentStripeEnv(): "sandbox" | "live" {
  return process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
}

/** True quando a chave é uma sk_ real do Stripe (modo DIRECT). */
function isDirectStripeKey(key: string): boolean {
  return key.startsWith("sk_test_") || key.startsWith("sk_live_");
}

/** Converte objeto plano em x-www-form-urlencoded. */
export function toFormBody(obj: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

/**
 * Chamada autenticada à API Stripe.
 * - DIRECT: Authorization: Bearer sk_... → api.stripe.com
 * - GATEWAY: headers do Lovable → connector-gateway.lovable.dev
 */
export async function stripeFetch<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: string } = {},
  env: "sandbox" | "live" = getCurrentStripeEnv(),
): Promise<T> {
  const apiKey = getStripeKey(env);
  const direct = isDirectStripeKey(apiKey);

  let url: string;
  let headers: Record<string, string>;

  if (direct) {
    url = `${STRIPE_API_BASE}${path}`;
    headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  } else {
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!lovableKey) throw new Error("LOVABLE_API_KEY ausente. Para uso local, configure STRIPE_SANDBOX_API_KEY com sua sk_test_ real (modo direto).");
    url = `${GATEWAY_BASE}${path}`;
    headers = {
      Authorization: `Bearer ${lovableKey}`,
      "Lovable-API-Key": lovableKey,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  }

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe ${path} falhou (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}
