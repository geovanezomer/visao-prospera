// ============================================================================
// Rate limit distribuído — usa Postgres (rl_consume) para compartilhar
// contadores entre todos os workers/instâncias da edge.
//
// Uso:
//   const r = await rlConsume("checkout:ip:1.2.3.4", 10, 60);
//   if (!r.allowed) return 429;
//
// Falha aberta: se o banco estiver indisponível, libera a requisição em vez
// de derrubar a aplicação inteira (degradação graciosa).
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

export type RlResult = { allowed: boolean; remaining: number; retryAfter: number };

export async function rlConsume(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RlResult> {
  try {
    const { data, error } = await admin().rpc("rl_consume", {
      _key: key,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error || !data) {
      console.warn("[rateLimit] rpc falhou — fail-open:", error?.message);
      return { allowed: true, remaining: limit, retryAfter: 0 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed),
      remaining: Number(row?.remaining ?? 0),
      retryAfter: Number(row?.retry_after_seconds ?? 0),
    };
  } catch (e) {
    console.warn("[rateLimit] exceção — fail-open:", e);
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

/** Extrai IP do request — Cloudflare/proxy aware. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Resposta padronizada de 429. */
export function tooManyRequests(
  retryAfter: number,
  message = "Muitas requisições. Tente mais tarde.",
): Response {
  return new Response(JSON.stringify({ error: "rate_limited", retryAfter }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.max(retryAfter, 1)),
    },
  });
}
