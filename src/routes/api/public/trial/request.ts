// ============================================================================
// POST /api/public/trial/request
// Cria um usuário de teste (válido por N horas), envia magic link via Resend
// e impede reuso do mesmo e-mail.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientIp, rlConsume } from "@/lib/rateLimit.server";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  // honeypot: deve vir vazio (bots tendem a preencher).
  website: z.string().max(0).optional().or(z.literal("")),
});

// Domínios de e-mail descartáveis bloqueados (lista mínima).
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "10minutemail.com",
  "trashmail.com", "yopmail.com", "getnada.com", "discard.email",
]);

export const Route = createFileRoute("/api/public/trial/request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try { raw = await request.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid_email" }, { status: 400 });
        const { email, website } = parsed.data;
        if (website) return Response.json({ ok: true }); // honeypot — finge sucesso
        const domain = email.split("@")[1] ?? "";
        if (DISPOSABLE.has(domain)) {
          return Response.json({ error: "disposable_email" }, { status: 400 });
        }

        const ip = clientIp(request);
        const rl = await rlConsume(`trial:ip:${ip}`, 3, 3600);
        if (!rl.allowed) {
          return Response.json(
            { error: "rate_limited", retryAfter: rl.retryAfter },
            { status: 429, headers: { "Retry-After": String(rl.retryAfter || 60) } },
          );
        }

        const admin = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        // 1) Já solicitou antes?
        const { data: existing } = await admin
          .from("trial_requests")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        if (existing) {
          return Response.json({ error: "already_used" }, { status: 409 });
        }

        // 2) Duração configurável (app_settings.trial → default 2h)
        const { data: cfgRow } = await admin
          .from("app_settings")
          .select("value")
          .eq("key", "trial")
          .maybeSingle();
        const cfg = (cfgRow?.value ?? {}) as { enabled?: boolean; duration_hours?: number };
        if (cfg.enabled === false) {
          return Response.json({ error: "trial_disabled" }, { status: 403 });
        }
        const hours = Math.min(Math.max(Number(cfg.duration_hours ?? 2), 1), 72);
        const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();

        // 3) Cria usuário com flag de trial
        const password = crypto.getRandomValues(new Uint8Array(24))
          .reduce((s, b) => s + b.toString(36), "")
          .slice(0, 24) + "A1!"; // garante complexidade mínima
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            is_trial: true,
            trial_expires_at: expiresAt,
            display_name: email.split("@")[0],
          },
        });
        if (createErr || !created?.user) {
          // Pode acontecer race: e-mail já existe no auth.users (mas não em trial_requests).
          if (/already.*registered|exists/i.test(createErr?.message ?? "")) {
            return Response.json({ error: "already_used" }, { status: 409 });
          }
          return Response.json({ error: "create_failed", detail: createErr?.message }, { status: 500 });
        }

        // 4) Registra trial_requests (lock anti-reuso)
        await admin.from("trial_requests").insert({
          email, user_id: created.user.id, ip, expires_at: expiresAt,
        });

        // 5) Gera magic link
        const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
        const redirectTo = appUrl ? `${appUrl}/app` : undefined;
        const { data: linkRes, error: linkErr } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: redirectTo ? { redirectTo } : undefined,
        });
        if (linkErr || !linkRes?.properties?.action_link) {
          return Response.json({ error: "link_failed", detail: linkErr?.message }, { status: 500 });
        }
        const actionLink = linkRes.properties.action_link;

        // 6) Resend (config admin)
        const { data: emailCfg } = await admin.from("email_settings").select("*").limit(1).maybeSingle();
        const { data: tpl } = await admin
          .from("email_templates")
          .select("subject,html,text,enabled")
          .eq("kind", "trial_magic_link")
          .maybeSingle();

        const apiKey = emailCfg?.resend_api_key || process.env.RESEND_API_KEY;
        const fromEmail = emailCfg?.from_email || process.env.MAGICLINK_FROM;
        const fromName = emailCfg?.from_name || "Finnance";

        if (apiKey && fromEmail && tpl?.enabled !== false) {
          const name = email.split("@")[0];
          // Lê system_name de app_settings.branding se existir.
          const { data: brandingRow } = await admin
            .from("app_settings").select("value").eq("key", "branding").maybeSingle();
          const systemName =
            (brandingRow?.value as { system_name?: string } | null)?.system_name ?? "Finnance";

          const render = (s: string) => s
            .replaceAll("{{name}}", name)
            .replaceAll("{{link}}", actionLink)
            .replaceAll("{{hours}}", String(hours))
            .replaceAll("{{system_name}}", systemName);

          const subject = render(tpl?.subject ?? `Seu teste gratuito do ${systemName}`);
          const html = render(tpl?.html ?? `<p>Olá ${name}, acesse: <a href="${actionLink}">entrar</a> (válido por ${hours}h).</p>`);
          const text = render(tpl?.text ?? `Olá ${name}, acesse: ${actionLink} (válido por ${hours}h).`);

          const sendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${fromName} <${fromEmail}>`,
              to: email,
              subject, html, text,
            }),
          });
          if (!sendRes.ok) {
            // E-mail falhou — não cancelamos o usuário; retornamos warning.
            console.error("[trial] resend falhou:", sendRes.status, await sendRes.text());
            return Response.json({ ok: true, sent: false }, { status: 200 });
          }
        } else {
          console.warn("[trial] config Resend/template ausente — link gerado sem envio.");
        }

        return Response.json({ ok: true, sent: true, hours });
      },
    },
  },
});
