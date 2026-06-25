// ============================================================================
// Handler comum dos webhooks de pagamento.
//
// - Persiste o estado em public.subscriptions via supabaseAdmin (bypass RLS).
// - Na primeira ativação, gera magic link Supabase e envia via Resend (se
//   configurado). O usuário é criado on-the-fly se ainda não existir.
//
// Arquivo .server.ts: NÃO importar fora de rotas/handlers de webhook.
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

async function getOrCreateUserId(
  admin: any,
  email: string,
): Promise<string | null> {
  if (!email) return null;
  // Tenta achar pelo email
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = list?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) return found.id;
  // Cria sem senha — o usuário entra via magic link
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) {
    console.error("[webhook] createUser falhou:", error.message);
    return null;
  }
  return created.user?.id ?? null;
}

async function sendMagicLink(admin: any, email: string): Promise<void> {
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

  // Envia via Resend (se configurado). Caso contrário, registra no log.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FEEDBACK_FROM || process.env.MAGICLINK_FROM;
  if (!apiKey || !from) {
    console.log("[webhook] magic link gerado (sem envio):", email, actionLink);
    return;
  }
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;">Bem-vindo ao FinancePRO</h2>
      <p>Seu pagamento foi confirmado. Clique no botão abaixo para acessar sua conta:</p>
      <p style="margin:24px 0;">
        <a href="${actionLink}" style="background:#0ea5e9;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Acessar minha conta</a>
      </p>
      <p style="color:#64748b;font-size:13px;">O link expira em 1 hora. Se não funcionar, peça outro pelo botão "Entrar" na tela de login.</p>
    </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: email,
      subject: "Acesso ao FinancePRO",
      html,
    }),
  }).catch((err) => console.error("[webhook] envio Resend falhou:", err));
}

export async function handleNormalizedEvent(
  provider: ProviderName,
  event: NormalizedEvent,
): Promise<void> {
  if (event.type === "ignored") {
    console.log("[webhook] evento ignorado:", event.reason);
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  switch (event.type) {
    case "subscription.activated": {
      const userId = await getOrCreateUserId(supabaseAdmin.auth, event.email);
      if (!userId) {
        console.error("[webhook] sem userId para", event.email);
        return;
      }
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
      // Idempotente: chave única é stripe_subscription_id (reusada para asaas).
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .upsert(row as any, { onConflict: "stripe_subscription_id" });
      if (error) console.error("[webhook] upsert falhou:", error.message);
      await sendMagicLink(supabaseAdmin.auth, event.email);
      return;
    }
    case "subscription.updated": {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan: event.plan,
          price_id: event.plan,
          status: event.status,
          current_period_end: event.currentPeriodEnd,
        })
        .eq("stripe_subscription_id", event.subscriptionId);
      if (error) console.error("[webhook] update falhou:", error.message);
      return;
    }
    case "subscription.canceled": {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", event.subscriptionId);
      if (error) console.error("[webhook] cancel falhou:", error.message);
      return;
    }
    case "subscription.past_due": {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", event.subscriptionId);
      if (error) console.error("[webhook] past_due falhou:", error.message);
      return;
    }
  }
}
