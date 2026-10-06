// ============================================================================
// Server fns: email_settings + email_templates (Resend).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "./assertAdmin";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AuthClaims } from "./_types";

const TEMPLATE_KINDS = [
  "magic_link",
  "receipt",
  "password_reset",
  "refund",
  "welcome",
  "trial_magic_link",
  "payment_failed",
  "trial_ending",
  "subscription_canceled",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export const getEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("email_settings").select("*").limit(1).maybeSingle();
    return {
      id: data?.id ?? null,
      apiKeyMasked: mask(data?.resend_api_key),
      hasApiKey: !!data?.resend_api_key,
      fromEmail: data?.from_email ?? "",
      fromName: data?.from_name ?? "",
      replyTo: data?.reply_to ?? "",
      updatedAt: data?.updated_at ?? null,
    };
  });

export const updateEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { apiKey?: string; fromEmail?: string; fromName?: string; replyTo?: string }) =>
    z
      .object({
        apiKey: z.string().min(8).optional(),
        fromEmail: z.string().email().optional(),
        fromName: z.string().max(120).optional(),
        replyTo: z.string().email().optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("email_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    const patch: {
      updated_at: string;
      updated_by: string | null;
      resend_api_key?: string;
      from_email?: string;
      from_name?: string;
      reply_to?: string | null;
    } = {
      updated_at: new Date().toISOString(),
      updated_by: context.userId ?? null,
    };
    if (data.apiKey) patch.resend_api_key = data.apiKey;
    if (data.fromEmail !== undefined) patch.from_email = data.fromEmail;
    if (data.fromName !== undefined) patch.from_name = data.fromName;
    if (data.replyTo !== undefined) patch.reply_to = data.replyTo || null;
    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("email_settings")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("email_settings").insert(patch);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { to: string }) => z.object({ to: z.string().email() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await supabaseAdmin
      .from("email_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (!s?.resend_api_key || !s?.from_email) throw new Error("Configuração de e-mail incompleta.");
    const from = s.from_name ? `${s.from_name} <${s.from_email}>` : s.from_email;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.resend_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: data.to,
        subject: "Teste — Finnance",
        html: "<p>Este é um e-mail de teste do painel administrativo.</p>",
      }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return { ok: true };
  });

export const listEmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("email_templates").select("*").order("kind");
    if (error) throw new Error(error.message);
    return { templates: data ?? [] };
  });

export const updateEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { kind: TemplateKind; subject: string; html: string; text?: string; enabled?: boolean }) =>
      z
        .object({
          kind: z.enum(TEMPLATE_KINDS),
          subject: z.string().min(1).max(300),
          html: z.string().min(1),
          text: z.string().optional(),
          enabled: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("email_templates")
      .update({
        subject: data.subject,
        html: data.html,
        text: data.text ?? null,
        enabled: data.enabled ?? true,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      })
      .eq("kind", data.kind);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
