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
import { getRequestIP } from "@tanstack/react-start/server";

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

/**
 * IP do cliente para rate limit.
 *
 * Headers como X-Forwarded-For são enviados pelo próprio cliente e só valem
 * quando um proxy confiável os sobrescreve. Por isso o header é escolhido
 * explicitamente em TRUST_PROXY_HEADER, conforme a infraestrutura:
 *   - "cf-connecting-ip"  → atrás da Cloudflare
 *   - "x-real-ip"         → atrás de nginx com `proxy_set_header X-Real-IP $remote_addr`
 *   - "x-forwarded-for"   → usa a entrada MAIS À DIREITA (a adicionada pelo proxy)
 *   - vazio (padrão)      → IP do socket TCP; nenhum header é confiado
 */
export function clientIp(req: Request): string {
  const trusted = (process.env.TRUST_PROXY_HEADER ?? "").trim().toLowerCase();
  if (trusted) {
    const raw = req.headers.get(trusted);
    if (raw) {
      const ip = trusted === "x-forwarded-for" ? raw.split(",").at(-1) : raw;
      if (ip?.trim()) return ip.trim();
    }
  }
  return socketIp() ?? "unknown";
}

function socketIp(): string | undefined {
  try {
    return getRequestIP();
  } catch {
    // Fora de um request do servidor (ex.: testes unitários).
    return undefined;
  }
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
