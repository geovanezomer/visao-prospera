// ============================================================================
// Handler comum dos webhooks de pagamento.
//
// - Persiste o evento em public.webhook_events (auditoria/replay).
// - Persiste estado em public.subscriptions via supabaseAdmin (bypass RLS).
// - Na primeira ativação, gera magic link Supabase e envia via Resend
//   (preferindo email_settings/email_templates do banco; fallback env).
// ============================================================================

import type { NormalizedEvent, ProviderName, PlanId } from "./types";
import type { AdminClient } from "@/lib/admin/_types";
import { readTrialFlags, trialEndMetadata } from "@/lib/trialFlags";

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

/**
 * Narrowing seguro do payload persistido em `webhook_events.payload`
 * (Json no banco). Lê o `type` discriminante; se ausente, devolve "unknown".
 */
function eventType(ev: NormalizedEvent): string {
  return ev.type ?? "unknown";
}

/**
 * Lê `subscriptionId` quando existir no variant. `subscription.activated`,
 * `updated`, `canceled`, `past_due` e `trial_will_end` o possuem; `ignored` não.
 */
function eventSubscriptionId(ev: NormalizedEvent): string | null {
  return "subscriptionId" in ev ? ev.subscriptionId : null;
}

/**
 * Lê `email` quando existir (atualmente apenas em `subscription.activated`).
 */
function eventEmail(ev: NormalizedEvent): string | null {
  return "email" in ev ? ev.email : null;
}

// Helpers de e-mail vivem em lifecycleEmails.server (SSOT) — importamos aqui
// para manter a mesma renderização usada nos e-mails de ciclo de vida.
import {
  renderTemplate,
  getEmailConfig,
  getTemplate,
  sendLifecycleEmail,
  resolveSubscriberEmail,
  buildPortalUrl,
} from "./lifecycleEmails.server";

/**
 * Resolve o `user_id` a partir do e-mail.
 *
 * Estratégia O(1) via tabela espelho `public.user_emails`, mantida por trigger
 * em `auth.users` (INSERT/UPDATE de email, normalizada para lower()).
 *
 * NOTA: a versão instalada do @supabase/supabase-js (2.106) não expõe
 * `admin.auth.admin.getUserByEmail`. Quando/se disponível em versão futura,
 * o SDK direto pode substituir este SELECT.
 *
 * Fallback (comentado): paginação de `listUsers` — só necessário se a tabela
 * espelho ficar dessincronizada; o trigger + backfill inicial cobrem os casos
 * reais. Se um usuário existe em auth.users mas não em user_emails, o
 * createUser abaixo falhará por e-mail duplicado — sinal claro para
 * reexecutar o backfill.
 */
