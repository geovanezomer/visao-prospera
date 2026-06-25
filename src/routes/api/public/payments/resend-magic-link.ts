// Reenvia o magic link para o e-mail original da intenção de checkout.
// Identificação pela mesma idempotency_key da URL de sucesso (?i=...),
// para o usuário não precisar digitar o e-mail novamente.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Limite leve em memória — 1 reenvio por chave a cada 60s.
const lastSend = new Map<string, number>();

export const Route = createFileRoute("/api/public/payments/resend-magic-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { i?: string } = {};
        try { body = (await request.json()) as { i?: string }; } catch { /* noop */ }
        const i = body.i ?? "";
        if (!i || !/^[a-f0-9]{8,64}$/i.test(i)) {
          return Response.json({ error: "invalid_key" }, { status: 400 });
        }
        const now = Date.now();
        const prev = lastSend.get(i) ?? 0;
        if (now - prev < 60_000) {
          return Response.json({ error: "rate_limited", retryAfter: 60 - Math.floor((now - prev) / 1000) }, { status: 429 });
        }

        const admin = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const { data: intent } = await admin
          .from("checkout_intents")
          .select("email,status,plan_slug")
          .eq("idempotency_key", i)
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
        if (linkErr) return Response.json({ error: "link_failed", detail: linkErr.message }, { status: 500 });

        const actionLink = linkRes?.properties?.action_link;
        if (!actionLink) return Response.json({ error: "no_link" }, { status: 500 });

        // Envia via Resend usando email_settings (mesmo caminho do webhook).
        const { data: cfg } = await admin.from("email_settings").select("*").limit(1).maybeSingle();
        const apiKey = cfg?.resend_api_key || process.env.RESEND_API_KEY;
        const fromEmail = cfg?.from_email || process.env.MAGICLINK_FROM;
        const fromName = cfg?.from_name || "Finnance";
        if (!apiKey || !fromEmail) {
          console.log("[resend-magic] link gerado sem envio (config faltando):", intent.email);
          lastSend.set(i, now);
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

        lastSend.set(i, now);
        return Response.json({ ok: true, sent: true });
      },
    },
  },
});
