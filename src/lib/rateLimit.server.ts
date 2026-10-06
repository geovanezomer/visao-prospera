// ============================================================================
// Rate limit distribuído — contadores no Postgres (tabela rate_limit_buckets),
// compartilhados entre todos os processos.
//
// Uso:
//   const r = await rlConsume("checkout:ip:1.2.3.4", 10, 60);
//   if (!r.allowed) return 429;
//
// Falha aberta: se o banco estiver indisponível, libera a requisição em vez
// de derrubar a aplicação inteira (degradação graciosa).
// ============================================================================
import { sql } from "drizzle-orm";
import { getRequestIP } from "@tanstack/react-start/server";
import { queryRows } from "@/db/client.server";

export type RlResult = { allowed: boolean; remaining: number; retryAfter: number };

/** Janela fixa por chave, numa única instrução atômica (sem corrida entre processos). */
export async function rlConsume(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RlResult> {
  try {
    const rows = await queryRows<{ count: number; retry_after: number }>(sql`
      insert into rate_limit_buckets (bucket_key, count, reset_at)
      values (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
      on conflict (bucket_key) do update set
        count = case when rate_limit_buckets.reset_at < now() then 1
                     else rate_limit_buckets.count + 1 end,
        reset_at = case when rate_limit_buckets.reset_at < now()
                        then now() + make_interval(secs => ${windowSeconds})
                        else rate_limit_buckets.reset_at end
      returning count, greatest(extract(epoch from (reset_at - now()))::int, 0) as retry_after
    `);
    const row = rows[0];
    const count = Number(row?.count ?? 0);
    return {
      allowed: count <= limit,
      remaining: Math.max(limit - count, 0),
      retryAfter: Number(row?.retry_after ?? 0),
    };
  } catch (e) {
    console.warn("[rateLimit] falha no banco — fail-open:", e);
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
