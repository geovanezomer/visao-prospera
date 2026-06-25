// ============================================================================
// Handler comum dos webhooks de pagamento.
//
// - Persiste o evento em public.webhook_events (auditoria/replay).
// - Persiste estado em public.subscriptions via supabaseAdmin (bypass RLS).
// - Na primeira ativação, gera magic link Supabase e envia via Resend
//   (preferindo email_settings/email_templates do banco; fallback env).
// ============================================================================

import type { NormalizedEvent, ProviderName, PlanId } from "./types";

type DbRow = {
  user_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  provider: ProviderName;
  provider_customer_id: string | null;
  plan: PlanId;
  price_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

async function getEmailConfig(admin: any) {
  const { data } = await admin.from("email_settings").select("*").limit(1).maybeSingle();
  const apiKey = data?.resend_api_key || process.env.RESEND_API_KEY || null;
  const fromEmail = data?.from_email || process.env.FEEDBACK_FROM || process.env.MAGICLINK_FROM || null;
  const fromName = data?.from_name || "Finnance";
  if (!apiKey || !fromEmail) return null;
  return { apiKey, from: fromName ? `${fromName} <${fromEmail}>` : fromEmail };
}

async function getTemplate(admin: any, kind: string) {
  const { data } = await admin.from("email_templates").select("*").eq("kind", kind).maybeSingle();
  return data?.enabled ? data : null;
}

async function getOrCreateUserId(admin: any, email: string): Promise<string | null> {
  if (!email) return null;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = list?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) return found.id;
  const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) {
    console.error("[webhook] createUser falhou:", error.message);
    return null;
  }
  return created.user?.id ?? null;
}

async function sendMagicLink(admin: any, email: string, plan?: string): Promise<void> {
  if (!email) return;
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  const redirectTo = appUrl ? `${appUrl}/app` : undefined;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) {
    console.error("[webhook] generateLink falhou:", error.message);
    return;
  }
  const actionLink = data?.properties?.action_link;
  if (!actionLink) return;

  const cfg = await getEmailConfig(admin);
  if (!cfg) {
    console.log("[webhook] magic link gerado (sem envio):", email, actionLink);
    return;
  }
  const tpl = await getTemplate(admin, "magic_link");
  const name = email.split("@")[0];
  const vars = { name, link: actionLink, plan: plan ?? "" };
  const subject = tpl ? renderTemplate(tpl.subject, vars) : "Acesso ao Finnance";
  const html = tpl
    ? renderTemplate(tpl.html, vars)
    : `<p>Olá ${name}, acesse <a href="${actionLink}">aqui</a>.</p>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: email, subject, html }),
  }).catch((err) => console.error("[webhook] envio Resend falhou:", err));
}

async function logEvent(
  admin: any,
  provider: ProviderName | "admin",
  event: NormalizedEvent,
  status: "processed" | "failed" | "skipped",
  error?: string,
) {
  try {
    await admin.from("webhook_events").insert({
      provider,
      event_type: (event as any).type ?? "unknown",
      subscription_id: (event as any).subscriptionId ?? null,
      customer_email: (event as any).email ?? null,
      status,
      payload: event,
      error: error ?? null,
    });
  } catch (e) {
    console.error("[webhook] logEvent falhou:", e);
  }
}

export async function handleNormalizedEvent(
  provider: ProviderName,
  event: NormalizedEvent,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (event.type === "ignored") {
    await logEvent(supabaseAdmin, provider, event, "skipped", event.reason);
    return;
  }

  try {
    switch (event.type) {
      case "subscription.activated": {
        const userId = await getOrCreateUserId(supabaseAdmin, event.email);
        if (!userId) throw new Error(`sem userId para ${event.email}`);
        const row: Partial<DbRow> = {
          user_id: userId,
          provider,
          provider_customer_id: event.customerId,
          stripe_customer_id: provider === "stripe" ? event.customerId : null,
          stripe_subscription_id: event.subscriptionId,
          plan: event.plan,
          price_id: event.plan,
          status: "active",
          current_period_end: event.currentPeriodEnd,
          cancel_at_period_end: false,
        };
        const { error } = await supabaseAdmin
          .from("subscriptions")
          .upsert(row as any, { onConflict: "stripe_subscription_id" });
        if (error) throw new Error(error.message);
        await sendMagicLink(supabaseAdmin, event.email, event.plan);
        const { notifyAdmin } = await import("@/lib/admin/notify.server");
        await notifyAdmin({
          event: "signup",
          title: `Nova assinatura ativada (${event.plan})`,
          body: `Cliente: ${event.email}\nProvider: ${provider}\nSub: ${event.subscriptionId}`,
          dedupKey: `act:${event.subscriptionId}`,
        });
        break;
      }
      case "subscription.updated": {
        // Upsert por stripe_subscription_id — se a ativação chegou fora de ordem,
        // criamos a linha mínima (user_id desconhecido ficaria null → não usamos
        // upsert nesse caso; apenas update e log se 0 rows).
        const { data, error } = await supabaseAdmin
          .from("subscriptions")
          .update({
            plan: event.plan,
            price_id: event.plan,
            status: event.status,
            current_period_end: event.currentPeriodEnd,
          })
          .eq("stripe_subscription_id", event.subscriptionId)
          .select("id");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          console.warn(`[webhook] updated sem row prévia: ${event.subscriptionId} (ignorado)`);
        }
        break;
      }
      case "subscription.canceled": {
        const { data, error } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", event.subscriptionId)
          .select("id");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          console.warn(`[webhook] canceled sem row prévia: ${event.subscriptionId}`);
        }
        const { notifyAdmin: n1 } = await import("@/lib/admin/notify.server");
        await n1({
          event: "churn",
          title: "Assinatura cancelada (churn)",
          body: `Sub: ${event.subscriptionId}\nProvider: ${provider}`,
          dedupKey: `churn:${event.subscriptionId}`,
        });
        break;
      }
      case "subscription.past_due": {
        const { data, error } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", event.subscriptionId)
          .select("id");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          console.warn(`[webhook] past_due sem row prévia: ${event.subscriptionId}`);
        }
        const { notifyAdmin: n2 } = await import("@/lib/admin/notify.server");
        await n2({
          event: "past_due",
          title: "Pagamento atrasado (past_due)",
          body: `Sub: ${event.subscriptionId}\nProvider: ${provider}`,
          dedupKey: `pd:${event.subscriptionId}`,
        });
        break;
      }
      case "subscription.past_due": {
        const { data, error } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_subscription_id", event.subscriptionId)
          .select("id");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          console.warn(`[webhook] past_due sem row prévia: ${event.subscriptionId}`);
        }
        break;
      }
      case "subscription.trial_will_end": {
        // Apenas registra o evento; envio de e-mail de aviso pode ser plugado aqui.
        console.log(`[webhook] trial_will_end ${event.subscriptionId} em ${event.trialEnd ?? "?"}`);
        break;
      }
    }
    await logEvent(supabaseAdmin, provider, event, "processed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    console.error("[webhook] processamento falhou:", msg);
    await logEvent(supabaseAdmin, provider, event, "failed", msg);
    throw e;
  }
}
