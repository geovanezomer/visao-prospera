// ============================================================================
// Admin · Settings de notificações (Slack/E-mail) — get/update/test.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { eq } from "drizzle-orm";
import { actorEmail } from "./_types";

export type NotifEvents = {
  signup: boolean;
  churn: boolean;
  past_due: boolean;
  webhook_failure: boolean;
};
export type NotifSettings = {
  slackWebhookUrl: string | null;
  emailTo: string | null;
  events: NotifEvents;
};

const DEFAULT_EVENTS: NotifEvents = {
  signup: true,
  churn: true,
  past_due: true,
  webhook_failure: true,
};

export const getNotifSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    const [data] = await db()
      .select()
      .from(schema.notificationSettings)
      .where(eq(schema.notificationSettings.id, 1))
      .limit(1);
    const events = (data?.events as NotifEvents | null) ?? DEFAULT_EVENTS;
    return {
      slackWebhookUrl: data?.slackWebhookUrl ?? null,
      emailTo: data?.emailTo ?? null,
      events,
    } as NotifSettings;
  });

const schema = z.object({
  slackWebhookUrl: z.string().url().nullable().optional(),
  emailTo: z.string().email().nullable().optional(),
  events: z.object({
    signup: z.boolean(),
    churn: z.boolean(),
    past_due: z.boolean(),
    webhook_failure: z.boolean(),
  }),
});

export const updateNotifSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((data: z.infer<typeof schema>) => schema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { db, schema } = await import("@/db/client.server");
    // Singleton (id = 1): cria a linha se ainda não existir.
    const row = {
      slackWebhookUrl: data.slackWebhookUrl ?? null,
      emailTo: data.emailTo ?? null,
      events: data.events,
      updatedAt: new Date().toISOString(),
    };
    await db()
      .insert(schema.notificationSettings)
      .values({ id: 1, ...row })
      .onConflictDoUpdate({ target: schema.notificationSettings.id, set: row });
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: actorEmail(context),
      action: "notify.settings_update",
      resource: "notify",
    });
    return { ok: true };
  });

export const testNotification = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { notifyAdmin } = await import("./notify.server");
    const r = await notifyAdmin({
      event: "signup",
      title: "Teste de notificação",
      body: `Disparado por ${actorEmail(context) ?? "admin"} em ${new Date().toLocaleString("pt-BR")}.`,
    });
    return r;
  });
