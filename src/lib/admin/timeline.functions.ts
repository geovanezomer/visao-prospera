// ============================================================================
// getUserTimeline — visão 360° do cliente: agrega eventos de múltiplas fontes
// (webhooks, e-mails de lifecycle, auditoria admin, checkouts, assinaturas)
// em uma linha do tempo unificada, ordenada por data desc, limite 100.
//
// Fontes:
//   • webhook_events  → tipo "webhook"    (por customer_email OU subscription_id)
//   • email_log       → tipo "email"      (filtrado por sent_to_hash = SHA-256(email))
//   • admin_audit_log → tipo "admin"      (target_id = userId) — mesma query da AuditTab
//   • checkout_intents→ tipo "checkout"   (por email)
//   • subscriptions   → tipo "assinatura" (created + canceled quando aplicável)
//
// Cada item é normalizado para { at, kind, title, detail?, tone, refId? }
// para simplificar a renderização e o filtro por tipo na UI.
//
// As consultas ficam em timeline.server.ts (server-only, testável com banco).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import { assertAdmin } from "./assertAdmin";

export type TimelineKind = "webhook" | "email" | "admin" | "checkout" | "assinatura";
export type TimelineTone = "ok" | "warn" | "bad" | "neutral";

export type TimelineItem = {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  tone: TimelineTone;
  /** Referência para ações contextuais (ex.: id do webhook_event para replay). */
  refId?: string;
};

// ─── Server fn ──────────────────────────────────────────────────────────────

export const getUserTimeline = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((d: { userId: string; email?: string | null }) =>
    z
      .object({
        userId: z.string().uuid(),
        email: z.string().email().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: TimelineItem[] }> => {
    await assertAdmin(context);
    const { aggregateTimeline } = await import("./timeline.server");
    return { items: await aggregateTimeline(data.userId, data.email ?? null) };
  });
