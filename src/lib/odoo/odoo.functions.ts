// ============================================================================
// Server functions do conector Odoo.
//
// Admin: configurar a conexão (chave cifrada), testar, ligar a chave seletora
// Manual | Odoo, sincronizar e ajustar a classificação de contas.
// Usuário logado: ler a configuração do cockpit e o retrato mais recente.
//
// Módulos de servidor são importados dentro dos handlers (este arquivo também
// é importado pelo navegador, que só enxerga os stubs das server functions).
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/requireAuth";
import type { AccountOverride, OdooCompanyInfo, OdooSnapshot } from "@/engines/odoo/types";

async function admin(context: { userId: string }) {
  const { assertAdmin } = await import("@/lib/admin/assertAdmin");
  await assertAdmin(context);
}

async function audit(
  context: { userId: string; user?: { email?: string } },
  action: string,
  metadata: Record<string, unknown> = {},
) {
  const { logAudit } = await import("@/lib/admin/audit.server");
  await logAudit({
    actorId: context.userId,
    actorEmail: context.user?.email ?? null,
    action,
    resource: "odoo",
    metadata,
  });
}

export type OdooSettingsView = {
  dataSource: "manual" | "odoo";
  url: string;
  database: string;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  companyIds: number[];
  historyMonths: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
};

export const getOdooSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<OdooSettingsView> => {
    await admin(context);
    const { readConnection } = await import("./sync.server");
    const { decryptSecret, maskSecret } = await import("./secret.server");
    const row = await readConnection();
    let apiKeyMasked: string | null = null;
    if (row?.apiKeyEnc) {
      try {
        apiKeyMasked = maskSecret(decryptSecret(row.apiKeyEnc));
      } catch {
        apiKeyMasked = "(não foi possível decifrar — cadastre de novo)";
      }
    }
    return {
      dataSource: (row?.dataSource as "manual" | "odoo") ?? "manual",
      url: row?.url ?? "",
      database: row?.database ?? "",
      hasApiKey: Boolean(row?.apiKeyEnc),
      apiKeyMasked,
      companyIds: (row?.companyIds as number[] | undefined) ?? [],
      historyMonths: row?.historyMonths ?? 24,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastSyncStatus: row?.lastSyncStatus ?? null,
      lastError: row?.lastError ?? null,
    };
  });

const saveSchema = z.object({
  url: z.string().trim().url("URL inválida").max(300),
  database: z.string().trim().min(1, "Informe o banco").max(120),
  /** Vazio = mantém a chave já cadastrada. */
  apiKey: z.string().trim().max(400).optional(),
  companyIds: z.array(z.number().int().positive()).max(200).default([]),
  historyMonths: z.number().int().min(12).max(60).default(24),
});

export const saveOdooSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }) => {
    await admin(context);
    const { db, schema } = await import("@/db/client.server");
    const { encryptSecret } = await import("./secret.server");
    const { normalizeOdooUrl } = await import("./client.server");
    const { readConnection } = await import("./sync.server");
    const current = await readConnection();
    const apiKeyEnc = data.apiKey ? encryptSecret(data.apiKey) : (current?.apiKeyEnc ?? null);
    const values = {
      id: 1,
      url: normalizeOdooUrl(data.url),
      database: data.database,
      apiKeyEnc,
      companyIds: data.companyIds,
      historyMonths: data.historyMonths,
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
    };
    await db()
      .insert(schema.odooConnection)
      .values(values)
      .onConflictDoUpdate({ target: schema.odooConnection.id, set: values });
    await audit(context, "odoo.settings.save", {
      url: values.url,
      database: values.database,
      apiKeyChanged: Boolean(data.apiKey),
      companyIds: data.companyIds,
    });
    return { ok: true };
  });

const testSchema = z.object({
  url: z.string().trim().max(300).optional(),
  database: z.string().trim().max(120).optional(),
  apiKey: z.string().trim().max(400).optional(),
});

export type OdooTestResult =
  | { ok: true; serverVersion: string | null; companies: OdooCompanyInfo[] }
  | { ok: false; error: string };

