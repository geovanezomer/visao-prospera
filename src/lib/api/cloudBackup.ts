// Backup silencioso do arquivo .finnance no servidor da aplicação.
// Chamado após cada salvamento local — não bloqueia o fluxo principal.
// Erros são silenciosos para o usuário (não interrompem o save local).
//
// Wrapper do navegador: mantém a API antiga (com `userId`) para não mexer nos
// componentes, mas o servidor SEMPRE usa o usuário da sessão — o `userId`
// recebido aqui é ignorado.
//
// Controle por env var CLOUD_BACKUP ("ON" padrão | "OFF" desativa) —
// nome mantido por compatibilidade com o vite.config.

import {
  deleteBackupFn,
  downloadBackupFn,
  listBackupsFn,
  uploadBackupFn,
} from "./cloudBackup.functions";

export type BackupStatus = "idle" | "syncing" | "synced" | "error" | "offline";

/**
 * Checa se backup está habilitado via env `CLOUD_BACKUP` (default: ON).
 * A variável é injetada em build-time via `define` no vite.config.
 */
export function isBackupEnabled(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>).CLOUD_BACKUP ?? "ON";
  const v = String(raw).trim().toUpperCase();
  return v !== "OFF" && v !== "FALSE" && v !== "0";
}

/** Grava (ou sobrescreve) o backup `filename` do usuário logado. */
export async function uploadBackup(_userId: string, filename: string, blob: Blob): Promise<void> {
  const content = await blob.text();
  await uploadBackupFn({ data: { filename, content } });
}

/** Lista os backups do usuário logado, mais recentes primeiro. */
export async function listBackups(
  _userId: string,
): Promise<Array<{ name: string; updatedAt: string | null }>> {
  return listBackupsFn();
}

/** Baixa um backup pelo nome. Retorna o texto JSON do arquivo. */
export async function downloadBackup(_userId: string, filename: string): Promise<string> {
  const { content } = await downloadBackupFn({ data: { filename } });
  return content;
}

/** Remove um backup pelo nome. */
export async function deleteBackup(_userId: string, filename: string): Promise<void> {
  await deleteBackupFn({ data: { filename } });
}
