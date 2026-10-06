// ============================================================================
// Handler comum dos webhooks de pagamento.
//
// - Persiste o evento em webhook_events (auditoria/replay/retry).
// - Persiste estado em subscriptions (Drizzle, servidor).
// - Na primeira ativação, cria o usuário (se preciso), gera magic link e
//   envia pelo mailer central (template "magic_link" do painel, se houver).
// ============================================================================

import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import type { NormalizedEvent, ProviderName } from "./types";
import { readTrialFlags, trialEndPatch } from "@/lib/trialFlags";
import { createAppUser, findAppUserByEmail, getAppUser, updateAppUser } from "@/lib/users.server";
import { sendMail } from "@/lib/mailer.server";

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
  getTemplate,
  sendLifecycleEmail,
  resolveSubscriberEmail,
  buildPortalUrl,
} from "./lifecycleEmails.server";

/** Violação de UNIQUE (23505) — postgres-js expõe em `.code`; Drizzle/PGlite às vezes em `.cause.code`. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

function maskEmail(email: string): string {
  return email.replace(/(.{2}).+(@.+)/, "$1***$2");
}

/** Resolve o `user.id` a partir do e-mail; cria a conta (só magic link) se não existir. */
async function getOrCreateUserId(email: string): Promise<string | null> {
  if (!email) return null;
  const existing = await findAppUserByEmail(email);
  if (existing) return existing.id;
  try {
    const created = await createAppUser({ email });
    return created.id;
  } catch (e) {
    // Corrida: outra entrega criou o mesmo usuário entre o SELECT e o INSERT.
    if ((e instanceof Error && e.message === "USER_EXISTS") || isUniqueViolation(e)) {
      return (await findAppUserByEmail(email))?.id ?? null;
    }
    console.error("[webhook] createUser falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function sendMagicLink(email: string, plan?: string): Promise<void> {
  if (!email) return;
  let actionLink: string;
  try {
    const { generateMagicLink } = await import("@/lib/magicLink.server");
    actionLink = await generateMagicLink(email, "/app");
  } catch (e) {
    console.error("[webhook] gerar magic link falhou:", e instanceof Error ? e.message : e);
    return;
  }

  const tpl = await getTemplate("magic_link");
  const name = email.split("@")[0];
  const vars = { name, link: actionLink, plan: plan ?? "" };
  const subject = tpl ? renderTemplate(tpl.subject, vars) : "Acesso ao FinnancePRO";
  const html = tpl
    ? renderTemplate(tpl.html, vars)
    : `<p>Olá ${name}, acesse <a href="${actionLink}">aqui</a>.</p>`;
  const res = await sendMail({ to: email, subject, html }).catch((err) => {
    console.error("[webhook] envio do magic link falhou:", err);
    return null;
  });
  if (res && !res.sent) {
    // Etapa 1 P1 / F-06: nunca logar o link (contém token de auth).
    console.log(
      `[webhook] magic link gerado (sem envio${res.error ? `: ${res.error}` : ""}) para:`,
      maskEmail(email),
    );
  }
}

// Backoff exponencial: 1m → 5m → 30m → 2h → 12h (depois → dead_letter)
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

function nextDelaySeconds(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return BACKOFF_SECONDS[attempts];
}

async function insertEvent(
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
    const [row] = await db()
      .insert(schema.webhookEvents)
      .values({
        provider,
        providerEventId,
        eventType: eventType(event),
        subscriptionId: eventSubscriptionId(event),
        customerEmail: eventEmail(event),
        status,
        payload: event,
        error,
        attempts,
        lastAttemptAt: new Date().toISOString(),
        nextAttemptAt,
        attemptHistory: [historyEntry],
      })
      .returning({ id: schema.webhookEvents.id });
    return row?.id ?? null;
  } catch (e) {
    // Duplicado de evento ignorado (mesmo provider_event_id) — nada a fazer.
    if (!isUniqueViolation(e)) console.error("[webhook] insertEvent falhou:", e);
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
  provider: ProviderName | "admin",
  providerEventId: string | null,
): Promise<boolean> {
  if (!providerEventId) return false;
  const [row] = await db()
    .select({ id: schema.webhookEvents.id })
    .from(schema.webhookEvents)
    .where(
      and(
        eq(schema.webhookEvents.provider, provider),
        eq(schema.webhookEvents.providerEventId, providerEventId),
        inArray(schema.webhookEvents.status, ["processed", "replayed"]),
      ),
    )
    .limit(1);
  return !!row;
}

/** Janela após a qual um claim travado (processo caiu) volta para o worker de retry. */
const CLAIM_LEASE_MS = 2 * 60 * 1000;

/**
 * Reivindica o evento ANTES de rodar a lógica: insere a linha e deixa o
 * UNIQUE (provider, provider_event_id) decidir quem processa. Duas entregas
 * simultâneas do mesmo evento não passam ambas — a segunda recebe 23505.
 *
 * O estado "em processamento" é `pending_retry` com `locked_at` agora e
 * `next_attempt_at` no fim da janela: se o processo cair no meio, o worker
 * de retry retoma o evento sozinho depois de CLAIM_LEASE_MS.
 *
 * Retorna o id da linha, ou null se outro processamento já é dono do evento.
 */
async function claimEvent(
  provider: ProviderName,
  event: NormalizedEvent,
  providerEventId: string,
): Promise<string | null> {
  const now = new Date();
  try {
    const [row] = await db()
      .insert(schema.webhookEvents)
      .values({
        provider,
        providerEventId,
        eventType: eventType(event),
        subscriptionId: eventSubscriptionId(event),
        customerEmail: eventEmail(event),
        status: "pending_retry",
        payload: event,
        attempts: 0,
        lockedAt: now.toISOString(),
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS).toISOString(),
        attemptHistory: [],
      })
      .returning({ id: schema.webhookEvents.id });
    if (!row?.id) throw new Error("claim do evento não retornou id");
    return row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw new Error(`claim do evento falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Fecha um evento reivindicado com o resultado da primeira tentativa. */
async function finalizeClaim(
  id: string,
  status: "processed" | "failed" | "pending_retry",
  error: string | null,
  nextAttemptAt: string | null,
): Promise<void> {
  const at = new Date().toISOString();
  try {
    await db()
      .update(schema.webhookEvents)
      .set({
        status,
        error,
        attempts: 1,
        lastAttemptAt: at,
        nextAttemptAt,
        lockedAt: null,
        attemptHistory: [{ at, status, attempt: 1, error }],
      })
      .where(eq(schema.webhookEvents.id, id));
  } catch (e) {
    console.error("[webhook] finalizeClaim falhou:", e instanceof Error ? e.message : e);
  }
}

/**
 * Executa apenas a lógica de negócio para um evento normalizado.
 * Não escreve em webhook_events — o caller cuida da persistência/retry.
 */
async function runEventLogic(provider: ProviderName, event: NormalizedEvent): Promise<void> {
  if (event.type === "ignored") return;
  const subs = schema.subscriptions;
  const nowIso = () => new Date().toISOString();
  switch (event.type) {
    case "subscription.activated": {
      const userId = await getOrCreateUserId(event.email);
      if (!userId) throw new Error(`sem userId para ${event.email}`);
      const row = {
        userId,
        provider,
        providerCustomerId: event.customerId,
        stripeCustomerId: provider === "stripe" ? event.customerId : null,
        stripeSubscriptionId: event.subscriptionId,
        plan: event.plan,
        priceId: event.plan,
        status: "active",
        currentPeriodEnd: event.currentPeriodEnd,
        cancelAtPeriodEnd: false,
      };
      await db()
        .insert(subs)
        .values(row)
        .onConflictDoUpdate({
          target: subs.stripeSubscriptionId,
          set: { ...row, updatedAt: nowIso() },
        });
      const { invalidateSubscriptionCache } =
        await import("@/lib/requireActiveSubscription.server");
      invalidateSubscriptionCache(userId);

      // ── Conversão de trial → pago: limpa flags de trial e registra timestamp.
      try {
        const u = await getAppUser(userId);
        if (readTrialFlags(u).isTrial) {
          await updateAppUser(userId, trialEndPatch({ plan: event.plan }));
        }
      } catch (e) {
        console.warn("[webhook] limpar flags trial falhou (ignorado):", e);
      }

      // Vincula a intenção de compra (a mais recente do mesmo email/provider
      // ainda não confirmada) ao customer/subscription do provedor.
      try {
        const ci = schema.checkoutIntents;
        const [intent] = await db()
          .select({ id: ci.id })
          .from(ci)
          .where(
            and(
              eq(ci.provider, provider),
              eq(sql`lower(${ci.email})`, (event.email || "").toLowerCase()),
              inArray(ci.status, ["created", "redirected"]),
            ),
          )
          .orderBy(desc(ci.createdAt))
          .limit(1);
        if (intent) {
          await db()
            .update(ci)
            .set({
              status: "paid",
              providerCustomerId: event.customerId,
              providerSubscriptionId: event.subscriptionId,
              confirmedAt: nowIso(),
              updatedAt: nowIso(),
            })
            .where(eq(ci.id, intent.id));
        }
      } catch (e) {
        console.warn("[webhook] vincular intent falhou (ignorado):", e);
      }

      await sendMagicLink(event.email, event.plan);
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
      const rows = await db()
        .update(subs)
        .set({
          plan: event.plan,
          priceId: event.plan,
          status: event.status,
          currentPeriodEnd: event.currentPeriodEnd,
          updatedAt: nowIso(),
        })
        .where(eq(subs.stripeSubscriptionId, event.subscriptionId))
        .returning({ id: subs.id, userId: subs.userId });
      if (rows.length === 0) {
        console.warn(`[webhook] updated sem row prévia: ${event.subscriptionId} (ignorado)`);
      }
      await invalidateCacheFor(rows);
      return;
    }
    case "subscription.canceled": {
      const rows = await db()
        .update(subs)
        .set({ status: "canceled", updatedAt: nowIso() })
        .where(eq(subs.stripeSubscriptionId, event.subscriptionId))
        .returning({
          id: subs.id,
          userId: subs.userId,
          currentPeriodEnd: subs.currentPeriodEnd,
          plan: subs.plan,
        });
      const row = rows[0];
      if (!row) {
        console.warn(`[webhook] canceled sem row prévia: ${event.subscriptionId}`);
      }
      await invalidateCacheFor(rows);
      const { notifyAdmin } = await import("@/lib/admin/notify.server");
      await notifyAdmin({
        event: "churn",
        title: "Assinatura cancelada (churn)",
        body: `Sub: ${event.subscriptionId}\nProvider: ${provider}`,
        dedupKey: `churn:${event.subscriptionId}`,
      });
      // E-mail ao cliente confirmando o cancelamento e a data de fim de acesso.
      try {
        const sub = await resolveSubscriberEmail(event.subscriptionId);
        if (sub) {
          const accessEnd = row?.currentPeriodEnd
            ? new Date(row.currentPeriodEnd).toLocaleDateString("pt-BR")
            : "o fim do ciclo atual";
          await sendLifecycleEmail(
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
      const rows = await db()
        .update(subs)
        .set({ status: "past_due", updatedAt: nowIso() })
        .where(eq(subs.stripeSubscriptionId, event.subscriptionId))
        .returning({
          id: subs.id,
          userId: subs.userId,
          plan: subs.plan,
          providerCustomerId: subs.providerCustomerId,
          stripeCustomerId: subs.stripeCustomerId,
        });
      const row = rows[0];
      if (!row) {
        console.warn(`[webhook] past_due sem row prévia: ${event.subscriptionId}`);
      }
      await invalidateCacheFor(rows);
      const { notifyAdmin } = await import("@/lib/admin/notify.server");
      await notifyAdmin({
        event: "past_due",
        title: "Pagamento atrasado (past_due)",
        body: `Sub: ${event.subscriptionId}\nProvider: ${provider}`,
        dedupKey: `pd:${event.subscriptionId}`,
      });
      // E-mail ao cliente com link do portal (gerado server-side) e prazo de 7 dias.
      try {
        const sub = await resolveSubscriberEmail(event.subscriptionId);
        if (sub) {
          const customerId = row?.providerCustomerId ?? row?.stripeCustomerId ?? null;
          const portalUrl = customerId ? await buildPortalUrl(provider, customerId) : null;
          await sendLifecycleEmail(
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
        const sub = await resolveSubscriberEmail(event.subscriptionId);
        if (sub) {
          const trialEnd = event.trialEnd
            ? new Date(event.trialEnd).toLocaleDateString("pt-BR")
            : "breve";
          await sendLifecycleEmail(
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

/** Mudança de status vale na hora para o gate do servidor (cache de 60s). */
async function invalidateCacheFor(rows: Array<{ userId: string }>): Promise<void> {
  if (rows.length === 0) return;
  const { invalidateSubscriptionCache } = await import("@/lib/requireActiveSubscription.server");
  for (const r of rows) invalidateSubscriptionCache(r.userId);
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
  if (event.type === "ignored") {
    if (await isDuplicateEvent(provider, providerEventId)) return;
    await insertEvent(provider, event, "skipped", event.reason, 0, null, providerEventId);
    return;
  }

  // Replay protection atômica: com provider_event_id, o claim no UNIQUE
  // decide quem processa. Sem ele (provedor não manda id), não há como
  // deduplicar — processa e registra.
  let claimId: string | null = null;
  if (providerEventId) {
    claimId = await claimEvent(provider, event, providerEventId);
    if (!claimId) {
      console.log(`[webhook] evento ${provider}/${providerEventId} já reivindicado — ignorado`);
      return;
    }
  }

  try {
    await runEventLogic(provider, event);
    if (claimId) await finalizeClaim(claimId, "processed", null, null);
    else await insertEvent(provider, event, "processed", null, 1, null, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    const delay = nextDelaySeconds(1);
    const next = delay ? new Date(Date.now() + delay * 1000).toISOString() : null;
    const status = delay ? "pending_retry" : "failed";
    if (claimId) await finalizeClaim(claimId, status, msg, next);
    else await insertEvent(provider, event, status, msg, 1, next, null);
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

type AttemptEntry = {
  at: string;
  status: string;
  attempt: number;
  error: string | null;
  manual?: boolean;
};

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
  const we = schema.webhookEvents;
  // Lock leve (atômico): só claima se locked_at IS NULL ou expirado (>2min).
  const lockCutoff = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  const [ev] = await db()
    .update(we)
    .set({ lockedAt: new Date().toISOString() })
    .where(and(eq(we.id, eventId), or(isNull(we.lockedAt), lt(we.lockedAt, lockCutoff))))
    .returning();
  if (!ev)
    return { ok: false, status: "locked", error: "Evento em processamento por outra rotina." };

  const provider = ev.provider as ProviderName;
  const payload = ev.payload as NormalizedEvent;
  const newAttempts = (ev.attempts ?? 0) + 1;
  const startedAt = new Date().toISOString();
  const history: AttemptEntry[] = Array.isArray(ev.attemptHistory)
    ? (ev.attemptHistory as AttemptEntry[])
    : [];

  try {
    await runEventLogic(provider, payload);
    const finalStatus = opts?.manual ? "replayed" : "processed";
    history.push({
      at: startedAt,
      status: finalStatus,
      attempt: newAttempts,
      error: null,
      manual: !!opts?.manual,
    });
    await db()
      .update(we)
      .set({
        status: finalStatus,
        error: null,
        attempts: newAttempts,
        lastAttemptAt: startedAt,
        nextAttemptAt: null,
        lockedAt: null,
        attemptHistory: history,
        replayedAt: opts?.manual ? startedAt : ev.replayedAt,
        replayedBy: opts?.manual ? (opts?.actorId ?? null) : ev.replayedBy,
      })
      .where(eq(we.id, eventId));
    return { ok: true, status: finalStatus };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    const delay = nextDelaySeconds(newAttempts);
    const next = delay ? new Date(Date.now() + delay * 1000).toISOString() : null;
    const finalStatus = delay ? "pending_retry" : "dead_letter";
    history.push({
      at: startedAt,
      status: finalStatus,
      attempt: newAttempts,
      error: msg,
      manual: !!opts?.manual,
    });
    await db()
      .update(we)
      .set({
        status: finalStatus,
        error: msg,
        attempts: newAttempts,
        lastAttemptAt: startedAt,
        nextAttemptAt: next,
        lockedAt: null,
        attemptHistory: history,
      })
      .where(eq(we.id, eventId));
    if (finalStatus === "dead_letter") {
      try {
        const { notifyAdmin } = await import("@/lib/admin/notify.server");
        await notifyAdmin({
          event: "webhook_failure",
          title: `Webhook em dead-letter (${provider})`,
          body: `Tipo: ${ev.eventType}\nTentativas: ${newAttempts}\nÚltimo erro: ${msg}`,
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
  const we = schema.webhookEvents;
  const nowIso = new Date().toISOString();
  const due = await db()
    .select({ id: we.id })
    .from(we)
    .where(and(eq(we.status, "pending_retry"), lte(we.nextAttemptAt, nowIso)))
    .orderBy(asc(we.nextAttemptAt))
    .limit(limit);

  const ids = due.map((r) => r.id);
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
