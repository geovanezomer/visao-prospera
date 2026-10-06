import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Headers de segurança em todas as respostas. A CSP aqui não restringe
// script-src (GA/Pixel configuráveis no admin, provedores de IA):
// bloqueia só o que nenhuma página usa — ser embutido em iframe de outro
// domínio (clickjacking), <object>/<embed> e troca do <base>.
export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
};

export function withSecurityHeaders(response: Response): Response {
  // Respostas com headers imutáveis (ex.: Response.redirect) precisam de cópia.
  let res = response;
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(k)) res.headers.set(k, v);
    }
  } catch {
    res = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(k)) res.headers.set(k, v);
    }
  }
  return res;
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function captureServerError(err: unknown, path?: string): Promise<void> {
  try {
    const { recordError } = await import("./lib/ops/errors.server");
    await recordError("server", err, { path });
  } catch {
    /* registro de erro nunca derruba a resposta */
  }
}

async function normalizeCatastrophicSsrResponse(
  response: Response,
  path?: string,
  aborted = false,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  const err = captured ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(err);
  // Requisição cancelada pelo navegador: o 500 é efeito da desconexão, não falha.
  if (!aborted) await captureServerError(err, path);
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Migrations + admin inicial, uma vez por processo (falha alta).
      const { ensureDatabaseReady } = await import("./db/bootstrap.server");
      await ensureDatabaseReady();
      const { startScheduler } = await import("./lib/scheduler.server");
      startScheduler();
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const path = new URL(request.url).pathname;
      return withSecurityHeaders(
        await normalizeCatastrophicSsrResponse(response, path, request.signal.aborted),
      );
    } catch (error) {
      console.error(error);
      await captureServerError(error, new URL(request.url).pathname);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