/** Testa com os dados informados (ou os já salvos, para campos vazios). */
export const testOdooConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => testSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<OdooTestResult> => {
    await admin(context);
    const { readConnection, fetchCompanies } = await import("./sync.server");
    const { decryptSecret } = await import("./secret.server");
    const { odooServerVersion } = await import("./client.server");
    try {
      const row = await readConnection();
      const url = data.url || row?.url;
      const database = data.database || row?.database;
      const apiKey = data.apiKey || (row?.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : "");
      if (!url || !database || !apiKey)
        return { ok: false, error: "Preencha URL, banco e chave de API." };
      const cfg = { url, database, apiKey };
      const companies = await fetchCompanies(cfg);
      return { ok: true, serverVersion: await odooServerVersion(url), companies };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

export const setDataSource = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ mode: z.enum(["manual", "odoo"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await admin(context);
    const { db, schema } = await import("@/db/client.server");
    const { readConnection, latestSnapshot } = await import("./sync.server");
    if (data.mode === "odoo") {
      const row = await readConnection();
      if (!row?.url || !row.apiKeyEnc)
        throw new Error("Configure e teste a conexão antes de ativar o modo Odoo.");
      if (!(await latestSnapshot()))
        throw new Error("Faça a primeira sincronização antes de ativar o modo Odoo.");
    }
    await db()
      .insert(schema.odooConnection)
      .values({ id: 1, dataSource: data.mode, updatedBy: context.userId })
      .onConflictDoUpdate({
        target: schema.odooConnection.id,
        set: {
          dataSource: data.mode,
          updatedAt: new Date().toISOString(),
          updatedBy: context.userId,
        },
      });
    await audit(context, "odoo.data_source", { mode: data.mode });
    return { ok: true, mode: data.mode };
  });

export const syncOdooNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await admin(context);
    const { syncOdoo } = await import("./sync.server");
    const result = await syncOdoo();
    await audit(context, "odoo.sync", { ok: result.ok, error: result.error ?? null });
    return result;
  });

export type AccountClassificationRow = {
  code: string;
  name: string;
  type: string;
  /** Classificação automática (sem o ajuste manual). */
  current: string;
  override: string | null;
  companies: number[];
};

export const listAccountClassifications = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<AccountClassificationRow[]> => {
    await admin(context);
    const { latestSnapshot, loadOverrides } = await import("./sync.server");
    const { classifyAccount } = await import("@/engines/odoo/mapping");
    const snap = await latestSnapshot();
    if (!snap) return [];
    const overrides = await loadOverrides();
    const rows = new Map<string, AccountClassificationRow>();
    for (const [cid, comp] of Object.entries(snap.payload.perCompany)) {
      for (const a of comp.accounts) {
        const r = rows.get(a.code) ?? {
          code: a.code,
          name: a.name,
          type: a.type,
          current: (() => {
            const auto = classifyAccount({ code: a.code, name: a.name, type: a.type });
            return auto.kind === "pl" ? auto.line : auto.kind === "bs" ? auto.bucket : "ignore";
          })(),
          override: overrides.get(a.code) ?? null,
          companies: [],
        };
        r.companies.push(Number(cid));
        rows.set(a.code, r);
      }
    }
    return [...rows.values()].sort((x, y) => x.code.localeCompare(y.code));
  });

const overrideSchema = z.object({
  code: z.string().trim().min(1).max(64),
  /** null remove o ajuste (volta à classificação automática). */
  target: z.string().trim().max(40).nullable(),
});

export const setAccountOverride = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => overrideSchema.parse(d))
  .handler(async ({ data, context }) => {
    await admin(context);
    const { db, schema } = await import("@/db/client.server");
    const { eq } = await import("drizzle-orm");
    const { reclassifyLatestSnapshot } = await import("./reclassify.server");
    if (data.target === null) {
      await db()
        .delete(schema.odooAccountOverrides)
        .where(eq(schema.odooAccountOverrides.code, data.code));
    } else {
      await db()
        .insert(schema.odooAccountOverrides)
        .values({ code: data.code, target: data.target, updatedBy: context.userId })
        .onConflictDoUpdate({
          target: schema.odooAccountOverrides.code,
          set: {
            target: data.target,
            updatedAt: new Date().toISOString(),
            updatedBy: context.userId,
          },
        });
    }
    // Aplica no retrato atual sem consultar o Odoo de novo.
    await reclassifyLatestSnapshot();
    await audit(context, "odoo.account_override", data);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Cockpit (qualquer usuário logado da instância)
// ---------------------------------------------------------------------------

export type CockpitConfig = {
  dataSource: "manual" | "odoo";
  syncedAt: string | null;
  lastSyncStatus: string | null;
};

export const getCockpitConfig = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async (): Promise<CockpitConfig> => {
    const { readConnection } = await import("./sync.server");
    const row = await readConnection();
    return {
      dataSource: (row?.dataSource as "manual" | "odoo") ?? "manual",
      syncedAt: row?.lastSyncAt ?? null,
      lastSyncStatus: row?.lastSyncStatus ?? null,
    };
  });

export const getOdooSnapshot = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ syncedAt: string; snapshot: OdooSnapshot } | null> => {
    const { latestSnapshot } = await import("./sync.server");
    const snap = await latestSnapshot();
    return snap ? { syncedAt: snap.syncedAt, snapshot: snap.payload } : null;
  });

export type { AccountOverride };
