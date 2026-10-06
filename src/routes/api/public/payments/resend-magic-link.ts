// Reenvia o magic link para o e-mail original da intenção de checkout.
// Identificação pela mesma idempotency_key da URL de sucesso (?i=...),
// validada via HMAC para impedir reuso/forja.
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { sendMail } from "@/lib/mailer.server";
import { verifyIntentToken } from "@/lib/intentToken.server";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

export const Route = createFileRoute("/api/public/payments/resend-magic-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { i?: string } = {};
        try {
          body = (await request.json()) as { i?: string };
        } catch {
          /* noop */
        }
        const intentKey = await verifyIntentToken(body.i ?? null);
        if (!intentKey) {
          return Response.json({ error: "invalid_key" }, { status: 400 });
        }

        // Rate limit distribuído — 1 reenvio por minuto por (IP, intent),
        // 5 por hora para evitar abuso de email-bombing.
        const ip = clientIp(request);
        const rlMin = await rlConsume(`resend-ml:1m:${intentKey}`, 1, 60);
        if (!rlMin.allowed) {
          return Response.json(
            { error: "rate_limited", retryAfter: rlMin.retryAfter },
            { status: 429, headers: { "Retry-After": String(Math.max(rlMin.retryAfter, 1)) } },
          );
        }
        const rlHour = await rlConsume(`resend-ml:1h:${intentKey}:${ip}`, 5, 3600);
        if (!rlHour.allowed) {
          return Response.json(
            { error: "rate_limited", retryAfter: rlHour.retryAfter },
            { status: 429, headers: { "Retry-After": String(Math.max(rlHour.retryAfter, 1)) } },
          );
        }

        const ci = schema.checkoutIntents;
        const [intent] = await db()
          .select({ email: ci.email, status: ci.status, planSlug: ci.planSlug })
          .from(ci)
          .where(eq(ci.idempotencyKey, intentKey))
          .limit(1);

        if (!intent?.email) return Response.json({ error: "not_found" }, { status: 404 });
        if (intent.status !== "paid") {
          return Response.json({ error: "not_paid", status: intent.status }, { status: 409 });
        }

        let actionLink: string;
        try {
          const { generateMagicLink } = await import("@/lib/magicLink.server");
          actionLink = await generateMagicLink(intent.email, "/app");
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return Response.json({ error: "link_failed", detail }, { status: 500 });
        }

        const name = intent.email.split("@")[0];
        const res = await sendMail({
          to: intent.email,
          subject: "Seu link de acesso ao FinnancePRO",
          html: `<p>Olá ${name}, acesse <a href="${actionLink}">aqui</a> para entrar no FinnancePRO.</p>`,
        }).catch((e) => {
          console.error("[resend-magic] envio falhou:", e);
          return { sent: false, via: "error" as const };
        });
        if (!res.sent && res.via === "none") {
          // F-06: nunca logar o link (token de auth). Mascarar email.
          console.log(
            "[resend-magic] sem envio (config faltando) para:",
            intent.email.replace(/(.{2}).+(@.+)/, "$1***$2"),
          );
          return Response.json({ ok: true, sent: false });
        }

        return Response.json({ ok: true, sent: true });
      },
    },
  },
});
