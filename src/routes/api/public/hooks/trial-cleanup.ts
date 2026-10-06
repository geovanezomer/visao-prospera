// ============================================================================
// POST /api/public/hooks/trial-cleanup
// Cron horário: remove usuários de trial expirados que NÃO converteram em
// assinatura paga. Os registros de trial_requests são mantidos para preservar
// a regra comercial: um único teste por e-mail, para sempre.
// Acesso: `Authorization: Bearer <CRON_SECRET>` (ver lib/cronAuth.server.ts).
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { readTrialFlags, trialEndMetadata } from "@/lib/trialFlags";
import { rejectUnlessCron } from "@/lib/cronAuth.server";

export const Route = createFileRoute("/api/public/hooks/trial-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = rejectUnlessCron(request);
        if (denied) return denied;

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
            const trial = readTrialFlags(u);
            if (!trial.isTrial) continue;
            const exp = trial.trialExpiresAt ? new Date(trial.trialExpiresAt).getTime() : 0;
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
                app_metadata: trialEndMetadata(),
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
