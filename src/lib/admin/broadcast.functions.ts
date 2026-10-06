// ============================================================================
// Broadcasts — disparo segmentado para usuários via Resend.
// Segmentação suportada:
//   - plan: free | starter | pro | lifetime
//   - status: active | trialing | past_due | canceled | none
//   - emails: lista de e-mails específicos (override do filtro)
// Limite prático: 1000 destinatários por broadcast (rate de Resend free ~10 req/s).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

const SegmentSchema = z.object({
  plan: z.enum(["all", "free", "starter", "pro", "lifetime"]).optional(),
  status: z.enum(["all", "active", "trialing", "past_due", "canceled", "none"]).optional(),
  emails: z.array(z.string().email()).max(2000).optional(),
});
export type BroadcastSegment = z.infer<typeof SegmentSchema>;

// ----------------------------------------------------------------------------
// previewBroadcastAudience — devolve contagem e amostra (até 20).
// ----------------------------------------------------------------------------
export const previewBroadcastAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { segment: BroadcastSegment }) => z.object({ segment: SegmentSchema }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { recipients } = await resolveAudience(data.segment);
    return { total: recipients.length, sample: recipients.slice(0, 20).map((r) => r.email) };
  });

// ----------------------------------------------------------------------------
// sendBroadcast — registra + envia. Throttling simples: 8 req/s.
// ----------------------------------------------------------------------------
export const sendBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { subject: string; html: string; segment: BroadcastSegment }) =>
    z
      .object({
        subject: z.string().min(3).max(200),
        html: z.string().min(10),
        segment: SegmentSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { recipients } = await resolveAudience(data.segment);
    if (recipients.length === 0) throw new Error("Nenhum destinatário encontrado para o segmento.");
    if (recipients.length > 2000) throw new Error("Limite de 2000 destinatários por broadcast.");

    const { data: cfg } = await supabaseAdmin
      .from("email_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    const apiKey = cfg?.resend_api_key || process.env.RESEND_API_KEY;
    const fromEmail = cfg?.from_email || process.env.FEEDBACK_FROM;
    const fromName = cfg?.from_name || "Finnance";
    if (!apiKey || !fromEmail) throw new Error("E-mail não configurado (Resend).");
    const from = `${fromName} <${fromEmail}>`;

    const { data: row, error: insErr } = await supabaseAdmin
      .from("broadcasts")
      .insert({
        subject: data.subject,
        html: data.html,
        segment: data.segment,
        status: "sending",
        total_recipients: recipients.length,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (insErr || !row) throw new Error(insErr?.message ?? "Falha ao registrar broadcast.");

    // Disparo sequencial com pequeno delay para respeitar rate Resend.
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: r.email, subject: data.subject, html: data.html }),
        });
        if (res.ok) sent++;
        else failed++;
      } catch {
        failed++;
      }
      await new Promise((res) => setTimeout(res, 130)); // ~7.5 req/s
    }

    await supabaseAdmin
      .from("broadcasts")
      .update({
        status: failed === recipients.length ? "failed" : "sent",
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    const { logAudit } = await import("./audit.server");
    await logAudit({
      actorId: context.userId,
      actorEmail: (context.claims as AuthClaims | undefined)?.email,
      action: "broadcast.send",
      resource: "broadcast",
      targetId: row.id,
      metadata: { subject: data.subject, total: recipients.length, sent, failed },
    });
    return { id: row.id, sent, failed, total: recipients.length };
  });

// ----------------------------------------------------------------------------
// listBroadcasts — histórico recente.
// ----------------------------------------------------------------------------
export const listBroadcasts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("broadcasts")
      .select(
        "id, subject, status, total_recipients, sent_count, failed_count, created_at, sent_at, segment",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { broadcasts: data ?? [] };
  });

// ----------------------------------------------------------------------------
// Helper interno — resolve audiência conforme segmento.
// ----------------------------------------------------------------------------
async function resolveAudience(
  seg: BroadcastSegment,
): Promise<{ recipients: { id: string; email: string }[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Lista de e-mails específicos: override total.
  if (seg.emails && seg.emails.length > 0) {
    return { recipients: seg.emails.map((email) => ({ id: "", email })) };
  }

  // Lê todos os usuários (até 5000).
  const all: Array<{ id: string; email?: string | null }> = [];
  for (let p = 1; p <= 25; p++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: p, perPage: 200 });
    if (error) throw new Error(error.message);
    all.push(...(data.users ?? []));
    if ((data.users ?? []).length < 200) break;
  }

  const plan = seg.plan && seg.plan !== "all" ? seg.plan : null;
  const status = seg.status && seg.status !== "all" ? seg.status : null;

  // Se filtra por plano/status, precisamos das subscriptions.
  const subByUser = new Map<string, { user_id: string; plan: string | null; status: string }>();
  if (plan || status) {
    const ids = all.map((u) => u.id);
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan, status, created_at")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: false });
    for (const s of subs ?? []) if (!subByUser.has(s.user_id)) subByUser.set(s.user_id, s);
  }

  const recipients: { id: string; email: string }[] = [];
  for (const u of all) {
    if (!u.email) continue;
    const s = subByUser.get(u.id);
    if (plan) {
      if (plan === "free" ? !!s?.plan : s?.plan !== plan) continue;
    }
    if (status) {
      if (status === "none" ? !!s?.status : s?.status !== status) continue;
    }
    recipients.push({ id: u.id, email: u.email });
  }
  return { recipients };
}
