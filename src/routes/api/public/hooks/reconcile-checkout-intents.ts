// Job de reconciliação: marca como `failed` intenções de checkout que
// ficaram em `created`/`redirected` por tempo superior ao limite sem
// receber webhook de confirmação. Acionado pelo cron (CRON_SECRET).
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
//
// Acesso: `Authorization: Bearer <CRON_SECRET>` (ver lib/cronAuth.server.ts).
// A rotina roda sozinha pelo agendador interno (lib/scheduler.server.ts);
// este endpoint é o disparo manual.
import { createFileRoute } from "@tanstack/react-router";
import { rejectUnlessCron } from "@/lib/cronAuth.server";

export const Route = createFileRoute("/api/public/hooks/reconcile-checkout-intents")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = rejectUnlessCron(request);
        if (denied) return denied;
        const { runCheckoutReconcile } = await import("@/lib/jobs.server");
        const result = await runCheckoutReconcile();
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
