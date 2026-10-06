// Middleware das server functions autenticadas: lê a sessão do cookie e
// expõe `context.userId`, `context.user` e `context.role`.
// Substitui o requireAuth (Bearer token do Supabase).
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getSessionFromHeaders } = await import("@/lib/auth.server");
  const request = getRequest();
  const session = request ? await getSessionFromHeaders(request.headers) : null;
  if (!session) throw new Error("Unauthorized: sessão ausente ou expirada");
  return next({
    context: {
      userId: session.user.id,
      user: session.user,
      role: (session.user as { role?: string }).role ?? "user",
    },
  });
});
