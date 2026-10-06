// ============================================================================
// POST /api/feedback — envia sugestões/feedback via Resend API.
//
// Configuração (lida do ambiente do servidor — .env do VPS/Docker):
//   - RESEND_API_KEY     → API key gerada em https://resend.com/api-keys
//   - FEEDBACK_FROM      → remetente verificado (ex.: "App <no-reply@dom.com>")
//   - FEEDBACK_TO        → destinatário das sugestões
//
// Chamada via fetch direto à API REST do Resend (sem SDK) — funciona no
// runtime Worker/Edge e em Node sem dependências extras.
// ============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clientIp, rlConsume, tooManyRequests } from "@/lib/rateLimit.server";

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
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.FEEDBACK_FROM;
        const to = process.env.FEEDBACK_TO;

        if (!apiKey || !from || !to) {
          return Response.json(
            {
              error:
                "Servidor de e-mail não configurado. Defina RESEND_API_KEY, FEEDBACK_FROM e FEEDBACK_TO no .env.",
            },
            { status: 503 },
          );
        }

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
            <h2 style="margin:0 0 12px;">Nova sugestão — FinancePRO</h2>
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

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: `[Sugestão] ${subject}`,
            html,
            text,
            reply_to: to,
          }),
        });

        if (!resendRes.ok) {
          const errText = await resendRes.text();
          // Não vaza o corpo bruto do Resend ao cliente — apenas status.
          console.error("[feedback] Resend error:", resendRes.status, errText);
          return Response.json(
            { error: `Falha ao enviar e-mail (Resend ${resendRes.status}).` },
            { status: 502 },
          );
        }

        const data = (await resendRes.json()) as { id?: string };
        return Response.json({ ok: true, id: data.id });
      },
    },
  },
});
