// ============================================================================
// Sincronização Odoo → retrato (odoo_snapshots).
//
// Por empresa, três consultas agregadas no próprio Odoo (formatted_read_group,
// só lançamentos postados): saldo de abertura por conta, movimento mensal por
// conta na janela e — para eliminar operações internas — os mesmos números
// restritos a parceiros que são empresas do grupo. Nenhum lançamento é
// baixado linha a linha.
// ============================================================================
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db, queryRows, schema } from "@/db/client.server";
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
    // Contatos filhos (endereços, pessoas) contam pela empresa-mãe do contato.
    const pDomain = [["partner_id.commercial_partner_id", "in", groupPartners]];
    const [icOpen, icMoves] = await Promise.all([
      groups(
        cfg,
        company.id,
        [...pDomain, ["date", "<", start]],
        ["partner_id.commercial_partner_id", "account_id"],
      ),
      groups(
        cfg,
        company.id,
        [...pDomain, ["date", ">=", start], ["date", "<=", end]],
        ["partner_id.commercial_partner_id", "account_id", "date:month"],
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
      const pid = m2oId(g["partner_id.commercial_partner_id"]);
      const aid = m2oId(g.account_id);
      if (pid && aid) icSlot(pid, aid).opening += Number(g["balance:sum"] ?? 0);
    }
    for (const g of icMoves) {
      const pid = m2oId(g["partner_id.commercial_partner_id"]);
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
  const { BS_BUCKET_LABELS, PL_LINE_LABELS } = await import("@/engines/odoo/mapping");
  const valid = new Set([
    "ignore",
    ...Object.keys(PL_LINE_LABELS),
    ...Object.keys(BS_BUCKET_LABELS),
  ]);
  // Valores antigos/inválidos são ignorados (a conta volta à classificação automática).
  return new Map(
    rows
      .filter((r) => valid.has(r.target))
      .map((r) => [r.code, r.target as AccountOverride["target"]]),
  );
}

const SYNC_DEADLINE_MS = 15 * 60_000;

/** Monta o retrato completo (não grava). */
export async function buildSnapshot(
  cfg: OdooConnectionConfig,
  opts: { companyIds: number[]; historyMonths: number; ref?: Date },
): Promise<OdooSnapshot> {
  const all = await fetchCompanies(cfg);
  // Seleção: as empresas escolhidas e as filiais delas. Vazio = todas.
  // Sobe a árvore de parent_id: filiais de filiais também acompanham a matriz.
  const rootOf = (c: OdooCompanyInfo): number => {
    let cur = c;
    for (let guard = 0; cur.parentId && guard < 20; guard++) {
      const p = all.find((x) => x.id === cur.parentId);
      if (!p) break;
      cur = p;
    }
    return cur.id;
  };
  const chosen = opts.companyIds.length
    ? all.filter((c) => opts.companyIds.includes(c.id) || opts.companyIds.includes(rootOf(c)))
    : all;
  if (!chosen.length) throw new Error("Nenhuma empresa do Odoo selecionada.");
  const months = monthRange(Math.min(Math.max(opts.historyMonths, 12), 60), opts.ref);
  const partnerToCompany = new Map(
    chosen.filter((c) => c.partnerId).map((c) => [c.partnerId as number, c.id]),
  );
  const overrides = await loadOverrides();
  const perCompany: OdooSnapshot["perCompany"] = {};
  const deadline = Date.now() + SYNC_DEADLINE_MS;
  for (const c of chosen) {
    if (Date.now() > deadline) throw new Error("Sincronização excedeu o tempo máximo (15 min).");
    try {
      perCompany[String(c.id)] = await snapshotCompany(cfg, c, months, partnerToCompany, overrides);
    } catch (e) {
      throw new Error(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
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

const LOCK_KEY = 0x0d00_5ec7; // pg_advisory_lock global da sincronização do Odoo

/** Trava consultiva do Postgres numa conexão reservada (null = já travada). */
async function tryLock(): Promise<{ release: () => Promise<void> } | null> {
  const { reserveConnection } = await import("@/db/client.server");
  const conn = await reserveConnection();
  if (!conn) return { release: async () => {} }; // ambiente de teste (PGlite): processo único
  try {
    const [r] = await conn`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
    if (!r?.ok) {
      conn.release();
      return null;
    }
  } catch (e) {
    conn.release();
    throw e;
  }
  return {
    release: async () => {
      try {
        await conn`select pg_advisory_unlock(${LOCK_KEY})`;
      } finally {
        conn.release();
      }
    },
  };
}
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
    // Trava entre processos/réplicas: só uma sincronização por vez no banco.
    const lock = await tryLock();
    if (!lock) {
      return {
        ok: false,
        syncedAt: now,
        durationMs: 0,
        companies: 0,
        error: "Já existe uma sincronização em andamento.",
      };
    }
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
      await pruneSnapshots();
      return { ok: false, syncedAt: now, durationMs, companies: 0, error: message };
    } finally {
      await lock.release();
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Mantém os 10 retratos válidos mais recentes e os erros dos últimos 7 dias. */
async function pruneSnapshots(): Promise<void> {
  const keep = await db()
    .select({ syncedAt: schema.odooSnapshots.syncedAt })
    .from(schema.odooSnapshots)
    .where(eq(schema.odooSnapshots.status, "ok"))
    .orderBy(desc(schema.odooSnapshots.syncedAt))
    .limit(10);
  const cutoff = keep.at(-1)?.syncedAt;
  if (keep.length === 10 && cutoff) {
    await db()
      .delete(schema.odooSnapshots)
      .where(and(eq(schema.odooSnapshots.status, "ok"), lt(schema.odooSnapshots.syncedAt, cutoff)));
  }
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await db()
    .delete(schema.odooSnapshots)
    .where(
      and(eq(schema.odooSnapshots.status, "error"), lt(schema.odooSnapshots.syncedAt, weekAgo)),
    );
}

/** Retrato mais recente com sucesso (ou null). */
export async function latestSnapshot(): Promise<{
  id: number;
  syncedAt: string;
  payload: OdooSnapshot;
} | null> {
  const [row] = await db()
    .select({
      id: schema.odooSnapshots.id,
      syncedAt: schema.odooSnapshots.syncedAt,
      payload: schema.odooSnapshots.payload,
    })
    .from(schema.odooSnapshots)
    .where(eq(schema.odooSnapshots.status, "ok"))
    .orderBy(desc(schema.odooSnapshots.syncedAt))
    .limit(1);
  return row?.payload
    ? { id: Number(row.id), syncedAt: row.syncedAt, payload: row.payload as OdooSnapshot }
    : null;
}

/** Id e revisão do retrato em uso, sem carregar o payload inteiro. */
export async function latestSnapshotMeta(): Promise<{
  id: number;
  syncedAt: string;
  revision: string;
} | null> {
  const rows = await queryRows<{ id: number; synced_at: string | Date; revision: string | null }>(
    sql`select id, synced_at, payload->>'revisedAt' as revision from odoo_snapshots
        where status = 'ok' order by synced_at desc limit 1`,
  );
  const r = rows[0];
  if (!r) return null;
  const syncedAt = r.synced_at instanceof Date ? r.synced_at.toISOString() : String(r.synced_at);
  return { id: Number(r.id), syncedAt, revision: r.revision ?? "0" };
}
