// ============================================================================
// POST /api/public/trial/activate
// Marca o teste como ativado quando o usuário já entrou pelo magic link
// (sessão em cookie). Não cria acesso; apenas registra funil.
// As flags vêm das colunas do `user` (gravadas só pelo servidor).
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { getSessionFromHeaders } from "@/lib/auth.server";
import { readTrialFlags } from "@/lib/trialFlags";
import { getAppUser } from "@/lib/users.server";

export const Route = createFileRoute("/api/public/trial/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSessionFromHeaders(request.headers).catch(() => null);
        if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

        // Relê do banco: a sessão pode estar em cache (cookie cache do Better Auth).
        const user = await getAppUser(session.user.id);
        if (!user?.email) return new Response("Unauthorized", { status: 401 });

        if (!readTrialFlags(user).isTrial) return Response.json({ ok: true, activated: false });

        try {
          const tr = schema.trialRequests;
          await db()
            .update(tr)
            .set({ consumedAt: new Date().toISOString() })
            .where(
              and(eq(sql`lower(${tr.email})`, user.email.toLowerCase()), isNull(tr.consumedAt)),
            );
        } catch (e) {
          console.error(
            "[trial-activate] falha ao marcar ativação:",
            e instanceof Error ? e.message : e,
          );
          return Response.json({ error: "activate_failed" }, { status: 500 });
        }

        return Response.json({ ok: true, activated: true });
      },
    },
  },
});
