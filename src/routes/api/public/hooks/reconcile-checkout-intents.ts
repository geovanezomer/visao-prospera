// Job de reconciliação: marca como `failed` intenções de checkout que
// ficaram em `created`/`redirected` por tempo superior ao limite sem
// receber webhook de confirmação. Acionado por pg_cron.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Janela padrão: 2h. Stripe Checkout Session expira em 24h, mas se em 2h
// não houve webhook nem retorno, é seguro marcar como falha — o webhook
// real (caso chegue depois) ainda atualiza a `subscription` separadamente.
const STALE_MINUTES = 120;

export const Route = createFileRoute("/api/public/hooks/reconcile-checkout-intents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Validação leve: aceita apikey == anon key para reduzir ruído.
        const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (expected && apiKey && apiKey !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

        const { data, error } = await sb
          .from("checkout_intents")
          .update({
            status: "failed",
            last_error: `auto-reconciled: sem webhook em ${STALE_MINUTES} min`,
          })
          .in("status", ["created", "redirected"])
          .lt("updated_at", cutoff)
          .select("id");

        if (error) {
          console.error("[reconcile] erro:", error);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const count = data?.length ?? 0;
        console.log(`[reconcile] ${count} intenções marcadas como failed`);
        return Response.json({ ok: true, reconciled: count });
      },
    },
  },
});
