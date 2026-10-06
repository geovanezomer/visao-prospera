// Alerta só conta como avisado quando chega a alguém.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testDb";

const envio = vi.hoisted(() => ({ ok: false, chamadas: 0 }));
vi.mock("@/lib/mailer.server", () => ({
  sendMail: async () => {
    envio.chamadas++;
    return { sent: envio.ok };
  },
}));

const { runOpsAlerts } = await import("@/lib/ops/alerts.server");
const { recordError } = await import("@/lib/ops/errors.server");

describe("runOpsAlerts — entrega", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    process.env.ALERT_EMAIL = "ops@exemplo.com";
    envio.chamadas = 0;
  });
  afterEach(async () => {
    delete process.env.ALERT_EMAIL;
    await t.close();
  });

  it("SMTP fora: não marca como avisado e tenta de novo na próxima rodada", async () => {
    await recordError("server", new Error("falha nova"), { path: "/app" });
    const agora = Date.now();
    envio.ok = false;
    const r1 = await runOpsAlerts(agora);
    expect(r1.alerts).toBeGreaterThan(0);
    expect(r1.sent).toBe(0);
    // Volta o SMTP: o mesmo erro é avisado na rodada seguinte.
    envio.ok = true;
    const r2 = await runOpsAlerts(agora + 15 * 60_000);
    expect(r2.sent).toBeGreaterThan(0);
    // Avisado: a rodada seguinte não repete.
    const r3 = await runOpsAlerts(agora + 30 * 60_000);
    expect(r3.alerts).toBe(0);
  });
});
