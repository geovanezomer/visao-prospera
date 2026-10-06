// ============================================================================
// Envio de e-mail — único ponto de saída do sistema.
//
// Ordem de preferência:
//   1. SMTP próprio (SMTP_HOST etc.) — sem custo, pode ser o mesmo servidor
//      de e-mail configurado no Odoo do cliente.
//   2. Resend (email_settings.resend_api_key ou RESEND_API_KEY) — opcional.
//   3. Nenhum configurado: registra no log e devolve `sent: false`. Útil em
//      desenvolvimento, onde o link aparece no console.
// ============================================================================
import nodemailer, { type Transporter } from "nodemailer";

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

export type MailResult = { sent: boolean; via: "smtp" | "resend" | "none"; error?: string };

let transport: Transporter | null = null;

function smtpTransport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transport = nodemailer.createTransport({
      host,
      port,
      secure: (process.env.SMTP_SECURE ?? (port === 465 ? "true" : "false")) === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });
  }
  return transport;
}

/** Remetente padrão: MAIL_FROM, ou o configurado no painel (email_settings). */
async function defaultSender(): Promise<{ from: string | null; resendKey: string | null }> {
  let from = process.env.MAIL_FROM ?? null;
  let resendKey = process.env.RESEND_API_KEY ?? null;
  try {
    const { db, schema } = await import("@/db/client.server");
    const [cfg] = await db().select().from(schema.emailSettings).limit(1);
    if (cfg) {
      if (!from && cfg.fromEmail) {
        from = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;
      }
      resendKey = cfg.resendApiKey || resendKey;
    }
  } catch {
    /* sem banco (ex.: testes unitários) — segue com o ambiente */
  }
  return { from, resendKey };
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  const { from: fallbackFrom, resendKey } = await defaultSender();
  const from = msg.from ?? fallbackFrom ?? "nao-responda@localhost";

  const smtp = smtpTransport();
  if (smtp) {
    try {
      await smtp.sendMail({ ...msg, from });
      return { sent: true, via: "smtp" };
    } catch (e) {
      return { sent: false, via: "smtp", error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        reply_to: msg.replyTo,
      }),
    });
    if (res.ok) return { sent: true, via: "resend" };
    return { sent: false, via: "resend", error: `${res.status} ${await res.text()}` };
  }

  console.warn(`[mailer] nenhum envio configurado — e-mail para ${maskEmail(msg.to)} não enviado.`);
  return { sent: false, via: "none" };
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST || process.env.RESEND_API_KEY);
}

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  return `${(u ?? "").slice(0, 2)}***@${d ?? ""}`;
}
