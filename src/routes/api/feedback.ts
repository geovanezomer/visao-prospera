// ============================================================================
// POST /api/feedback — envia sugestões/feedback pelo mailer central
// (SMTP próprio ou Resend — ver lib/mailer.server.ts).
//
// Configuração (lida do ambiente do servidor — .env do VPS/Docker):
//   - FEEDBACK_TO        → destinatário das sugestões (obrigatório)
//   - FEEDBACK_FROM      → remetente (opcional; padrão: remetente do mailer)
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";
import { sendMail } from "@/lib/mailer.server";

const PayloadSchema = z.object({
  topic: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  // Metadados opcionais para contexto
  appVersion: z.string().max(50).optional(),
  userAgent: z.string().max(500).optional(),
});

// Escape básico para conteúdo de usuário inserido no HTML do e-mail.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const Route = createFileRoute("/api/feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const from = process.env.FEEDBACK_FROM || undefined;
        const to = process.env.FEEDBACK_TO;
        const notConfigured = () =>
          Response.json(
            {
              error:
                "Servidor de e-mail não configurado. Defina FEEDBACK_TO e o envio (SMTP_HOST ou RESEND_API_KEY) no .env.",
            },
            { status: 503 },
          );

        if (!to) return notConfigured();

        // Endpoint público que dispara e-mail: limita por IP contra spam e
        // consumo da cota do Resend.
        const rl = await rlConsume(`feedback:ip:${clientIp(request)}`, 5, 3600);
        if (!rl.allowed) return tooManyRequests(rl.retryAfter);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido." }, { status: 400 });
        }

        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Dados inválidos.", details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const { topic, subject, message, appVersion, userAgent } = parsed.data;

        const html = `
          <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; color:#111; max-width:600px;">
            <h2 style="margin:0 0 12px;">Nova sugestão — FinnancePRO</h2>
            <p style="margin:0 0 4px;"><strong>Tópico:</strong> ${escapeHtml(topic)}</p>
            <p style="margin:0 0 12px;"><strong>Assunto:</strong> ${escapeHtml(subject)}</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;" />
            <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5;margin:0;">${escapeHtml(message)}</pre>
            ${
              appVersion || userAgent
                ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
                   <p style="font-size:12px;color:#666;margin:0;">
                     ${appVersion ? `Versão: ${escapeHtml(appVersion)}<br/>` : ""}
                     ${userAgent ? `UA: ${escapeHtml(userAgent)}` : ""}
                   </p>`
                : ""
            }
          </div>
        `;

        const text = `Tópico: ${topic}\nAssunto: ${subject}\n\n${message}\n${
          appVersion ? `\nVersão: ${appVersion}` : ""
        }${userAgent ? `\nUA: ${userAgent}` : ""}`;

        const res = await sendMail({
          to,
          from,
          subject: `[Sugestão] ${subject}`,
          html,
          text,
          replyTo: to,
        });

        if (!res.sent) {
          if (res.via === "none") return notConfigured();
          // Não vaza o erro bruto do provedor ao cliente — apenas o canal.
          console.error("[feedback] envio falhou:", res.via, res.error);
          return Response.json({ error: `Falha ao enviar e-mail (${res.via}).` }, { status: 502 });
        }

        return Response.json({ ok: true });
      },
    },
  },
});
