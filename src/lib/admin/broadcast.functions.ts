// ============================================================================
// Broadcasts — disparo segmentado para usuários via mailer (SMTP/Resend).
// Segmentação suportada:
//   - plan: free | starter | pro | lifetime
//   - status: active | trialing | past_due | canceled | none
//   - emails: lista de e-mails específicos (override do filtro)
// Limite prático: 2000 destinatários por broadcast (throttle ~7.5 envios/s).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { desc, eq, inArray } from "drizzle-orm";
import { actorEmail, toSnake, type Json } from "./_types";

const SegmentSchema = z.object({
  plan: z.enum(["all", "free", "starter", "pro", "lifetime"]).optional(),
  status: z.enum(["all", "active", "trialing", "past_due", "canceled", "none"]).optional(),
  emails: z.array(z.string().email()).max(2000).optional(),
});
export type BroadcastSegment = z.infer<typeof SegmentSchema>;

// ----------------------------------------------------------------------------
// previewBroadcastAudience — devolve contagem e amostra (até 20).
// ----------------------------------------------------------------------------
export const previewBroadcastAudience = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { segment: BroadcastSegment }) => z.object({ segment: SegmentSchema }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { recipients } = await resolveAudience(data.segment);
    return { total: recipients.length, sample: recipients.slice(0, 20).map((r) => r.email) };
  });

// ----------------------------------------------------------------------------
// sendBroadcast — registra + envia. Throttling simples: 8 req/s.
// ----------------------------------------------------------------------------
export const sendBroadcast = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { subject: string; html: string; segment: BroadcastSegment }) =>
    z
      .object({
        subject: z.string().min(3).max(200),
        html: z.string().min(10),
        segment: SegmentSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const { sendMail, isMailConfigured } = await import("@/lib/mailer.server");

    const { recipients } = await resolveAudience(data.segment);
    if (recipients.length === 0) throw new Error("Nenhum destinatário encontrado para o segmento.");
    if (recipients.length > 2000) throw new Error("Limite de 2000 destinatários por broadcast.");

    const [cfg] = await db().select().from(schema.emailSettings).limit(1);
    if (!isMailConfigured() && !cfg?.resendApiKey) {
      throw new Error("E-mail não configurado (SMTP ou Resend).");
    }

    const [row] = await db()
      .insert(schema.broadcasts)
      .values({
        subject: data.subject,
        html: data.html,
        segment: data.segment,
        status: "sending",
        totalRecipients: recipients.length,
        createdBy: context.userId,
      })
      .returning({ id: schema.broadcasts.id });
    if (!row) throw new Error("Falha ao registrar broadcast.");

    // Disparo sequencial com pequeno delay para respeitar rate do provedor.
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      try {
        const res = await sendMail({
          to: r.email,
          subject: data.subject,
          html: data.html,
          replyTo: cfg?.replyTo ?? undefined,
        });
        if (res.sent) sent++;
        else failed++;
      } catch {
        failed++;
      }
      await new Promise((res) => setTimeout(res, 130)); // ~7.5 req/s
    }

    await db()
      .update(schema.broadcasts)
      .set({
        status: failed === recipients.length ? "failed" : "sent",
        sentCount: sent,
        failedCount: failed,
        sentAt: new Date().toISOString(),
      })
      .where(eq(schema.broadcasts.id, row.id));

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "broadcast.send",
      resource: "broadcast",
      targetId: row.id,
      metadata: { subject: data.subject, total: recipients.length, sent, failed },
    });
    return { id: row.id, sent, failed, total: recipients.length };
  });

// ----------------------------------------------------------------------------
// listBroadcasts — histórico recente.
// ----------------------------------------------------------------------------
export const listBroadcasts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const t = schema.broadcasts;
    const rows = await db()
      .select({
        id: t.id,
        subject: t.subject,
        status: t.status,
        totalRecipients: t.totalRecipients,
        sentCount: t.sentCount,
        failedCount: t.failedCount,
        createdAt: t.createdAt,
        sentAt: t.sentAt,
        segment: t.segment,
      })
      .from(t)
      .orderBy(desc(t.createdAt))
      .limit(50);
    return { broadcasts: rows.map((r) => toSnake({ ...r, segment: r.segment as Json })) };
  });

// ----------------------------------------------------------------------------
// Helper interno — resolve audiência conforme segmento.
// ----------------------------------------------------------------------------
async function resolveAudience(
  seg: BroadcastSegment,
): Promise<{ recipients: { id: string; email: string }[] }> {
  // Lista de e-mails específicos: override total.
  if (seg.emails && seg.emails.length > 0) {
    return { recipients: seg.emails.map((email) => ({ id: "", email })) };
  }

  const { db, schema } = await import("@/db/client.server");
  const all = await db()
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt));

  const plan = seg.plan && seg.plan !== "all" ? seg.plan : null;
  const status = seg.status && seg.status !== "all" ? seg.status : null;

  // Se filtra por plano/status, precisamos das subscriptions.
  const subByUser = new Map<string, { plan: string | null; status: string }>();
  if ((plan || status) && all.length > 0) {
    const t = schema.subscriptions;
    const subs = await db()
      .select({ userId: t.userId, plan: t.plan, status: t.status })
      .from(t)
      .where(
        inArray(
          t.userId,
          all.map((u) => u.id),
        ),
      )
      .orderBy(desc(t.createdAt));
    for (const s of subs) if (!subByUser.has(s.userId)) subByUser.set(s.userId, s);
  }

  const recipients: { id: string; email: string }[] = [];
  for (const u of all) {
    if (!u.email) continue;
    const s = subByUser.get(u.id);
    if (plan) {
      if (plan === "free" ? !!s?.plan : s?.plan !== plan) continue;
    }
    if (status) {
      if (status === "none" ? !!s?.status : s?.status !== status) continue;
    }
    recipients.push({ id: u.id, email: u.email });
  }
  return { recipients };
}