async function getOrCreateUserId(admin: AdminClient, email: string): Promise<string | null> {
  if (!email) return null;
  const target = email.toLowerCase();

  // 1) Lookup direto no espelho (service_role bypassa RLS).
  const { data: row, error: selErr } = await admin
    .from("user_emails")
    .select("user_id")
    .eq("email", target)
    .maybeSingle();
  if (selErr) {
    console.error("[webhook] user_emails select falhou:", selErr.message);
  }
  if (row?.user_id) return row.user_id as string;

  // 2) Não achou → cria; o trigger em auth.users popula user_emails.
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

async function sendMagicLink(admin: AdminClient, email: string, plan?: string): Promise<void> {
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
    // Etapa 1 P1 / F-06: nunca logar o action_link (contém token de auth).
    console.log(
      "[webhook] magic link gerado (sem envio) para:",
      email.replace(/(.{2}).+(@.+)/, "$1***$2"),
    );
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

// Backoff exponencial: 1m → 5m → 30m → 2h → 12h (depois → dead_letter)
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

function nextDelaySeconds(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return BACKOFF_SECONDS[attempts];
}

async function insertEvent(
  admin: AdminClient,
  provider: ProviderName | "admin",
  event: NormalizedEvent,
  status: "processed" | "failed" | "skipped" | "pending_retry",
  error: string | null,
  attempts: number,
  nextAttemptAt: string | null,
  providerEventId: string | null,
): Promise<string | null> {
  try {
    const historyEntry = {
      at: new Date().toISOString(),
      status,
      attempt: attempts,
      error: error ?? null,
    };
    const { data } = await admin
      .from("webhook_events")
      .insert({
        provider,
        provider_event_id: providerEventId,
        event_type: eventType(event),
        subscription_id: eventSubscriptionId(event),
        customer_email: eventEmail(event),
        status,
        payload: event,
        error,
        attempts,
        last_attempt_at: new Date().toISOString(),
        next_attempt_at: nextAttemptAt,
        attempt_history: [historyEntry],
      })
      .select("id")
      .maybeSingle();
    return data?.id ?? null;
  } catch (e) {
    console.error("[webhook] insertEvent falhou:", e);
    return null;
  }
}

/**
 * FIX P0 — Replay protection.
 * Verifica se um evento (provider, provider_event_id) já foi processado/replayed
 * antes. Devolve `true` quando o caller deve pular (idempotência garantida pelo
 * UNIQUE INDEX `webhook_events_provider_event_unique`).
 */
async function isDuplicateEvent(
  admin: AdminClient,
  provider: ProviderName | "admin",
  providerEventId: string | null,
): Promise<boolean> {
  if (!providerEventId) return false;
  const { data } = await admin
    .from("webhook_events")
    .select("id,status")
    .eq("provider", provider)
    .eq("provider_event_id", providerEventId)
    .in("status", ["processed", "replayed"])
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Executa apenas a lógica de negócio para um evento normalizado.
 * Não escreve em webhook_events — o caller cuida da persistência/retry.
 */
async function runEventLogic(
  admin: AdminClient,
  provider: ProviderName,
  event: NormalizedEvent,
): Promise<void> {
  if (event.type === "ignored") return;
  switch (event.type) {
    case "subscription.activated": {
      const userId = await getOrCreateUserId(admin, event.email);
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
      const { error } = await admin
        .from("subscriptions")
        .upsert(row as DbRow, { onConflict: "stripe_subscription_id" });
      if (error) throw new Error(error.message);

      // ── Conversão de trial → pago: limpa flags de trial e registra timestamp.
      try {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        if (readTrialFlags(u?.user).isTrial) {
          await admin.auth.admin.updateUserById(userId, {
            app_metadata: trialEndMetadata({
              trial_converted_at: new Date().toISOString(),
              trial_converted_plan: event.plan,
            }),
          });
        }
      } catch (e) {
        console.warn("[webhook] limpar flags trial falhou (ignorado):", e);
      }

      // Vincula a intenção de compra (a mais recente do mesmo email/provider
      // ainda não confirmada) ao customer/subscription do provedor.
      try {
        await admin
          .from("checkout_intents")
          .update({
            status: "paid",
            provider_customer_id: event.customerId,
            provider_subscription_id: event.subscriptionId,
            confirmed_at: new Date().toISOString(),
          })
          .eq("provider", provider)
          .eq("email", (event.email || "").toLowerCase())
          .in("status", ["created", "redirected"])
          .order("created_at", { ascending: false })
          .limit(1);
      } catch (e) {
        console.warn("[webhook] vincular intent falhou (ignorado):", e);
      }

      await sendMagicLink(admin, event.email, event.plan);
      const { notifyAdmin } = await import("@/lib/admin/notify.server");
      await notifyAdmin({
        event: "signup",
        title: `Nova assinatura ativada (${event.plan})`,
        body: `Cliente: ${event.email}\nProvider: ${provider}\nSub: ${event.subscriptionId}`,
        dedupKey: `act:${event.subscriptionId}`,
      });
      return;
    }

    case "subscription.updated": {
      const { data, error } = await admin
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
      return;
    }
    case "subscription.canceled": {
      const { data, error } = await admin
        .from("subscriptions")
        .update({ status: "canceled" })
        .eq("stripe_subscription_id", event.subscriptionId)
        .select("id, current_period_end, plan");
      if (error) throw new Error(error.message);
      const row = (data && data[0]) as
        | { current_period_end?: string | null; plan?: string | null }
        | undefined;
      if (!row) {
        console.warn(`[webhook] canceled sem row prévia: ${event.subscriptionId}`);
      }
      const { notifyAdmin } = await import("@/lib/admin/notify.server");
      await notifyAdmin({
        event: "churn",
        title: "Assinatura cancelada (churn)",
        body: `Sub: ${event.subscriptionId}\nProvider: ${provider}`,
        dedupKey: `churn:${event.subscriptionId}`,
      });
      // E-mail ao cliente confirmando o cancelamento e a data de fim de acesso.
      try {
        const sub = await resolveSubscriberEmail(admin, event.subscriptionId);
        if (sub) {
          const accessEnd = row?.current_period_end
            ? new Date(row.current_period_end).toLocaleDateString("pt-BR")
            : "o fim do ciclo atual";
          await sendLifecycleEmail(
            admin,
            "subscription_canceled",
            sub.email,
            { name: sub.name, access_end: accessEnd, plan: row?.plan ?? "" },
            event.subscriptionId,
          );
        }
      } catch (e) {
        console.warn("[webhook] lifecycle canceled falhou (ignorado):", e);
      }
      return;
    }
    case "subscription.past_due": {
      const { data, error } = await admin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", event.subscriptionId)
        .select("id, plan, provider_customer_id, stripe_customer_id");
      if (error) throw new Error(error.message);
      const row = (data && data[0]) as
        | {
            plan?: string | null;
            provider_customer_id?: string | null;
            stripe_customer_id?: string | null;
          }
        | undefined;
      if (!row) {
        console.warn(`[webhook] past_due sem row prévia: ${event.subscriptionId}`);
      }
      const { notifyAdmin } = await import("@/lib/admin/notify.server");
      await notifyAdmin({
        event: "past_due",
        title: "Pagamento atrasado (past_due)",
        body: `Sub: ${event.subscriptionId}\nProvider: ${provider}`,
        dedupKey: `pd:${event.subscriptionId}`,
      });
      // E-mail ao cliente com link do portal (gerado server-side) e prazo de 7 dias.
      try {
        const sub = await resolveSubscriberEmail(admin, event.subscriptionId);
        if (sub) {
          const customerId = row?.provider_customer_id ?? row?.stripe_customer_id ?? null;
          const portalUrl = customerId ? await buildPortalUrl(provider, customerId) : null;
          await sendLifecycleEmail(
            admin,
            "payment_failed",
            sub.email,
            {
              name: sub.name,
              plan: row?.plan ?? "",
              portal_url: portalUrl ?? `${(process.env.APP_URL || "").replace(/\/$/, "")}/app`,
            },
            event.subscriptionId,
          );
        }
      } catch (e) {
        console.warn("[webhook] lifecycle past_due falhou (ignorado):", e);
      }
      return;
    }
    case "subscription.trial_will_end": {
      try {
        const sub = await resolveSubscriberEmail(admin, event.subscriptionId);
        if (sub) {
          const trialEnd = event.trialEnd
            ? new Date(event.trialEnd).toLocaleDateString("pt-BR")
            : "breve";
          await sendLifecycleEmail(
            admin,
            "trial_ending",
            sub.email,
            { name: sub.name, trial_end: trialEnd },
            event.subscriptionId,
          );
        } else {
          console.log(`[webhook] trial_will_end ${event.subscriptionId} — sem e-mail resolvível`);
        }
      } catch (e) {
        console.warn("[webhook] lifecycle trial_will_end falhou (ignorado):", e);
      }
      return;
    }
  }
}

/**
 * Caminho de chegada do webhook. Em falha transitória, agenda retry
 * com backoff exponencial; após esgotar tentativas vai a dead_letter
 * e notifica o admin.
 */
export async function handleNormalizedEvent(
  provider: ProviderName,
  event: NormalizedEvent,
  providerEventId: string | null = null,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // FIX P0 — Replay protection: se o mesmo (provider, provider_event_id)
  // já foi processado, ignora. Defesa em profundidade complementar ao
  // UNIQUE INDEX (que protege contra race conditions concorrentes).
  if (await isDuplicateEvent(supabaseAdmin, provider, providerEventId)) {
    console.log(`[webhook] evento ${provider}/${providerEventId} já processado — replay ignorado`);
    return;
  }

  if (event.type === "ignored") {
    await insertEvent(
      supabaseAdmin,
      provider,
      event,
      "skipped",
      event.reason,
      0,
      null,
      providerEventId,
    );
    return;
  }

  try {
    await runEventLogic(supabaseAdmin, provider, event);
    await insertEvent(supabaseAdmin, provider, event, "processed", null, 1, null, providerEventId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    const delay = nextDelaySeconds(1);
    const next = delay ? new Date(Date.now() + delay * 1000).toISOString() : null;
    const status = delay ? "pending_retry" : "failed";
    await insertEvent(supabaseAdmin, provider, event, status, msg, 1, next, providerEventId);
    if (!delay) {
      try {
        const { notifyAdmin } = await import("@/lib/admin/notify.server");
        await notifyAdmin({
          event: "webhook_failure",
          title: `Webhook falhou (${provider})`,
          body: `Tipo: ${eventType(event)}\nErro: ${msg}`,
          dedupKey: `whf:${provider}:${eventSubscriptionId(event) ?? eventType(event)}`,
        });
      } catch {
        /* noop */
      }
    }
    // Não relança — o status fica registrado e o retry/replay assume.
    console.error("[webhook] processamento falhou:", msg);
  }
}

/**
 * Reprocessa um evento já persistido (worker de retry ou replay manual).
 * Faz lock leve via `locked_at` para evitar processamento concorrente.
 */
export async function reprocessWebhookEventRow(
  eventId: string,
  opts?: {
    manual?: boolean;
    actorId?: string | null;
  },
): Promise<{ ok: boolean; status: string; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Lock leve: só claima se locked_at IS NULL ou expirado (>2min).
  const lockCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claimed, error: lockErr } = await supabaseAdmin
    .from("webhook_events")
    .update({ locked_at: new Date().toISOString() })
    .eq("id", eventId)
    .or(`locked_at.is.null,locked_at.lt.${lockCutoff}`)
    .select("*")
    .maybeSingle();
  if (lockErr) throw new Error(lockErr.message);
  if (!claimed)
    return { ok: false, status: "locked", error: "Evento em processamento por outra rotina." };

  // `claimed` é uma linha de webhook_events tipada pelo schema gerado.
  // Os campos `provider`, `payload`, `attempts` etc. existem no schema;
  // só precisamos narrowar `payload` (jsonb) para `NormalizedEvent`.
  const ev = claimed;
  const provider = ev.provider as ProviderName;
  const payload = ev.payload as NormalizedEvent;
  const newAttempts = (ev.attempts ?? 0) + 1;
  const startedAt = new Date().toISOString();

  try {
    await runEventLogic(supabaseAdmin, provider, payload);
    const finalStatus = opts?.manual ? "replayed" : "processed";
    const history = Array.isArray(ev.attempt_history) ? ev.attempt_history : [];
    history.push({
      at: startedAt,
      status: finalStatus,
      attempt: newAttempts,
      error: null,
      manual: !!opts?.manual,
    });
    await supabaseAdmin
      .from("webhook_events")
      .update({
        status: finalStatus,
        error: null,
        attempts: newAttempts,
        last_attempt_at: startedAt,
        next_attempt_at: null,
        locked_at: null,
        attempt_history: history,
        replayed_at: opts?.manual ? startedAt : ev.replayed_at,
        replayed_by: opts?.manual ? (opts?.actorId ?? null) : ev.replayed_by,
      })
      .eq("id", eventId);
    return { ok: true, status: finalStatus };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    const delay = nextDelaySeconds(newAttempts);
    const next = delay ? new Date(Date.now() + delay * 1000).toISOString() : null;
    const finalStatus = delay ? "pending_retry" : "dead_letter";
    const history = Array.isArray(ev.attempt_history) ? ev.attempt_history : [];
    history.push({
      at: startedAt,
      status: finalStatus,
      attempt: newAttempts,
      error: msg,
      manual: !!opts?.manual,
    });
    await supabaseAdmin
      .from("webhook_events")
      .update({
        status: finalStatus,
        error: msg,
        attempts: newAttempts,
        last_attempt_at: startedAt,
        next_attempt_at: next,
        locked_at: null,
        attempt_history: history,
      })
      .eq("id", eventId);
    if (finalStatus === "dead_letter") {
      try {
        const { notifyAdmin } = await import("@/lib/admin/notify.server");
        await notifyAdmin({
          event: "webhook_failure",
          title: `Webhook em dead-letter (${provider})`,
          body: `Tipo: ${ev.event_type}\nTentativas: ${newAttempts}\nÚltimo erro: ${msg}`,
          dedupKey: `whdl:${eventId}`,
        });
      } catch {
        /* noop */
      }
    }
    return { ok: false, status: finalStatus, error: msg };
  }
}

/**
 * Worker chamado pelo cron: pega lotes de pending_retry maduros.
 */
export async function runRetryBatch(limit = 25): Promise<{
  picked: number;
  ok: number;
  failed: number;
  deadLetter: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  const { data: due } = await supabaseAdmin
    .from("webhook_events")
    .select("id")
    .eq("status", "pending_retry")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const ids = (due ?? []).map((r) => r.id);
  let ok = 0,
    failed = 0,
    deadLetter = 0;
  for (const id of ids) {
    const r = await reprocessWebhookEventRow(id, { manual: false });
    if (r.ok) ok++;
    else if (r.status === "dead_letter") deadLetter++;
    else failed++;
  }
  return { picked: ids.length, ok, failed, deadLetter };
}
