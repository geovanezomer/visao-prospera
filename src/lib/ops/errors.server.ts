// ============================================================================
// Captura de erros hospedada no próprio banco (sem serviço externo pago).
//
// Erros iguais (mesma origem, mensagem e ponto da pilha) viram UMA linha com
// contador; o painel do admin lista os mais recentes e o alerta por e-mail
// avisa quando aparece um erro novo. Nunca lança: falhar ao registrar um erro
// não pode derrubar a requisição.
// ============================================================================
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

export type ErrorSource = "server" | "client" | "job";

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Remove credenciais que podem aparecer em mensagens (URLs com senha, tokens). */
export function redact(s: string): string {
  return s
    .replace(/(\w+:\/\/)([^:/\s@]+):([^@\s]+)@/g, "$1$2:***@")
    .replace(/(bearer\s+)[\w.~+/=-]{8,}/gi, "$1***")
    .replace(/((?:api[_-]?key|token|secret|password|senha)["'=:\s]+)[^\s"',;&]{6,}/gi, "$1***");
}

function topFrame(stack: string | undefined): string {
  if (!stack) return "";
  const line = stack
    .split("\n")
    .slice(1)
    .find((l) => /\bat\b/.test(l) && !l.includes("node_modules"));
  // Sem números de linha/coluna: o mesmo erro após um novo build agrupa igual.
  return (line ?? "").replace(/:\d+:\d+\)?\s*$/, "").trim();
}

export function normalizeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error)
    return {
      message: redact(`${err.name}: ${err.message}`).slice(0, MAX_MESSAGE),
      stack: err.stack ? redact(err.stack).slice(0, MAX_STACK) : undefined,
    };
  return { message: redact(String(err)).slice(0, MAX_MESSAGE) };
}

export function fingerprintOf(source: ErrorSource, message: string, stack?: string): string {
  // Números e ids variáveis na mensagem não devem quebrar o agrupamento.
  const msg = message.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>").replace(/\d+/g, "<n>");
  return createHash("sha256")
    .update(`${source}|${msg}|${topFrame(stack)}`)
    .digest("hex")
    .slice(0, 32);
}

/** Cliente fechou a conexão no meio da resposta (aba fechada, navegação): não é falha. */
export function isClientAbort(err: unknown): boolean {
  for (let e = err, i = 0; e && typeof e === "object" && i < 4; i++) {
    const x = e as { code?: string; message?: string; name?: string; cause?: unknown };
    if (x.code === "ECONNRESET" || x.name === "AbortError" || x.message === "aborted") return true;
    e = x.cause;
  }
  return false;
}

export async function recordError(
  source: ErrorSource,
  err: unknown,
  opts: { path?: string; stack?: string } = {},
): Promise<void> {
  if (isClientAbort(err)) return;
  try {
    const n = normalizeError(err);
    const stack = opts.stack ? redact(opts.stack).slice(0, MAX_STACK) : n.stack;
    const fp = fingerprintOf(source, n.message, stack);
    const path = opts.path ? redact(opts.path).slice(0, 300) : null;
    const { queryRows } = await import("@/db/client.server");
    await queryRows(sql`
      insert into error_events (fingerprint, source, message, stack, path)
      values (${fp}, ${source}, ${n.message}, ${stack ?? null}, ${path})
      on conflict (fingerprint) do update set
        count = error_events.count + 1,
        last_seen = now(),
        stack = coalesce(excluded.stack, error_events.stack),
        path = coalesce(excluded.path, error_events.path)
    `);
  } catch (e) {
    console.warn("[errors] não foi possível registrar o erro:", e instanceof Error ? e.message : e);
  }
}

export type ErrorEventRow = {
  id: string;
  source: ErrorSource;
  message: string;
  stack: string | null;
  path: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
};

export async function listErrorEvents(limit = 50): Promise<ErrorEventRow[]> {
  const { db, schema } = await import("@/db/client.server");
  const { desc } = await import("drizzle-orm");
  const rows = await db()
    .select()
    .from(schema.errorEvents)
    .orderBy(desc(schema.errorEvents.lastSeen))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    source: r.source as ErrorSource,
    message: r.message,
    stack: r.stack,
    path: r.path,
    count: r.count,
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
  }));
}

/** Apaga registros sem ocorrência há mais de `days` dias. */
export async function pruneErrorEvents(days = 30): Promise<number> {
  const { queryRows } = await import("@/db/client.server");
  const rows = await queryRows<{ n: number }>(sql`
    with d as (delete from error_events where last_seen < now() - make_interval(days => ${days}) returning 1)
    select count(*)::int as n from d
  `);
  return Number(rows[0]?.n ?? 0);
}
