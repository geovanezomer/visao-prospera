// ============================================================================
// Admin · Settings de notificações (Slack/E-mail) — get/update/test.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail } from "./constants";

function assertAdmin(claims: any) {
  if (!isAdminEmail((claims?.email as string) ?? "")) throw new Error("Acesso negado.");
}

export type NotifSettings = {
  slackWebhookUrl: string | null;
  emailTo: string | null;
  events: { signup: boolean; churn: boolean; past_due: boolean; webhook_failure: boolean };
};

export const getNotifSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("notification_settings").select("*").eq("id", 1).maybeSingle();
    const events = (data?.events as any) ?? { signup: true, churn: true, past_due: true, webhook_failure: true };
    return {
      slackWebhookUrl: data?.slack_webhook_url ?? null,
      emailTo: data?.email_to ?? null,
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof schema>) => schema.parse(data))
  .handler(async ({ data, context }) => {
    assertAdmin(context.claims);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("notification_settings")
      .update({
        slack_webhook_url: data.slackWebhookUrl ?? null,
        email_to: data.emailTo ?? null,
        events: data.events as any,
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as any)?.email,
      action: "notify.settings_update",
      resource: "notify",
    });
    return { ok: true };
  });

export const testNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertAdmin(context.claims);
    const { notifyAdmin } = await import("./notify.server");
    const r = await notifyAdmin({
      event: "signup",
      title: "Teste de notificação",
      body: `Disparado por ${(context.claims as any)?.email ?? "admin"} em ${new Date().toLocaleString("pt-BR")}.`,
    });
    return r;
  });
