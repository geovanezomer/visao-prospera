// Backup silencioso do arquivo .finnance no Supabase Storage.
// Chamado após cada salvamento local — não bloqueia o fluxo principal.
// Erros são silenciosos para o usuário (não interrompem o save local).
//
// Controle por env var VITE_SUPABASE_BACKUP ("ON" padrão | "OFF" desativa).

import { supabase } from "@/integrations/supabase/client";

export type BackupStatus = "idle" | "syncing" | "synced" | "error" | "offline";

const BUCKET = "backups";

/**
 * Checa se backup está habilitado via env `SUPABASE_BACKUP` (default: ON).
 * A variável é injetada em build-time via `define` no vite.config.
 */
export function isBackupEnabled(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>).SUPABASE_BACKUP ?? "ON";
  const v = String(raw).trim().toUpperCase();
  return v !== "OFF" && v !== "FALSE" && v !== "0";
}

/**
 * Faz upload do arquivo .finnance para o Supabase Storage.
 * Path: backups/{userId}/{filename}
 * Usa upsert: true — sempre sobrescreve o arquivo anterior.
 */
export async function uploadBackup(userId: string, filename: string, blob: Blob): Promise<void> {
  const path = `${userId}/${filename}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "application/json",
  });
  if (error) throw error;
}

/**
 * Lista os arquivos de backup do usuário.
 * Retorna array com nome e última modificação de cada arquivo.
 */
export async function listBackups(
  userId: string,
): Promise<Array<{ name: string; updatedAt: string | null }>> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(userId, { sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw error;
  return (data ?? []).map((f) => ({
    name: f.name,
    updatedAt: f.updated_at ?? null,
  }));
}

/** Baixa um arquivo de backup pelo nome. Retorna o texto JSON do arquivo. */
export async function downloadBackup(userId: string, filename: string): Promise<string> {
  const path = `${userId}/${filename}`;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data.text();
}

/** Remove um arquivo de backup pelo nome. */
export async function deleteBackup(userId: string, filename: string): Promise<void> {
  const path = `${userId}/${filename}`;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
