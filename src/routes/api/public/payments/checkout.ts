// ============================================================================
// POST /api/public/payments/checkout
//
// Cria sessão de checkout no provedor ativo (Stripe ou Asaas) e devolve a
// URL hospedada para redirect. Rota PÚBLICA — não exige login porque é
// usada na landing/planos. A criação de conta acontece via magic link
// após a confirmação do pagamento (webhook).
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveProvider } from "@/lib/payments";

const Body = z.object({
  plan: z.enum(["starter", "pro"]),
  email: z.string().email().max(200),
});

export const Route = createFileRoute("/api/public/payments/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return Response.json({ error: "Payload inválido" }, { status: 400 });
        }

        const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
        if (!appUrl) {
          return Response.json({ error: "APP_URL não configurado" }, { status: 500 });
        }

        try {
          const provider = await resolveProvider();
          const { url } = await provider.createCheckout({
            plan: parsed.plan,
            email: parsed.email,
            successUrl: `${appUrl}/checkout/sucesso?plan=${parsed.plan}`,
            cancelUrl: `${appUrl}/planos?canceled=1`,
          });
          return Response.json({ url, provider: provider.name });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Erro desconhecido";
          console.error("[checkout] falhou:", msg);
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
