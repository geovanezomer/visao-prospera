// ============================================================================
// POST /api/public/hooks/trial-cleanup
// Cron horário: remove usuários de trial expirados que NÃO converteram em
// assinatura paga. Os registros de trial_requests são mantidos para preservar
// a regra comercial: um único teste por e-mail, para sempre.
// Acesso: header `apikey` deve corresponder ao SUPABASE_PUBLISHABLE_KEY (padrão
// de cron pg_cron + pg_net descrito no knowledge).
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/trial-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const admin = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const now = Date.now();
        let scanned = 0;
        let deleted = 0;
        let skippedConverted = 0;

        // Pagina por todos os usuários e filtra os de trial expirados.
        const PER_PAGE = 200;
        const MAX_PAGES = 50;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const { data: list, error } = await admin.auth.admin.listUsers({
            page,
            perPage: PER_PAGE,
          });
          if (error) {
            console.error("[trial-cleanup] listUsers falhou:", error.message);
            break;
          }
          const users = list?.users ?? [];
          scanned += users.length;
          for (const u of users) {
            const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
            if (!meta.is_trial) continue;
            const exp = meta.trial_expires_at
              ? new Date(String(meta.trial_expires_at)).getTime()
              : 0;
            // Tolerância de 5 minutos para evitar race com banner client-side.
            if (!exp || exp > now - 5 * 60_000) continue;

            // Se converteu (tem assinatura ativa), nunca deleta — apenas limpa flag.
            const { data: sub } = await admin
              .from("subscriptions")
              .select("id")
              .eq("user_id", u.id)
              .in("status", ["active", "trialing", "lifetime", "past_due"])
              .limit(1)
              .maybeSingle();
            if (sub) {
              skippedConverted++;
              await admin.auth.admin.updateUserById(u.id, {
                user_metadata: { ...meta, is_trial: false, trial_expires_at: null },
              });
              continue;
            }
            const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
            if (delErr) {
              console.error("[trial-cleanup] deleteUser falhou:", u.id, delErr.message);
              continue;
            }
            deleted++;
          }
          if (users.length < PER_PAGE) break;
        }

        return Response.json({
          ok: true,
          scanned,
          deleted,
          skippedConverted,
          trialRequestsPurged: 0,
          at: new Date().toISOString(),
        });
      },
    },
  },
});
