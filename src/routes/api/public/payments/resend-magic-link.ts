// Reenvia o magic link para o e-mail original da intenção de checkout.
// Identificação pela mesma idempotency_key da URL de sucesso (?i=...),
// validada via HMAC para impedir reuso/forja.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
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

        const admin = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const { data: intent } = await admin
          .from("checkout_intents")
          .select("email,status,plan_slug")
          .eq("idempotency_key", intentKey)
          .maybeSingle();

        if (!intent?.email) return Response.json({ error: "not_found" }, { status: 404 });
        if (intent.status !== "paid") {
          return Response.json({ error: "not_paid", status: intent.status }, { status: 409 });
        }

        const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
        const redirectTo = appUrl ? `${appUrl}/app` : undefined;
        const { data: linkRes, error: linkErr } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: intent.email as string,
          options: redirectTo ? { redirectTo } : undefined,
        });
        if (linkErr)
          return Response.json({ error: "link_failed", detail: linkErr.message }, { status: 500 });

        const actionLink = linkRes?.properties?.action_link;
        if (!actionLink) return Response.json({ error: "no_link" }, { status: 500 });

        const { data: cfg } = await admin.from("email_settings").select("*").limit(1).maybeSingle();
        const apiKey = cfg?.resend_api_key || process.env.RESEND_API_KEY;
        const fromEmail = cfg?.from_email || process.env.MAGICLINK_FROM;
        const fromName = cfg?.from_name || "Finnance";
        if (!apiKey || !fromEmail) {
          // F-06: nunca logar action_link (token de auth). Mascarar email.
          console.log(
            "[resend-magic] sem envio (config faltando) para:",
            String(intent.email).replace(/(.{2}).+(@.+)/, "$1***$2"),
          );
          return Response.json({ ok: true, sent: false });
        }
        const name = (intent.email as string).split("@")[0];
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`,
            to: intent.email,
            subject: "Seu link de acesso ao Finnance",
            html: `<p>Olá ${name}, acesse <a href="${actionLink}">aqui</a> para entrar no Finnance.</p>`,
          }),
        }).catch((e) => console.error("[resend-magic] envio falhou:", e));

        return Response.json({ ok: true, sent: true });
      },
    },
  },
});
