// ============================================================================
// POST /api/public/trial/request
// Cria um usuário de teste (válido por N horas), envia magic link pelo
// mailer central e impede reuso do mesmo e-mail (trial_requests, único por
// lower(email)). As flags de trial ficam em colunas do `user`, gravadas só
// aqui no servidor — o usuário não consegue defini-las.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client.server";
import { clientIp, rlConsume } from "@/lib/rateLimit.server";
import { createAppUser, deleteAppUser } from "@/lib/users.server";
import { sendMail } from "@/lib/mailer.server";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  // honeypot: usuário real envia vazio; bot pode preencher qualquer texto.
  website: z.string().optional().default(""),
});

// Domínios de e-mail descartáveis bloqueados (lista mínima).
const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "10minutemail.com",
  "trashmail.com",
  "yopmail.com",
  "getnada.com",
  "discard.email",
]);

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

async function appSetting<T>(key: string): Promise<T | null> {
  const [row] = await db()
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  return (row?.value as T | undefined) ?? null;
}

/** Desfaz o trial (usuário + lock) para permitir nova tentativa. */
async function rollbackTrial(userId: string | null | undefined, email: string) {
  if (userId) {
    try {
      await deleteAppUser(userId);
    } catch (e) {
      console.error("[trial] rollback deleteUser falhou:", e instanceof Error ? e.message : e);
    }
  }
  await db()
    .delete(schema.trialRequests)
    .where(eq(sql`lower(${schema.trialRequests.email})`, email.toLowerCase()))
    .catch((e) => console.error("[trial] rollback trial_requests falhou:", e));
}

export const Route = createFileRoute("/api/public/trial/request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
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

        // 1) Já solicitou antes? A tabela é o lock permanente de 1 teste por e-mail.
        const [existing] = await db()
          .select({ id: schema.trialRequests.id })
          .from(schema.trialRequests)
          .where(eq(sql`lower(${schema.trialRequests.email})`, email))
          .limit(1);
        if (existing) {
          return Response.json({ error: "already_used" }, { status: 409 });
        }

        // 2) Duração configurável (app_settings.trial → default 2h)
        const cfg =
          (await appSetting<{ enabled?: boolean; duration_hours?: number }>("trial")) ?? {};
        if (cfg.enabled !== true) {
          return Response.json({ error: "trial_disabled" }, { status: 403 });
        }
        const hours = Math.min(Math.max(Number(cfg.duration_hours ?? 2), 1), 72);
        const expiresAt = new Date(Date.now() + hours * 3600_000);

        // 3) Template (desativado no painel = trial sem e-mail → bloqueia antes de criar).
        const [tpl] = await db()
          .select({
            subject: schema.emailTemplates.subject,
            html: schema.emailTemplates.html,
            text: schema.emailTemplates.text,
            enabled: schema.emailTemplates.enabled,
          })
          .from(schema.emailTemplates)
          .where(eq(schema.emailTemplates.kind, "trial_magic_link"))
          .limit(1);
        if (tpl && tpl.enabled === false) {
          console.error("[trial] template trial_magic_link desativado.");
          return Response.json({ error: "email_config_missing" }, { status: 500 });
        }

        // 4) Registra o lock ANTES de criar a conta: o UNIQUE em lower(email)
        // resolve corridas entre dois pedidos simultâneos do mesmo e-mail.
        try {
          await db()
            .insert(schema.trialRequests)
            .values({ email, ip, expiresAt: expiresAt.toISOString() });
        } catch (e) {
          if (isUniqueViolation(e)) {
            return Response.json({ error: "already_used" }, { status: 409 });
          }
          console.error("[trial] insert trial_requests falhou:", e);
          return Response.json({ error: "request_register_failed" }, { status: 500 });
        }

        // 5) Cria usuário (só magic link, sem senha) com as flags de trial.
        let userId: string;
        try {
          const created = await createAppUser({
            email,
            name: email.split("@")[0],
            isTrial: true,
            trialExpiresAt: expiresAt,
          });
          userId = created.id;
        } catch (e) {
          await rollbackTrial(null, email);
          // E-mail já tem conta (ex.: cliente pagante) — trial não se aplica.
          if ((e instanceof Error && e.message === "USER_EXISTS") || isUniqueViolation(e)) {
            return Response.json({ error: "already_used" }, { status: 409 });
          }
          const detail = e instanceof Error ? e.message : String(e);
          return Response.json({ error: "create_failed", detail }, { status: 500 });
        }
        await db()
          .update(schema.trialRequests)
          .set({ userId })
          .where(eq(sql`lower(${schema.trialRequests.email})`, email));

        // 6) Magic link: entra direto no app após a verificação.
        let actionLink: string;
        try {
          const { generateMagicLink } = await import("@/lib/magicLink.server");
          actionLink = await generateMagicLink(email, "/app");
        } catch (e) {
          await rollbackTrial(userId, email);
          const detail = e instanceof Error ? e.message : String(e);
          return Response.json({ error: "link_failed", detail }, { status: 500 });
        }

        // 7) E-mail (template do painel, se houver).
        {
          const name = email.split("@")[0];
          const branding = await appSetting<{ system_name?: string }>("branding");
          const systemName = branding?.system_name ?? "Finnance";

          const render = (s: string) =>
            s
              .replaceAll("{{name}}", name)
              .replaceAll("{{link}}", actionLink)
              .replaceAll("{{hours}}", String(hours))
              .replaceAll("{{system_name}}", systemName);

          const subject = render(tpl?.subject ?? `Seu teste gratuito do ${systemName}`);
          const html = render(
            tpl?.html ??
              `<p>Olá ${name}, acesse: <a href="${actionLink}">entrar</a> (válido por ${hours}h).</p>`,
          );
          const text = render(
            tpl?.text ?? `Olá ${name}, acesse: ${actionLink} (válido por ${hours}h).`,
          );

          const sent = await sendMail({ to: email, subject, html, text });
          if (!sent.sent) {
            // Sem e-mail, o usuário não recebe o acesso. Desfaz o trial para permitir
            // nova tentativa depois da correção da configuração/entregabilidade.
            await rollbackTrial(userId, email);
            if (sent.via === "none") {
              console.error("[trial] nenhum envio de e-mail configurado.");
              return Response.json({ error: "email_config_missing" }, { status: 500 });
            }
            console.error("[trial] envio falhou:", sent.via, sent.error);
            return Response.json({ error: "email_send_failed" }, { status: 502 });
          }
        }

        return Response.json({ ok: true, sent: true, hours });
      },
    },
  },
});
