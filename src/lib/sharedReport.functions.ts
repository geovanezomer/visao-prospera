// Server function pública (sem requireSupabaseAuth) que devolve o snapshot
// read-only de um share. O bucket é privado — usa service role para baixar
// após validar expires_at/revoked_at na tabela de controle.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ShareSnapshot } from "@/engines/sharing/types";

const inputSchema = z.object({ shareId: z.string().min(1).max(64) });

export const getSharedSnapshot = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<ShareSnapshot | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("shared_reports")
      .select("storage_path, expires_at, revoked_at")
      .eq("share_id", data.shareId)
      .maybeSingle();

    if (error || !row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

    const { data: file, error: dlError } = await supabaseAdmin.storage
      .from("shared-reports")
      .download(row.storage_path);
    if (dlError || !file) return null;

    try {
      const text = await file.text();
      return JSON.parse(text) as ShareSnapshot;
    } catch {
      return null;
    }
  });
