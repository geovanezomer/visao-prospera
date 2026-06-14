// ============================================================================
// Helper server-only para chamar a API Stripe via Connector Gateway do Lovable.
// IMPORTANTE: este arquivo SÓ deve ser importado dentro de handlers
// (server functions e server routes), nunca em código de cliente.
// O sufixo .server.ts garante que o Vite bloqueie qualquer import client-side.
// ============================================================================

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/stripe";

/**
 * Resolve a chave da API Stripe baseado no ambiente.
 * - sandbox: STRIPE_SANDBOX_API_KEY (test)
 * - live:    STRIPE_API_KEY (produção, injetado após go-live)
 */
function getStripeKey(env: "sandbox" | "live"): string {
  const key =
    env === "live"
      ? process.env.STRIPE_API_KEY
      : process.env.STRIPE_SANDBOX_API_KEY;
  if (!key) throw new Error(`Chave Stripe ausente para ambiente '${env}'.`);
  return key;
}

/** Detecta automaticamente o ambiente: se STRIPE_API_KEY (live) existe, usa live. */
export function getCurrentStripeEnv(): "sandbox" | "live" {
  return process.env.STRIPE_API_KEY ? "live" : "sandbox";
}

/** Converte objeto plano em x-www-form-urlencoded (formato exigido pela API Stripe). */
export function toFormBody(obj: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

/**
 * Faz uma chamada autenticada à API Stripe via o gateway do Lovable.
 * O gateway adiciona automaticamente o header `Authorization: Bearer sk_...`.
 */
export async function stripeFetch<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: string } = {},
  env: "sandbox" | "live" = getCurrentStripeEnv(),
): Promise<T> {
  const apiKey = getStripeKey(env);
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY ausente.");

  const res = await fetch(`${GATEWAY_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: init.body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe ${path} falhou (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}
