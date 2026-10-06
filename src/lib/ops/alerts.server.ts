// ============================================================================
// Alertas de operação por e-mail (e Slack, se configurado no admin).
//
// A cada 15 min confere a saúde (health.server.ts). Avisa quando um item
// passa a falhar, repete o aviso a cada 24 h enquanto continuar falhando e
// manda um "normalizado" quando volta. Erros novos (assinatura nunca vista)
// geram um aviso próprio. O estado fica em app_settings ("ops_alerts").
//
// Destinatário: notification_settings.email_to (painel do admin); na falta,
// ALERT_EMAIL; na falta, os e-mails dos administradores.
// ============================================================================
import { eq, gt } from "drizzle-orm";
import { collectOpsHealth, type Check } from "./health.server";
import { pruneErrorEvents } from "./errors.server";

const STATE_KEY = "ops_alerts";
const REPEAT_MS = 24 * 3_600_000;

type AlertState = {
  /** Itens em falha: quando começou e quando avisamos pela última vez. */
  failing: Record<string, { since: string; lastSent: string; message: string }>;
  /** Até quando os erros novos já foram avisados. */
  errorsSeenUntil?: string;
};

export type AlertMessage = { subject: string; text: string };

/** Decide os avisos a partir das checagens e do estado anterior (função pura). */
export function planAlerts(
  checks: Check[],
  prev: AlertState,
  now: number,
): { messages: AlertMessage[]; next: AlertState } {
  const next: AlertState = { ...prev, failing: {} };
  const messages: AlertMessage[] = [];
  const iso = new Date(now).toISOString();
  for (const c of checks) {
    // Erros recentes têm aviso próprio (por erro novo), não pelo nível.
    if (c.key === "errors") continue;
    const before = prev.failing[c.key];
    if (c.level === "fail") {
      const due = !before || now - new Date(before.lastSent).getTime() >= REPEAT_MS;
      next.failing[c.key] = {
        since: before?.since ?? iso,
        lastSent: due ? iso : before!.lastSent,
        message: c.message,
      };
      if (due)
        messages.push({
          subject: `${before ? "Continua falhando" : "Falha"}: ${c.label}`,
          text: `${c.label}: ${c.message}${
            before ? `\n\nFalhando desde ${new Date(before.since).toLocaleString("pt-BR")}.` : ""
          }`,
        });
    } else if (before) {
      messages.push({
        subject: `Normalizado: ${c.label}`,
        text: `${c.label} voltou ao normal: ${c.message}`,
      });
    }
  }
  return { messages, next };
}

async function recipients(): Promise<string[]> {
  const { db, schema } = await import("@/db/client.server");
  const [cfg] = await db()
    .select({ emailTo: schema.notificationSettings.emailTo })
    .from(schema.notificationSettings)
    .limit(1);
  const configured = (cfg?.emailTo || process.env.ALERT_EMAIL || "")
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (configured.length) return configured;
  const admins = await db()
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.role, "admin"));
  // admin@localhost (administrador inicial) não recebe e-mail.
  return admins.map((a) => a.email).filter((e) => e && !/@(localhost|[\w.-]+\.local)$/.test(e));
}

async function deliver(msgs: AlertMessage[]): Promise<number> {
  if (!msgs.length) return 0;
  const { db, schema } = await import("@/db/client.server");
  const { sendMail } = await import("@/lib/mailer.server");
  const [cfg] = await db()
    .select({ slack: schema.notificationSettings.slackWebhookUrl })
    .from(schema.notificationSettings)
    .limit(1);
  const to = await recipients();
  const host = process.env.APP_URL ?? "";
  let sent = 0;
  for (const m of msgs) {
    const subject = `[FinnancePRO · operação] ${m.subject}`;
    const text = `${m.text}\n\nPainel: ${host}/admin (aba Status)`;
    for (const addr of to) {
      const r = await sendMail({
        to: addr,
        subject,
        text,
        html: `<p>${m.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p><p style="color:#888;font-size:12px">Painel: ${host}/admin (aba Status)</p>`,
      }).catch(() => ({ sent: false }));
      if (r.sent) sent++;
    }
    if (cfg?.slack) {
      const ok = await fetch(cfg.slack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${subject}*\n${m.text}` }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) sent++;
    }
    if (!to.length && !cfg?.slack) console.warn(`[alerts] sem destinatário: ${subject}`);
  }
  return sent;
}

async function newErrors(since: string | undefined, now: number): Promise<AlertMessage[]> {
  const { db, schema } = await import("@/db/client.server");
  const from = since ?? new Date(now - 15 * 60_000).toISOString();
  const rows = await db()
    .select()
    .from(schema.errorEvents)
    .where(gt(schema.errorEvents.firstSeen, from))
    .limit(10);
  if (!rows.length) return [];
  return [
    {
      subject: `${rows.length} erro(s) novo(s) no sistema`,
      text: rows
        .map((r) => `• [${r.source}] ${r.message}${r.path ? ` (${r.path})` : ""} — ${r.count}x`)
        .join("\n"),
    },
  ];
}

export async function runOpsAlerts(now = Date.now()) {
  const { db, schema } = await import("@/db/client.server");
  const [row] = await db()
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, STATE_KEY));
  const prev = (row?.value as AlertState | undefined) ?? { failing: {} };
  const health = await collectOpsHealth(now);
  const { messages, next } = planAlerts(
    health.checks,
    { ...prev, failing: prev.failing ?? {} },
    now,
  );
  const desde = prev.errorsSeenUntil ?? new Date(now - 15 * 60_000).toISOString();
  messages.push(...(await newErrors(desde, now)));
  next.errorsSeenUntil = new Date(now).toISOString();
  const sent = await deliver(messages);
  // Nada chegou a ninguém (SMTP fora, sem destinatário): não marca como
  // avisado — guarda o estado anterior com o início da janela de erros, e a
  // próxima rodada (15 min) tenta de novo com os mesmos avisos.
  const salvar: AlertState =
    messages.length > 0 && sent === 0
      ? { ...prev, failing: prev.failing ?? {}, errorsSeenUntil: desde }
      : next;
  await db()
    .insert(schema.appSettings)
    .values({ key: STATE_KEY, value: salvar })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: salvar } });
  const pruned = await pruneErrorEvents(30);
  return { level: health.level, alerts: messages.length, sent, pruned, retry: salvar !== next };
}
