// Endpoint público para a página de retorno do checkout consultar o
// status corrente da intenção (created/redirected/paid/failed).
// O webhook é a fonte da verdade — aqui apenas lemos o registro.
//
// Segurança:
//   - O parâmetro `i` deve ser um token assinado por HMAC (verifyIntentToken),
//     impedindo que a URL seja adulterada para consultar intents de terceiros.
//   - Rate limit distribuído por IP+token, para impedir polling abusivo.
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { verifyIntentToken } from "@/lib/intentToken.server";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

export const Route = createFileRoute("/api/public/payments/intent-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("i");
        const intentKey = await verifyIntentToken(token);
        if (!intentKey) {
          return Response.json({ error: "invalid_key" }, { status: 400 });
        }

        // Rate limit: 60 reqs/min por par (IP, token) — suficiente para o
        // polling normal (a cada 2–6s), mas corta scripts abusivos.
        const ip = clientIp(request);
        const rl = await rlConsume(`intent-status:${ip}:${intentKey}`, 60, 60);
        if (!rl.allowed) return tooManyRequests(rl.retryAfter);

        const ci = schema.checkoutIntents;
        const [data] = await db()
          .select({
            status: ci.status,
            planSlug: ci.planSlug,
            withUpsell: ci.withUpsell,
            currency: ci.currency,
            planAmountCents: ci.planAmountCents,
            upsellAmountCents: ci.upsellAmountCents,
            provider: ci.provider,
            confirmedAt: ci.confirmedAt,
            updatedAt: ci.updatedAt,
            lastError: ci.lastError,
            email: ci.email,
          })
          .from(ci)
          .where(eq(ci.idempotencyKey, intentKey))
          .limit(1)
          .catch(() => []);

        if (!data) {
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
          plan: data.planSlug,
          withUpsell: data.withUpsell,
          currency: data.currency,
          planAmountCents: data.planAmountCents,
          upsellAmountCents: data.upsellAmountCents,
          provider: data.provider,
          confirmedAt: data.confirmedAt,
          updatedAt: data.updatedAt,
          emailMasked: maskEmail(data.email),
          lastError: data.status === "failed" ? data.lastError : null,
        });
      },
    },
  },
});
