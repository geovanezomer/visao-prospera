// Job de reconciliação: marca como `failed` intenções de checkout que
// ficaram em `created`/`redirected` por tempo superior ao limite sem
// receber webhook de confirmação. Acionado por pg_cron.
//
// IMPORTANTE: a janela varia por provider e método de pagamento:
//   - Stripe (cartão):  2h     — checkout session expira em 24h, mas
//                                pagamento confirma em segundos. 2h cobre
//                                falhas de webhook com folga.
//   - Asaas (BR):       72h    — boleto pode levar 1-3 dias úteis para
//                                ser pago; Pix é rápido, mas usamos a
//                                janela maior por segurança (sem método
//                                conhecido, o pior caso vence). Quando
//                                `payment_method` estiver preenchido, é
//                                usado para encurtar a janela do Pix.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Window = { minutes: number; label: string };

function windowFor(provider: string | null, paymentMethod: string | null): Window {
  // Métodos rápidos (cartão/Pix) — confirmação em segundos.
  const fast = ["credit_card", "card", "pix", "PIX", "CREDIT_CARD"];
  if (paymentMethod && fast.includes(paymentMethod)) {
    return { minutes: 120, label: `${paymentMethod} 2h` };
  }
  // Boleto Asaas/Stripe — vence em D+3 úteis.
  if (paymentMethod && /boleto|BOLETO/.test(paymentMethod)) {
    return { minutes: 60 * 24 * 4, label: "boleto 4d" };
  }
  if (provider === "asaas") {
    // Asaas sem método conhecido: assume pior caso (boleto), janela 72h.
    return { minutes: 60 * 72, label: "asaas 72h" };
  }
  // Stripe sem método conhecido (cartão é o default no checkout session).
  return { minutes: 120, label: "stripe 2h" };
}

export const Route = createFileRoute("/api/public/hooks/reconcile-checkout-intents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        // FIX P0: lógica anterior `expected && apiKey && apiKey !== expected`
        // permitia bypass quando o header não vinha. Agora: se há `expected`
        // configurado, o header é obrigatório e comparado em constant-time.
        if (expected) {
          const { timingSafeEqual } = await import("@/lib/timingSafe");
          if (!apiKey || !timingSafeEqual(apiKey, expected)) {
            return new Response("forbidden", { status: 403 });
          }
        }

        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          },
        );

        // Busca candidatos antigos o suficiente para sequer caberem na
        // menor das janelas (2h). Filtramos por janela específica em JS,
        // sem fazer um UPDATE cego que marcaria boletos legítimos como
        // failed prematuramente.
        const minCutoff = new Date(Date.now() - 120 * 60 * 1000).toISOString();
        const { data: candidates, error } = await sb
          .from("checkout_intents")
          .select("id,provider,payment_method,updated_at")
          .in("status", ["created", "redirected"])
          .lt("updated_at", minCutoff)
          .limit(500);

        if (error) {
          console.error("[reconcile] erro:", error);
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const now = Date.now();
        const toFail: { id: string; label: string }[] = [];
        for (const c of candidates ?? []) {
          const w = windowFor(c.provider as string | null, c.payment_method);
          const ageMin = (now - new Date(c.updated_at as string).getTime()) / 60000;
          if (ageMin >= w.minutes) toFail.push({ id: c.id as string, label: w.label });
        }

        if (toFail.length === 0) {
          return Response.json({ ok: true, reconciled: 0, scanned: candidates?.length ?? 0 });
        }

        // Faz updates em lotes pequenos para evitar transações longas.
        let reconciled = 0;
        const chunkSize = 50;
        for (let i = 0; i < toFail.length; i += chunkSize) {
          const slice = toFail.slice(i, i + chunkSize);
          const ids = slice.map((s) => s.id);
          const { error: upErr, data: updated } = await sb
            .from("checkout_intents")
            .update({
              status: "failed",
              last_error: `auto-reconciled (janela: ${slice[0].label})`,
            })
            .in("id", ids)
            .select("id");
          if (upErr) {
            console.error("[reconcile] update falhou:", upErr);
            continue;
          }
          reconciled += updated?.length ?? 0;
        }

        console.log(`[reconcile] ${reconciled} intenções marcadas como failed`);
        return Response.json({ ok: true, reconciled, scanned: candidates?.length ?? 0 });
      },
    },
  },
});
