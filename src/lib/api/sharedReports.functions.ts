// Server functions para criar / ler / revogar links de compartilhamento
// somente leitura do FinnancePRO.
//
// Fluxo:
//   - createShareLink (autenticada): recebe o payload .finnance serializado,
//     gera shareId aleatório, faz upload no bucket `shared-reports` e insere
//     a linha em public.shared_reports.
//   - getSharedReport (pública): valida revoked/expires, baixa o JSON e
//     devolve o payload para a rota /shared/$shareId renderizar read-only.
//   - revokeShareLink (autenticada): marca revoked_at = now() no próprio link.
//
// `supabaseAdmin` é importado dinamicamente dentro do handler para evitar
// vazamento no bundle do cliente (regra tanstack-supabase-import-graph).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "shared-reports";

/** Gera um shareId curto, URL-safe (12 chars base36). */
function generateShareId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

/**
 * Limite duro de tamanho do payload (P4-03): 2 MiB serializados.
 * Um snapshot .finnance típico tem 50–300 KiB; 2 MiB já cobre cenários
 * extremos e bloqueia uploads abusivos (DoS / custo de storage).
 */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

const createSchema = z
  .object({
    // payload .finnance já serializado (objeto JSON).
    payload: z
      .unknown()
      .refine((v) => v != null && typeof v === "object", "payload deve ser um objeto JSON"),
    companyName: z.string().min(1).max(200),
  })
  .superRefine((d, ctx) => {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(d.payload)).length;
      if (bytes > MAX_PAYLOAD_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload"],
          message: `payload excede o limite de ${Math.round(MAX_PAYLOAD_BYTES / 1024)} KiB (recebido: ${Math.round(bytes / 1024)} KiB).`,
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "payload não-serializável",
      });
    }
  });

/** Padrão: 48h de validade do link público (em ms). */
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Enforcement server-side: só assinantes ativos (ou trial válido) podem gerar links.
    const { requireActiveSubscription } = await import("@/lib/requireActiveSubscription.server");
    await requireActiveSubscription(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const shareId = generateShareId();
    const storagePath = `${context.userId}/${shareId}.finnance.json`;
    const json = JSON.stringify(data.payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, blob, { upsert: false, contentType: "application/json" });
    if (upErr) throw new Error(`Falha ao subir arquivo: ${upErr.message}`);

    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

    const { error: dbErr } = await supabaseAdmin.from("shared_reports").insert({
      share_id: shareId,
      owner_id: context.userId,
      storage_path: storagePath,
      company_name: data.companyName,
      expires_at: expiresAt,
    });
    if (dbErr) {
      // rollback do upload se a linha falhar
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
      throw new Error(`Falha ao registrar link: ${dbErr.message}`);
    }

    return { shareId, expiresAt };
  });

const getSchema = z.object({ shareId: z.string().min(4).max(64) });

export const getSharedReport = createServerFn({ method: "GET" })
  .validator((d: unknown) => getSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("shared_reports")
      .select("storage_path, company_name, expires_at, revoked_at")
      .eq("share_id", data.shareId)
      .maybeSingle();
    if (error) throw new Error(`Falha ao consultar link: ${error.message}`);
    if (!row) throw new Error("LINK_NOT_FOUND");
    if (row.revoked_at) throw new Error("LINK_REVOKED");
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("LINK_EXPIRED");
    }

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(row.storage_path);
    if (dlErr || !file) throw new Error(`Falha ao baixar relatório: ${dlErr?.message ?? "?"}`);
    const text = await file.text();
    const payload = JSON.parse(text);

    return {
      payload,
      companyName: row.company_name as string,
      expiresAt: (row.expires_at as string | null) ?? null,
    };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => getSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("shared_reports")
      .update({ revoked_at: new Date().toISOString() })
      .eq("share_id", data.shareId)
      .eq("owner_id", context.userId);
    if (error) throw new Error(`Falha ao revogar: ${error.message}`);
    return { ok: true };
  });

/**
 * Lista os links de compartilhamento ATIVOS do usuário logado
 * (não revogados e não expirados). Usado pelo ícone na header
 * para abrir o gerenciador de links compartilhados.
 */
export const listShareLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("shared_reports")
      .select("share_id, company_name, created_at, expires_at")
      .eq("owner_id", context.userId)
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Falha ao listar links: ${error.message}`);
    return (data ?? []).map((r) => ({
      shareId: r.share_id as string,
      companyName: r.company_name as string,
      createdAt: r.created_at as string,
      expiresAt: (r.expires_at as string | null) ?? null,
    }));
  });

/**
 * Atualiza o prazo de expiração de um link compartilhado.
 * `expiresAt` deve ser um ISO 8601 futuro; `null` remove a expiração.
 */
const updateExpirationSchema = z.object({
  shareId: z.string().min(4).max(64),
  expiresAt: z.string().datetime().nullable(),
});

export const updateShareExpiration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => updateExpirationSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
      throw new Error("A nova expiração deve estar no futuro");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("shared_reports")
      .update({ expires_at: data.expiresAt })
      .eq("share_id", data.shareId)
      .eq("owner_id", context.userId);
    if (error) throw new Error(`Falha ao atualizar expiração: ${error.message}`);
    return { ok: true, expiresAt: data.expiresAt };
  });
