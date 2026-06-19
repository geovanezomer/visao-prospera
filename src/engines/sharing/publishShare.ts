// Publica/revoga snapshots compartilhados — chamado apenas pelo consultor autenticado.
import { nanoid } from "nanoid";
import { supabase } from "@/integrations/supabase/client";
import { buildShareSnapshot } from "./buildShareSnapshot";
import type { AppState } from "@/engines/finance/types";

export interface PublishResult {
  shareId: string;
  url: string;
}

export async function publishShare(
  state: AppState,
  userId: string,
  expiresInDays: number | null,
): Promise<PublishResult> {
  const shareId = nanoid(24);
  const snapshot = buildShareSnapshot(state, shareId);
  const path = `${userId}/${shareId}.json`;

  const { error: uploadError } = await supabase.storage
    .from("shared-reports")
    .upload(path, new Blob([JSON.stringify(snapshot)], { type: "application/json" }), {
      contentType: "application/json",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
    : null;

  const { error: dbError } = await supabase.from("shared_reports").insert({
    share_id: shareId,
    owner_id: userId,
    storage_path: path,
    company_name: state.companyName,
    expires_at: expiresAt,
  });
  if (dbError) {
    // Tenta limpar o arquivo órfão se a inserção da row falhar.
    await supabase.storage.from("shared-reports").remove([path]).catch(() => {});
    throw dbError;
  }

  return { shareId, url: `${window.location.origin}/compartilhado/${shareId}` };
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase
    .from("shared_reports")
    .update({ revoked_at: new Date().toISOString() })
    .eq("share_id", shareId);
  if (error) throw error;
}

export interface ActiveShareRow {
  share_id: string;
  company_name: string;
  storage_path: string;
  expires_at: string | null;
  created_at: string;
}

export async function listActiveShares(
  userId: string,
  companyName: string,
): Promise<ActiveShareRow[]> {
  const { data, error } = await supabase
    .from("shared_reports")
    .select("share_id, company_name, storage_path, expires_at, created_at")
    .eq("owner_id", userId)
    .eq("company_name", companyName)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
