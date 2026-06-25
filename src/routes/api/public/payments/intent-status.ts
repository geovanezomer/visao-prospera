// Endpoint público para a página de retorno do checkout consultar o
// status corrente da intenção (created/redirected/paid/failed).
// O webhook é a fonte da verdade — aqui apenas lemos o registro.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/payments/intent-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const i = url.searchParams.get("i");
        if (!i || !/^[a-f0-9]{8,64}$/i.test(i)) {
          return Response.json({ error: "invalid_key" }, { status: 400 });
        }

        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const { data, error } = await sb
          .from("checkout_intents")
          .select(
            "status,plan_slug,with_upsell,currency,plan_amount_cents,upsell_amount_cents,provider,confirmed_at,updated_at,last_error,email",
          )
          .eq("idempotency_key", i)
          .maybeSingle();

        if (error || !data) {
          return Response.json({ status: "unknown" }, { status: 404 });
        }

        // Mascara o e-mail: "g***e@dominio.com" — evita enumeração se a chave vazar.
        function maskEmail(e: string | null | undefined): string | null {
          if (!e) return null;
          const [u, d] = e.split("@");
          if (!u || !d) return null;
          if (u.length <= 2) return `${u[0] ?? "*"}***@${d}`;
          return `${u[0]}***${u[u.length - 1]}@${d}`;
        }

        return Response.json({
          status: data.status,
          plan: data.plan_slug,
          withUpsell: data.with_upsell,
          currency: data.currency,
          planAmountCents: data.plan_amount_cents,
          upsellAmountCents: data.upsell_amount_cents,
          provider: data.provider,
          confirmedAt: data.confirmed_at,
          updatedAt: data.updated_at,
          emailMasked: maskEmail(data.email as string | null),
          lastError: data.status === "failed" ? data.last_error : null,
        });
      },
    },
  },
});
