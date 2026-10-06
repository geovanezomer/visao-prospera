// ============================================================================
// Notify Admin — envia alertas via Slack (webhook) e/ou e-mail (sendMail).
// Throttle simples: deduplicação por chave nos últimos 5 minutos via
// admin_audit_log (resource='notify').
// ============================================================================
type EventKind = "signup" | "churn" | "past_due" | "webhook_failure";

export type NotifyPayload = {
  event: EventKind;
  title: string;
  body: string;
  dedupKey?: string;
};

export async function notifyAdmin(
  payload: NotifyPayload,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { db, schema } = await import("@/db/client.server");
    const { and, eq, gte } = await import("drizzle-orm");
    const [cfg] = await db()
      .select()
      .from(schema.notificationSettings)
      .where(eq(schema.notificationSettings.id, 1))
      .limit(1);
    if (!cfg) return { sent: false, reason: "no-config" };
    const events = (cfg.events as Record<string, boolean>) ?? {};
    if (events[payload.event] === false) return { sent: false, reason: "event-disabled" };

    // Dedup
    if (payload.dedupKey) {
      const since = new Date(Date.now() - 5 * 60_000).toISOString();
      const t = schema.adminAuditLog;
      const dupe = await db()
        .select({ id: t.id })
        .from(t)
        .where(
          and(
            eq(t.resource, "notify"),
            eq(t.targetLabel, payload.dedupKey),
            gte(t.createdAt, since),
          ),
        )
        .limit(1);
      if (dupe.length > 0) return { sent: false, reason: "dedup" };
    }

    const tasks: Promise<unknown>[] = [];

    if (cfg.slackWebhookUrl) {
      tasks.push(
        fetch(cfg.slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*[${payload.event.toUpperCase()}] ${payload.title}*\n${payload.body}`,
          }),
        }).catch((e) => console.error("[notify] slack falhou", e)),
      );
    }

    if (cfg.emailTo) {
      const { sendMail } = await import("@/lib/mailer.server");
      tasks.push(
        sendMail({
          to: cfg.emailTo,
          subject: `[Finnance] ${payload.title}`,
          html: `<h3>${payload.title}</h3><p>${payload.body.replace(/\n/g, "<br/>")}</p><p style="color:#888;font-size:12px">Evento: ${payload.event}</p>`,
          text: `${payload.title}\n\n${payload.body}\n\nEvento: ${payload.event}`,
        })
          .then((r) => {
            if (!r.sent && r.error) console.error("[notify] email falhou", r.error);
          })
          .catch((e) => console.error("[notify] email falhou", e)),
      );
    }

    await Promise.all(tasks);

    // registra para dedup
    await db()
      .insert(schema.adminAuditLog)
      .values({
        action: `notify.${payload.event}`,
        resource: "notify",
        targetLabel: payload.dedupKey ?? payload.title,
        metadata: { title: payload.title },
      });

    return { sent: tasks.length > 0 };
  } catch (e) {
    console.error("[notify] erro:", e);
    return { sent: false, reason: "exception" };
  }
}

export type NotificationSettings = {
  slackWebhookUrl: string | null;
  emailTo: string | null;
  events: Record<EventKind, boolean>;
};
