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

const createSchema = z.object({
  // payload .finnance já serializado (objeto JSON).
  payload: z.unknown(),
  companyName: z.string().min(1).max(200),
});

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const shareId = generateShareId();
    const storagePath = `${context.userId}/${shareId}.finnance.json`;
    const json = JSON.stringify(data.payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, blob, { upsert: false, contentType: "application/json" });
    if (upErr) throw new Error(`Falha ao subir arquivo: ${upErr.message}`);

    const { error: dbErr } = await supabaseAdmin.from("shared_reports").insert({
      share_id: shareId,
      owner_id: context.userId,
      storage_path: storagePath,
      company_name: data.companyName,
    });
    if (dbErr) {
      // rollback do upload se a linha falhar
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
      throw new Error(`Falha ao registrar link: ${dbErr.message}`);
    }

    return { shareId };
  });

const getSchema = z.object({ shareId: z.string().min(4).max(64) });

export const getSharedReport = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => getSchema.parse(d))
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

    return { payload, companyName: row.company_name as string };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => getSchema.parse(d))
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
