// ============================================================================
// Server fns: email_settings + email_templates.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { asc, eq } from "drizzle-orm";
import { toSnake } from "./_types";

const TEMPLATE_KINDS = [
  "magic_link",
  "receipt",
  "password_reset",
  "refund",
  "welcome",
  "trial_magic_link",
  "payment_failed",
  "trial_ending",
  "subscription_canceled",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export const getEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const [data] = await db().select().from(schema.emailSettings).limit(1);
    return {
      id: data?.id ?? null,
      apiKeyMasked: mask(data?.resendApiKey),
      hasApiKey: !!data?.resendApiKey,
      fromEmail: data?.fromEmail ?? "",
      fromName: data?.fromName ?? "",
      replyTo: data?.replyTo ?? "",
      updatedAt: data?.updatedAt ?? null,
    };
  });

export const updateEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { apiKey?: string; fromEmail?: string; fromName?: string; replyTo?: string }) =>
    z
      .object({
        apiKey: z.string().min(8).optional(),
        fromEmail: z.string().email().optional(),
        fromName: z.string().max(120).optional(),
        replyTo: z.string().email().optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.emailSettings;
    const [existing] = await db().select({ id: t.id }).from(t).limit(1);
    const patch: Partial<typeof t.$inferInsert> = {
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId ?? null,
    };
    if (data.apiKey) patch.resendApiKey = data.apiKey;
    if (data.fromEmail !== undefined) patch.fromEmail = data.fromEmail;
    if (data.fromName !== undefined) patch.fromName = data.fromName;
    if (data.replyTo !== undefined) patch.replyTo = data.replyTo || null;
    if (existing?.id) {
      await db().update(t).set(patch).where(eq(t.id, existing.id));
    } else {
      await db().insert(t).values(patch);
    }
    return { ok: true };
  });

export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { to: string }) => z.object({ to: z.string().email() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { sendMail } = await import("@/lib/mailer.server");
    const r = await sendMail({
      to: data.to,
      subject: "Teste — FinnancePRO",
      html: "<p>Este é um e-mail de teste do painel administrativo.</p>",
      text: "Este é um e-mail de teste do painel administrativo.",
    });
    if (!r.sent) {
      throw new Error(
        r.via === "none"
          ? "Nenhum envio configurado (defina SMTP_HOST ou a chave do Resend)."
          : `Falha no envio (${r.via}): ${r.error ?? "erro desconhecido"}`,
      );
    }
    return { ok: true };
  });

export const listEmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const rows = await db()
      .select()
      .from(schema.emailTemplates)
      .orderBy(asc(schema.emailTemplates.kind));
    return { templates: rows.map(toSnake) };
  });

export const updateEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (d: { kind: TemplateKind; subject: string; html: string; text?: string; enabled?: boolean }) =>
      z
        .object({
          kind: z.enum(TEMPLATE_KINDS),
          subject: z.string().min(1).max(300),
          html: z.string().min(1),
          text: z.string().optional(),
          enabled: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    await db()
      .update(schema.emailTemplates)
      .set({
        subject: data.subject,
        html: data.html,
        text: data.text ?? null,
        enabled: data.enabled ?? true,
        updatedAt: new Date().toISOString(),
        updatedBy: context.userId,
      })
      .where(eq(schema.emailTemplates.kind, data.kind));
    return { ok: true };
  });
