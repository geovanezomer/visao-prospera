// ============================================================================
// Saúde da operação: banco, backup, teste de restauração, sincronização do
// Odoo e erros recentes. Usado pelo /api/health (resumo), pelo painel do
// admin (detalhe) e pelos alertas por e-mail (alerts.server.ts).
// ============================================================================
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";

export type Level = "ok" | "warn" | "fail" | "off";

export type Check = {
  key: string;
  label: string;
  level: Level;
  message: string;
  at?: string | null;
};

/** Backup: mais de 26 h sem um dump novo já é atraso (rotina diária). */
export const BACKUP_MAX_AGE_H = 26;
/** Teste de restauração: mensal, com folga. */
export const RESTORE_MAX_AGE_D = 35;
/** Odoo sincroniza de hora em hora; 3 h sem retrato novo é atraso. */
export const ODOO_MAX_AGE_H = 3;

const hoursSince = (iso: string, now: number) => (now - new Date(iso).getTime()) / 3_600_000;

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function checkDatabase(): Promise<Check> {
  try {
    const { queryRows } = await import("@/db/client.server");
    await queryRows(sql`select 1`);
    return { key: "db", label: "Banco de dados", level: "ok", message: "respondendo" };
  } catch (e) {
    return {
      key: "db",
      label: "Banco de dados",
      level: "fail",
      message: e instanceof Error ? e.message.slice(0, 200) : "indisponível",
    };
  }
}

type BackupStatus = { ok: boolean; at: string; file?: string; bytes?: number; message?: string };

export async function checkBackup(now = Date.now()): Promise<Check[]> {
  const dir = process.env.BACKUP_DIR;
  if (!dir)
    return [
      {
        key: "backup",
        label: "Backup diário",
        level: "off",
        message: "BACKUP_DIR não definido (fora do docker compose)",
      },
    ];
  const st = await readJson<BackupStatus>(join(dir, "status.json"));
  const rt = await readJson<BackupStatus>(join(dir, "restore-test.json"));
  const out: Check[] = [];
  if (!st) {
    out.push({
      key: "backup",
      label: "Backup diário",
      level: "fail",
      message: "nenhum backup registrado (serviço `backup` está rodando?)",
    });
  } else if (!st.ok) {
    out.push({
      key: "backup",
      label: "Backup diário",
      level: "fail",
      message: st.message ?? "falhou",
      at: st.at,
    });
  } else {
    const h = hoursSince(st.at, now);
    const size = st.bytes ? ` · ${(st.bytes / 1_048_576).toFixed(1)} MB` : "";
    out.push({
      key: "backup",
      label: "Backup diário",
      level: h > BACKUP_MAX_AGE_H ? "fail" : "ok",
      message:
        h > BACKUP_MAX_AGE_H
          ? `último backup há ${Math.floor(h)} h (atrasado)`
          : `último backup há ${h < 1 ? "menos de 1" : Math.floor(h)} h${size}`,
      at: st.at,
    });
  }
  if (!rt) {
    out.push({
      key: "restore",
      label: "Teste de restauração",
      level: "warn",
      message: "ainda não executado",
    });
  } else {
    const d = hoursSince(rt.at, now) / 24;
    out.push({
      key: "restore",
      label: "Teste de restauração",
      level: !rt.ok ? "fail" : d > RESTORE_MAX_AGE_D ? "warn" : "ok",
      message: !rt.ok
        ? (rt.message ?? "falhou")
        : d > RESTORE_MAX_AGE_D
          ? `último teste há ${Math.floor(d)} dias`
          : (rt.message ?? "ok"),
      at: rt.at,
    });
  }
  return out;
}

export async function checkOdoo(now = Date.now()): Promise<Check> {
  const label = "Sincronização do Odoo";
  try {
    const { readConnection } = await import("@/lib/odoo/sync.server");
    const row = await readConnection();
    if (row?.dataSource !== "odoo")
      return { key: "odoo", label, level: "off", message: "modo manual" };
    if (row.lastSyncStatus === "error")
      return {
        key: "odoo",
        label,
        level: "fail",
        message: row.lastError?.slice(0, 300) ?? "falhou",
        at: row.lastSyncAt,
      };
    if (!row.lastSyncAt)
      return { key: "odoo", label, level: "warn", message: "ainda não sincronizado" };
    const h = hoursSince(row.lastSyncAt, now);
    return {
      key: "odoo",
      label,
      level: h > ODOO_MAX_AGE_H ? "fail" : "ok",
      message:
        h > ODOO_MAX_AGE_H
          ? `último retrato há ${Math.floor(h)} h (atrasado)`
          : `último retrato há ${Math.max(1, Math.round(h * 60))} min`,
      at: row.lastSyncAt,
    };
  } catch (e) {
    return {
      key: "odoo",
      label,
      level: "warn",
      message: e instanceof Error ? e.message.slice(0, 200) : "não verificado",
    };
  }
}

export async function checkErrors(): Promise<Check> {
  try {
    const { queryRows } = await import("@/db/client.server");
    const [r] = await queryRows<{ grupos: number; total: number }>(sql`
      select count(*)::int as grupos, coalesce(sum(count), 0)::int as total
      from error_events where last_seen > now() - interval '24 hours'
    `);
    const grupos = Number(r?.grupos ?? 0);
    return {
      key: "errors",
      label: "Erros (24 h)",
      level: grupos === 0 ? "ok" : "warn",
      message: grupos === 0 ? "nenhum erro" : `${grupos} tipo(s), ${r?.total ?? 0} ocorrência(s)`,
    };
  } catch {
    return { key: "errors", label: "Erros (24 h)", level: "warn", message: "não verificado" };
  }
}

export async function collectOpsHealth(now = Date.now()) {
  const [db, backup, odoo, errors] = await Promise.all([
    checkDatabase(),
    checkBackup(now),
    checkOdoo(now),
    checkErrors(),
  ]);
  const checks = [db, ...backup, odoo, errors];
  const level: Level = checks.some((c) => c.level === "fail")
    ? "fail"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return { level, checks, checkedAt: new Date(now).toISOString() };
}
