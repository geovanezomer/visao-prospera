// ============================================================================
// lifecycleEmails — e-mails de ciclo de vida da assinatura (past_due,
// trial_ending, subscription_canceled) enviados ao próprio cliente.
//
// Envio pelo mailer central (SMTP próprio ou Resend — ver mailer.server).
// `getTemplate` e `renderTemplate` vivem aqui e são reusados pelo
// webhook-handler e pelo refund.
//
// Dedupe: (kind, subscriptionId) em janela de 24h via email_log —
// evita reenvio quando o Stripe reencaminha `invoice.payment_failed` várias
// vezes durante o ciclo de retry de cobrança.
//
// Falhas de envio NUNCA propagam — o webhook não pode ser bloqueado por um
// e-mail que caiu; caller sempre chama dentro de try/catch e loga.
// ============================================================================

import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { sendMail } from "@/lib/mailer.server";
import type { ProviderName } from "./types";

// ─── Helpers de e-mail (SSOT — o webhook-handler importa daqui) ─────────────

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

/** Template do painel (email_templates), só se estiver habilitado. */
export async function getTemplate(
  kind: string,
): Promise<{ subject: string; html: string; text: string | null; enabled: boolean } | null> {
  const [row] = await db()
    .select({
      subject: schema.emailTemplates.subject,
      html: schema.emailTemplates.html,
      text: schema.emailTemplates.text,
      enabled: schema.emailTemplates.enabled,
    })
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.kind, kind))
    .limit(1);
  return row?.enabled ? row : null;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export type LifecycleKind = "payment_failed" | "trial_ending" | "subscription_canceled";

type LifecycleVars = {
  name?: string;
  plan?: string;
  amount?: string;
  portal_url?: string;
  plans_url?: string;
  trial_end?: string;
  access_end?: string;
};

/** Dedupe: kind + subscriptionId em janela de 24h. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function alreadySentRecently(
  kind: LifecycleKind,
  subscriptionId: string | null,
): Promise<boolean> {
  if (!subscriptionId) return false;
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const [row] = await db()
    .select({ id: schema.emailLog.id })
    .from(schema.emailLog)
    .where(
      and(
        eq(schema.emailLog.kind, kind),
        eq(schema.emailLog.subscriptionId, subscriptionId),
        gte(schema.emailLog.sentAt, since),
      ),
    )
    .limit(1);
  return !!row;
}

async function recordSent(
  kind: LifecycleKind,
  subscriptionId: string | null,
  toHash: string,
): Promise<void> {
  try {
    await db().insert(schema.emailLog).values({
      kind,
      subscriptionId,
      sentToHash: toHash,
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[lifecycleEmail] recordSent falhou (ignorado):", e);
  }
}

/**
 * Fallbacks HTML/subject mínimos usados quando não há template no banco.
 * Recebem já vars aplicadas via renderTemplate.
 */
function fallbackTemplate(kind: LifecycleKind): { subject: string; html: string } {
  switch (kind) {
    case "payment_failed":
      return {
        subject: "Não conseguimos processar seu pagamento — Finnance",
        html: `<h1>Olá {{name}}</h1><p>Não conseguimos processar sua última cobrança do plano <strong>{{plan}}</strong> no valor de <strong>{{amount}}</strong>.</p><p>Você tem <strong>7 dias</strong> para atualizar sua forma de pagamento antes do bloqueio do acesso.</p><p><a href="{{portal_url}}">Atualizar forma de pagamento</a></p>`,
      };
    case "trial_ending":
      return {
        subject: "Seu teste do Finnance termina em breve",
        html: `<h1>Olá {{name}}</h1><p>Seu período de teste termina em <strong>{{trial_end}}</strong>.</p><p><a href="{{plans_url}}">Ver planos</a></p>`,
      };
    case "subscription_canceled":
      return {
        subject: "Sua assinatura foi cancelada — Finnance",
        html: `<h1>Olá {{name}}</h1><p>Confirmamos o cancelamento da sua assinatura. Seu acesso permanece ativo até <strong>{{access_end}}</strong>. Seus dados permanecem no seu dispositivo.</p><p><a href="{{plans_url}}">Ver planos</a></p>`,
      };
  }
}

/**
 * Resolve o e-mail do assinante a partir de subscriptionId → user_id → user.
 * Retorna null se qualquer etapa falhar (sem lançar).
 */
export async function resolveSubscriberEmail(
  subscriptionId: string,
): Promise<{ email: string; name: string; userId: string } | null> {
  try {
    const [row] = await db()
      .select({ userId: schema.user.id, email: schema.user.email, name: schema.user.name })
      .from(schema.subscriptions)
      .innerJoin(schema.user, eq(schema.user.id, schema.subscriptions.userId))
      .where(eq(schema.subscriptions.stripeSubscriptionId, subscriptionId))
      .limit(1);
    if (!row?.email) return null;
    const name = row.name?.trim() || row.email.split("@")[0] || "Cliente";
    return { email: row.email, name, userId: row.userId };
  } catch (e) {
    console.warn("[lifecycleEmail] resolveSubscriberEmail falhou:", e);
    return null;
  }
}

/**
 * Gera URL do Portal do Cliente server-side (sem depender de sessão do
 * usuário) — usado no e-mail payment_failed para o cliente clicar direto.
 */
export async function buildPortalUrl(
  provider: ProviderName,
  customerId: string,
): Promise<string | null> {
  try {
    const { buildProvider } = await import("./index");
    const p = await buildProvider(provider);
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    const returnUrl = appUrl ? `${appUrl}/app` : "https://finnance.app/app";
    const { url } = await p.createPortal({ customerId, returnUrl });
    return url;
  } catch (e) {
    console.warn("[lifecycleEmail] buildPortalUrl falhou:", e);
    return null;
  }
}

/**
 * Envia e-mail de ciclo de vida. `subscriptionId` é usado para dedupe 24h.
 * Nunca lança — todas as falhas são logadas.
 */
export async function sendLifecycleEmail(
  kind: LifecycleKind,
  to: string,
  vars: LifecycleVars,
  subscriptionId: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  if (!to) return { sent: false, reason: "no-recipient" };
  try {
    if (await alreadySentRecently(kind, subscriptionId)) {
      return { sent: false, reason: "deduped" };
    }

    const merged: Record<string, string> = {
      name: vars.name ?? to.split("@")[0],
      plan: vars.plan ?? "",
      amount: vars.amount ?? "",
      portal_url: vars.portal_url ?? "",
      plans_url:
        vars.plans_url ?? `${(process.env.APP_URL || "").replace(/\/$/, "")}/landing#planos`,
      trial_end: vars.trial_end ?? "",
      access_end: vars.access_end ?? "",
    };

    const tpl = await getTemplate(kind);
    const fb = fallbackTemplate(kind);
    const subject = renderTemplate(tpl?.subject ?? fb.subject, merged);
    const html = renderTemplate(tpl?.html ?? fb.html, merged);

    const res = await sendMail({ to, subject, html });
    if (!res.sent) {
      if (res.via === "none") return { sent: false, reason: "no-config" };
      console.warn(`[lifecycleEmail] envio via ${res.via} falhou: ${res.error ?? "?"}`);
      return { sent: false, reason: `${res.via}-failed` };
    }
    await recordSent(kind, subscriptionId, await hashEmail(to));
    return { sent: true };
  } catch (e) {
    console.warn(`[lifecycleEmail] ${kind} falhou:`, e);
    return { sent: false, reason: "exception" };
  }
}
