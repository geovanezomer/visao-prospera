// Operação: captura de erros, saúde (backup/restauração/Odoo) e alertas.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";
import {
  fingerprintOf,
  listErrorEvents,
  pruneErrorEvents,
  recordError,
  redact,
} from "@/lib/ops/errors.server";
import { checkBackup, checkOdoo, collectOpsHealth } from "@/lib/ops/health.server";
import { planAlerts } from "@/lib/ops/alerts.server";

describe("redact", () => {
  it("esconde senha em URL, bearer e chaves", () => {
    expect(redact("postgres://app:segredo@db:5432/x")).toBe("postgres://app:***@db:5432/x");
    expect(redact("Authorization: Bearer abcdef123456789")).toContain("Bearer ***");
    expect(redact('api_key="abc123456789"')).not.toContain("abc123456789");
  });
});

describe("fingerprintOf", () => {
  it("agrupa o mesmo erro com números e ids diferentes", () => {
    const a = fingerprintOf(
      "server",
      "Error: linha 12 falhou id 5f0e1c2a-1111-2222-3333-444455556666",
    );
    const b = fingerprintOf(
      "server",
      "Error: linha 99 falhou id 0a0b0c0d-1111-2222-3333-444455556666",
    );
    expect(a).toBe(b);
    expect(fingerprintOf("client", "Error: linha 12 falhou")).not.toBe(
      fingerprintOf("server", "Error: linha 12 falhou"),
    );
  });
});

describe("error_events no banco", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("registra, agrupa por assinatura e conta ocorrências", async () => {
    await recordError("server", new Error("falhou 1"), { path: "/app" });
    await recordError("server", new Error("falhou 2"), { path: "/app" });
    await recordError("client", new Error("outra coisa"));
    const rows = await listErrorEvents();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === "server")?.count).toBe(2);
  });

  it("apaga erros antigos", async () => {
    await t.db.insert(schema.errorEvents).values({
      fingerprint: "velho",
      source: "server",
      message: "x",
      lastSeen: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    });
    await recordError("server", new Error("recente"));
    expect(await pruneErrorEvents(30)).toBe(1);
    expect(await listErrorEvents()).toHaveLength(1);
  });

  it("saúde do Odoo: manual, falha e atraso", async () => {
    expect((await checkOdoo()).level).toBe("off");
    const now = Date.now();
    await t.db.insert(schema.odooConnection).values({
      id: 1,
      dataSource: "odoo",
      lastSyncAt: new Date(now - 5 * 3_600_000).toISOString(),
      lastSyncStatus: "ok",
    });
    expect((await checkOdoo(now)).level).toBe("fail");
    expect((await checkOdoo(now - 4 * 3_600_000)).level).toBe("ok");
    const h = await collectOpsHealth(now);
    expect(h.checks.find((c) => c.key === "db")?.level).toBe("ok");
    expect(h.level).toBe("fail");
  });
});

describe("checkBackup", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fp-backup-"));
    vi.stubEnv("BACKUP_DIR", dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("sem status: falha", async () => {
    const [b, r] = await checkBackup();
    expect(b.level).toBe("fail");
    expect(r.level).toBe("warn");
  });

  it("recente ok, atrasado falha, teste de restauração com erro falha", async () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    await writeFile(
      join(dir, "status.json"),
      JSON.stringify({ ok: true, at: "2026-10-06T06:00:00Z", bytes: 2_097_152 }),
    );
    await writeFile(
      join(dir, "restore-test.json"),
      JSON.stringify({ ok: false, at: "2026-10-01T06:00:00Z", message: "pg_restore falhou" }),
    );
    const [b, r] = await checkBackup(now);
    expect(b.level).toBe("ok");
    expect(b.message).toContain("2.0 MB");
    expect(r.level).toBe("fail");
    const [late] = await checkBackup(now + 24 * 3_600_000);
    expect(late.level).toBe("fail");
  });

  it("sem BACKUP_DIR: desligado", async () => {
    vi.stubEnv("BACKUP_DIR", "");
    const [b] = await checkBackup();
    expect(b.level).toBe("off");
  });
});

describe("planAlerts", () => {
  const fail = {
    key: "backup",
    label: "Backup diário",
    level: "fail" as const,
    message: "atrasado",
  };
  const ok = { ...fail, level: "ok" as const, message: "ok" };
  const t0 = Date.parse("2026-10-06T00:00:00Z");

  it("avisa na primeira falha, não repete antes de 24 h, repete depois e avisa a volta", () => {
    const a = planAlerts([fail], { failing: {} }, t0);
    expect(a.messages).toHaveLength(1);
    expect(a.messages[0].subject).toMatch(/^Falha/);
    const b = planAlerts([fail], a.next, t0 + 3_600_000);
    expect(b.messages).toHaveLength(0);
    const c = planAlerts([fail], b.next, t0 + 25 * 3_600_000);
    expect(c.messages[0].subject).toMatch(/^Continua falhando/);
    const d = planAlerts([ok], c.next, t0 + 26 * 3_600_000);
    expect(d.messages[0].subject).toMatch(/^Normalizado/);
    expect(d.next.failing).toEqual({});
  });

  it("ignora o item de erros (tem aviso próprio)", () => {
    const r = planAlerts(
      [{ key: "errors", label: "Erros", level: "fail", message: "x" }],
      { failing: {} },
      t0,
    );
    expect(r.messages).toHaveLength(0);
  });
});

describe("isClientAbort", () => {
  it("reconhece desconexão do cliente, inclusive embrulhada em cause", async () => {
    const { isClientAbort } = await import("@/lib/ops/errors.server");
    const abort = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    expect(isClientAbort(abort)).toBe(true);
    expect(isClientAbort(Object.assign(new Error("HTTPError"), { cause: abort }))).toBe(true);
    expect(isClientAbort(new Error("relation does not exist"))).toBe(false);
  });
});
