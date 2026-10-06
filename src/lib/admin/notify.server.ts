// ============================================================================
// Notify Admin — envia alertas via Slack (webhook) e/ou Resend (e-mail).
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cfg } = await supabaseAdmin
      .from("notification_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (!cfg) return { sent: false, reason: "no-config" };
    const events = (cfg.events as Record<string, boolean>) ?? {};
    if (events[payload.event] === false) return { sent: false, reason: "event-disabled" };

    // Dedup
    if (payload.dedupKey) {
      const since = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: dupe } = await supabaseAdmin
        .from("admin_audit_log")
        .select("id")
        .eq("resource", "notify")
        .eq("target_label", payload.dedupKey)
        .gte("created_at", since)
        .limit(1);
      if (dupe && dupe.length > 0) return { sent: false, reason: "dedup" };
    }

    const tasks: Promise<unknown>[] = [];

    if (cfg.slack_webhook_url) {
      tasks.push(
        fetch(cfg.slack_webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `*[${payload.event.toUpperCase()}] ${payload.title}*\n${payload.body}`,
          }),
        }).catch((e) => console.error("[notify] slack falhou", e)),
      );
    }

    if (cfg.email_to) {
      const { data: emailCfg } = await supabaseAdmin
        .from("email_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      const apiKey = emailCfg?.resend_api_key || process.env.RESEND_API_KEY;
      const fromEmail = emailCfg?.from_email || process.env.FEEDBACK_FROM;
      const fromName = emailCfg?.from_name || "Finnance Admin";
      if (apiKey && fromEmail) {
        tasks.push(
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${fromName} <${fromEmail}>`,
              to: cfg.email_to,
              subject: `[Finnance] ${payload.title}`,
              html: `<h3>${payload.title}</h3><p>${payload.body.replace(/\n/g, "<br/>")}</p><p style="color:#888;font-size:12px">Evento: ${payload.event}</p>`,
            }),
          }).catch((e) => console.error("[notify] email falhou", e)),
        );
      }
    }

    await Promise.all(tasks);

    // registra para dedup
    await supabaseAdmin.from("admin_audit_log").insert({
      action: `notify.${payload.event}`,
      resource: "notify",
      target_label: payload.dedupKey ?? payload.title,
      metadata: { title: payload.title } as unknown as import("@/integrations/supabase/types").Json,
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
