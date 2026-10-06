// ============================================================================
// Sincronização Odoo → retrato (odoo_snapshots).
//
// Por empresa, três consultas agregadas no próprio Odoo (formatted_read_group,
// só lançamentos postados): saldo de abertura por conta, movimento mensal por
// conta na janela e — para eliminar operações internas — os mesmos números
// restritos a parceiros que são empresas do grupo. Nenhum lançamento é
// baixado linha a linha.
// ============================================================================
import { desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db/client.server";
import { classifyAccount } from "@/engines/odoo/mapping";
import type {
  AccountOverride,
  OdooAccountSnapshot,
  OdooCompanyInfo,
  OdooCompanySnapshot,
  OdooIntercompanyLine,
  OdooSnapshot,
} from "@/engines/odoo/types";
import { odooCall, odooServerVersion, type OdooConnectionConfig } from "./client.server";
import { decryptSecret } from "./secret.server";

type M2O = [number, string] | false;
type Group = Record<string, unknown> & { "balance:sum"?: number };

const m2oId = (v: unknown): number | null => (Array.isArray(v) ? Number(v[0]) : null);

/** "yyyy-mm" dos últimos `n` meses, terminando no mês de `ref`. */
export function monthRange(n: number, ref = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export async function fetchCompanies(cfg: OdooConnectionConfig): Promise<OdooCompanyInfo[]> {
  const rows = await odooCall<Array<Record<string, unknown>>>(cfg, "res.company", "search_read", {
    domain: [],
    fields: [
      "id",
      "name",
      "vat",
      "parent_id",
      "partner_id",
      "currency_id",
      "fiscalyear_lock_date",
      "hard_lock_date",
    ],
  });
  return rows.map((r) => {
    const locks = [r.fiscalyear_lock_date, r.hard_lock_date].filter(
      (d): d is string => typeof d === "string" && d.length >= 10,
    );
    return {
      id: Number(r.id),
      name: String(r.name),
      vat: typeof r.vat === "string" && r.vat ? r.vat.replace(/\D/g, "") || null : null,
      parentId: m2oId(r.parent_id as M2O),
      partnerId: m2oId(r.partner_id as M2O),
      currency: Array.isArray(r.currency_id) ? String(r.currency_id[1]) : "BRL",
      lockDate: locks.length ? locks.sort().at(-1)! : null,
    };
  });
}

async function groups(
  cfg: OdooConnectionConfig,
  companyId: number,
  domain: unknown[],
  groupby: string[],
): Promise<Group[]> {
  return odooCall<Group[]>(cfg, "account.move.line", "formatted_read_group", {
    domain: [["company_id", "=", companyId], ["parent_state", "=", "posted"], ...domain],
    groupby,
    aggregates: ["balance:sum"],
    context: { allowed_company_ids: [companyId] },
  });
}

async function snapshotCompany(
  cfg: OdooConnectionConfig,
  company: OdooCompanyInfo,
  months: string[],
  partnerToCompany: Map<number, number>,
  overrides: Map<string, AccountOverride["target"]>,
): Promise<OdooCompanySnapshot> {
  const start = `${months[0]}-01`;
  const end = lastDayOfMonth(months[months.length - 1]);
  const idx = new Map(months.map((m, i) => [m, i]));
  const monthOf = (g: Group) => {
    const v = g["date:month"];
    return Array.isArray(v) ? idx.get(String(v[0]).slice(0, 7)) : undefined;
  };

  const [openingG, movesG] = await Promise.all([
    groups(cfg, company.id, [["date", "<", start]], ["account_id"]),
    groups(
      cfg,
      company.id,
      [
        ["date", ">=", start],
        ["date", "<=", end],
      ],
      ["account_id", "date:month"],
    ),
  ]);

  const accounts = new Map<number, { opening: number; monthly: number[] }>();
  const slot = (id: number) => {
    let s = accounts.get(id);
    if (!s) accounts.set(id, (s = { opening: 0, monthly: months.map(() => 0) }));
    return s;
  };
  for (const g of openingG) {
    const id = m2oId(g.account_id);
    if (id) slot(id).opening += Number(g["balance:sum"] ?? 0);
  }
  for (const g of movesG) {
    const id = m2oId(g.account_id);
    const i = monthOf(g);
    if (id && i !== undefined) slot(id).monthly[i] += Number(g["balance:sum"] ?? 0);
  }

  // Operações com outras empresas do grupo (para eliminação).
  const groupPartners = [...partnerToCompany.entries()]
    .filter(([, cid]) => cid !== company.id)
    .map(([pid]) => pid);
  const icLines: OdooIntercompanyLine[] = [];
  if (groupPartners.length) {
    const pDomain = [["partner_id", "in", groupPartners]];
    const [icOpen, icMoves] = await Promise.all([
      groups(cfg, company.id, [...pDomain, ["date", "<", start]], ["partner_id", "account_id"]),
      groups(
        cfg,
        company.id,
        [...pDomain, ["date", ">=", start], ["date", "<=", end]],
        ["partner_id", "account_id", "date:month"],
      ),
    ]);
    const icMap = new Map<string, OdooIntercompanyLine & { accountId: number }>();
    const icSlot = (pid: number, accountId: number) => {
      const key = `${pid}:${accountId}`;
      let s = icMap.get(key);
      if (!s) {
        s = {
          counterpartCompanyId: partnerToCompany.get(pid) ?? 0,
          accountId,
          code: "",
          monthly: months.map(() => 0),
          opening: 0,
        };
        icMap.set(key, s);
      }
      return s;
    };
    for (const g of icOpen) {
      const pid = m2oId(g.partner_id);
      const aid = m2oId(g.account_id);
      if (pid && aid) icSlot(pid, aid).opening += Number(g["balance:sum"] ?? 0);
    }
    for (const g of icMoves) {
      const pid = m2oId(g.partner_id);
      const aid = m2oId(g.account_id);
      const i = monthOf(g);
      if (pid && aid && i !== undefined)
        icSlot(pid, aid).monthly[i] += Number(g["balance:sum"] ?? 0);
    }
    for (const l of icMap.values()) {
      slot(l.accountId); // garante que a conta será lida
      icLines.push(l);
    }
  }

  const ids = [...accounts.keys()];
  const info = ids.length
    ? await odooCall<Array<{ id: number; code: string; name: string; account_type: string }>>(
        cfg,
        "account.account",
        "read",
        {
          ids,
          fields: ["code", "name", "account_type"],
          context: { allowed_company_ids: [company.id] },
        },
      )
    : [];
  const byId = new Map(info.map((a) => [a.id, a]));

  const out: OdooAccountSnapshot[] = [];
  for (const [id, s] of accounts) {
    const raw = byId.get(id);
    if (!raw) continue;
    // O código é por empresa no Odoo 18+: sem código nesta empresa, vem `false`.
    const a = {
      ...raw,
      code: typeof raw.code === "string" && raw.code ? raw.code : `#${id}`,
      name: typeof raw.name === "string" ? raw.name : `Conta ${id}`,
    };
    const allZero = Math.abs(s.opening) < 0.005 && s.monthly.every((v) => Math.abs(v) < 0.005);
    if (allZero) continue;
    out.push({
      id,
      code: a.code,
      name: a.name,
      type: a.account_type,
      cls: classifyAccount({ code: a.code, name: a.name, type: a.account_type }, overrides),
      monthly: s.monthly.map((v) => Math.round(v * 100) / 100),
      opening: Math.round(s.opening * 100) / 100,
    });
  }
  out.sort((x, y) => x.code.localeCompare(y.code));

  const lines = icLines
    .map((l) => ({
      counterpartCompanyId: l.counterpartCompanyId,
      code: (() => {
        const id = (l as unknown as { accountId: number }).accountId;
        const c = byId.get(id)?.code;
        return typeof c === "string" && c ? c : `#${id}`;
      })(),
      monthly: l.monthly.map((v) => Math.round(v * 100) / 100),
      opening: Math.round(l.opening * 100) / 100,
    }))
    .filter((l) => l.code && l.counterpartCompanyId);

  return { accounts: out, intercompany: { lines } };
}

export async function loadOverrides(): Promise<Map<string, AccountOverride["target"]>> {
  const rows = await db().select().from(schema.odooAccountOverrides);
  return new Map(rows.map((r) => [r.code, r.target as AccountOverride["target"]]));
}

/** Monta o retrato completo (não grava). */
export async function buildSnapshot(
  cfg: OdooConnectionConfig,
  opts: { companyIds: number[]; historyMonths: number; ref?: Date },
): Promise<OdooSnapshot> {
  const all = await fetchCompanies(cfg);
  // Seleção: as empresas escolhidas e as filiais delas. Vazio = todas.
  const chosen = opts.companyIds.length
    ? all.filter(
        (c) =>
          opts.companyIds.includes(c.id) || (c.parentId && opts.companyIds.includes(c.parentId)),
      )
    : all;
  if (!chosen.length) throw new Error("Nenhuma empresa do Odoo selecionada.");
  const months = monthRange(Math.min(Math.max(opts.historyMonths, 12), 60), opts.ref);
  const partnerToCompany = new Map(
    chosen.filter((c) => c.partnerId).map((c) => [c.partnerId as number, c.id]),
  );
  const overrides = await loadOverrides();
  const perCompany: OdooSnapshot["perCompany"] = {};
  for (const c of chosen) {
    perCompany[String(c.id)] = await snapshotCompany(cfg, c, months, partnerToCompany, overrides);
  }
  return {
    version: 1,
    syncedAt: new Date().toISOString(),
    serverVersion: await odooServerVersion(cfg.url),
    months,
    companies: chosen,
    perCompany,
  };
}

export async function readConnection() {
  const [row] = await db()
    .select()
    .from(schema.odooConnection)
    .where(eq(schema.odooConnection.id, 1));
  return row ?? null;
}

export async function connectionConfig(): Promise<OdooConnectionConfig> {
  const row = await readConnection();
  if (!row?.url || !row.database || !row.apiKeyEnc)
    throw new Error("Conexão com o Odoo não configurada.");
  return { url: row.url, database: row.database, apiKey: decryptSecret(row.apiKeyEnc) };
}

let running: Promise<SyncResult> | null = null;
export type SyncResult = {
  ok: boolean;
  syncedAt: string;
  durationMs: number;
  companies: number;
  error?: string;
};

/** Sincroniza e grava um retrato. Chamadas simultâneas aguardam a mesma execução. */
export function syncOdoo(): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const now = new Date().toISOString();
    try {
      const row = await readConnection();
      const cfg = await connectionConfig();
      const snapshot = await buildSnapshot(cfg, {
        companyIds: (row?.companyIds as number[] | undefined) ?? [],
        historyMonths: row?.historyMonths ?? 24,
      });
      const durationMs = Date.now() - t0;
      await db()
        .insert(schema.odooSnapshots)
        .values({ status: "ok", durationMs, payload: snapshot });
      await db()
        .update(schema.odooConnection)
        .set({ lastSyncAt: now, lastSyncStatus: "ok", lastError: null })
        .where(eq(schema.odooConnection.id, 1));
      await pruneSnapshots();
      return { ok: true, syncedAt: now, durationMs, companies: snapshot.companies.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const durationMs = Date.now() - t0;
      await db()
        .insert(schema.odooSnapshots)
        .values({ status: "error", durationMs, error: message });
      await db()
        .update(schema.odooConnection)
        .set({ lastSyncAt: now, lastSyncStatus: "error", lastError: message })
        .where(eq(schema.odooConnection.id, 1));
      return { ok: false, syncedAt: now, durationMs, companies: 0, error: message };
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Mantém os 30 retratos mais recentes. */
async function pruneSnapshots(): Promise<void> {
  const keep = await db()
    .select({ syncedAt: schema.odooSnapshots.syncedAt })
    .from(schema.odooSnapshots)
    .orderBy(desc(schema.odooSnapshots.syncedAt))
    .limit(30);
  const cutoff = keep.at(-1)?.syncedAt;
  if (keep.length === 30 && cutoff) {
    await db().delete(schema.odooSnapshots).where(lt(schema.odooSnapshots.syncedAt, cutoff));
  }
}

/** Retrato mais recente com sucesso (ou null). */
export async function latestSnapshot(): Promise<{
  syncedAt: string;
  payload: OdooSnapshot;
} | null> {
  const [row] = await db()
    .select({ syncedAt: schema.odooSnapshots.syncedAt, payload: schema.odooSnapshots.payload })
    .from(schema.odooSnapshots)
    .where(eq(schema.odooSnapshots.status, "ok"))
    .orderBy(desc(schema.odooSnapshots.syncedAt))
    .limit(1);
  return row?.payload ? { syncedAt: row.syncedAt, payload: row.payload as OdooSnapshot } : null;
}
