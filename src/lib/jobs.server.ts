// ============================================================================
// Rotinas agendadas (antes: pg_cron + pg_net chamando endpoints HTTP).
//
// Rodam dentro do próprio app pelo agendador (lib/scheduler.server.ts).
// Os endpoints /api/public/hooks/* continuam disponíveis para disparo
// manual, protegidos por CRON_SECRET, e chamam estas mesmas funções.
// ============================================================================
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { readTrialFlags, trialEndPatch } from "@/lib/trialFlags";
import { deleteAppUser, updateAppUser } from "@/lib/users.server";

/**
 * Remove usuários de trial expirados que NÃO converteram em assinatura paga.
 * Os registros de trial_requests são mantidos: um único teste por e-mail,
 * para sempre.
 */
export async function runTrialCleanup() {
  const now = Date.now();
  // Tolerância de 5 minutos para evitar race com banner client-side.
  const cutoff = new Date(now - 5 * 60_000);
  let deleted = 0;
  let skippedConverted = 0;

  // Só os candidatos: trial ligado e vencido (filtro no banco).
  const candidates = await db()
    .select({
      id: schema.user.id,
      isTrial: schema.user.isTrial,
      trialExpiresAt: schema.user.trialExpiresAt,
    })
    .from(schema.user)
    .where(and(eq(schema.user.isTrial, true), lt(schema.user.trialExpiresAt, cutoff)))
    .limit(10_000);
  const scanned = candidates.length;

  for (const u of candidates) {
    const trial = readTrialFlags(u);
    if (!trial.isTrial) continue;
    const exp = trial.trialExpiresAt ? new Date(trial.trialExpiresAt).getTime() : 0;
    if (!exp || exp > cutoff.getTime()) continue;

    // Se converteu (tem assinatura ativa), nunca deleta — apenas limpa flag.
    const [sub] = await db()
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.userId, u.id),
          inArray(schema.subscriptions.status, ["active", "trialing", "lifetime", "past_due"]),
        ),
      )
      .limit(1);
    if (sub) {
      skippedConverted++;
      await updateAppUser(u.id, trialEndPatch());
      continue;
    }
    try {
      await deleteAppUser(u.id);
      deleted++;
    } catch (e) {
      console.error("[trial-cleanup] deleteUser falhou:", u.id, e instanceof Error ? e.message : e);
    }
  }
  return { ok: true, scanned, deleted, skippedConverted, at: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Reconciliação de checkout: marca como `failed` intenções que ficaram em
// created/redirected além da janela do meio de pagamento sem receber webhook.
// ---------------------------------------------------------------------------
type Window = { minutes: number; label: string };

function windowFor(provider: string | null, paymentMethod: string | null): Window {
  // Métodos rápidos (cartão/Pix) — confirmação em segundos.
  const fast = ["credit_card", "card", "pix", "PIX", "CREDIT_CARD"];
  if (paymentMethod && fast.includes(paymentMethod)) {
    return { minutes: 120, label: `${paymentMethod} 2h` };
  }
  // Boleto Asaas/Stripe — vence em D+3 úteis.
  if (paymentMethod && /boleto|BOLETO/.test(paymentMethod)) {
    return { minutes: 60 * 24 * 4, label: "boleto 4d" };
  }
  if (provider === "asaas") {
    // Asaas sem método conhecido: assume pior caso (boleto), janela 72h.
    return { minutes: 60 * 72, label: "asaas 72h" };
  }
  // Stripe sem método conhecido (cartão é o default no checkout session).
  return { minutes: 120, label: "stripe 2h" };
}

export async function runCheckoutReconcile() {
  const ci = schema.checkoutIntents;
  // Busca candidatos antigos o suficiente para sequer caberem na
  // menor das janelas (2h). Filtramos por janela específica em JS,
  // sem fazer um UPDATE cego que marcaria boletos legítimos como
  // failed prematuramente.
  const minCutoff = new Date(Date.now() - 120 * 60 * 1000).toISOString();
  let candidates: Array<{
    id: string;
    provider: string;
    paymentMethod: string | null;
    updatedAt: string;
  }>;
  try {
    candidates = await db()
      .select({
        id: ci.id,
        provider: ci.provider,
        paymentMethod: ci.paymentMethod,
        updatedAt: ci.updatedAt,
      })
      .from(ci)
      .where(and(inArray(ci.status, ["created", "redirected"]), lt(ci.updatedAt, minCutoff)))
      .limit(500);
  } catch (error) {
    console.error("[reconcile] erro:", error);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, reconciled: 0, scanned: 0 };
  }

  const now = Date.now();
  const toFail: { id: string; label: string }[] = [];
  for (const c of candidates) {
    const w = windowFor(c.provider, c.paymentMethod);
    const ageMin = (now - new Date(c.updatedAt).getTime()) / 60000;
    if (ageMin >= w.minutes) toFail.push({ id: c.id, label: w.label });
  }

  if (toFail.length === 0) {
    return { ok: true, reconciled: 0, scanned: candidates.length };
  }

  // Faz updates em lotes pequenos para evitar transações longas.
  let reconciled = 0;
  const chunkSize = 50;
  for (let i = 0; i < toFail.length; i += chunkSize) {
    const slice = toFail.slice(i, i + chunkSize);
    const ids = slice.map((s) => s.id);
    try {
      const updated = await db()
        .update(ci)
        .set({
          status: "failed",
          lastError: `auto-reconciled (janela: ${slice[0].label})`,
          updatedAt: new Date().toISOString(),
        })
        .where(and(inArray(ci.id, ids), inArray(ci.status, ["created", "redirected"])))
        .returning({ id: ci.id });
      reconciled += updated.length;
    } catch (upErr) {
      console.error("[reconcile] update falhou:", upErr);
    }
  }

  console.log(`[reconcile] ${reconciled} intenções marcadas como failed`);
  return { ok: true, reconciled, scanned: candidates.length };
}

/** Reprocessa webhooks com retry pendente. */
export async function runWebhookRetry(limit = 25) {
  const { runRetryBatch } = await import("@/lib/payments/webhook-handler.server");
  return runRetryBatch(limit);
}
