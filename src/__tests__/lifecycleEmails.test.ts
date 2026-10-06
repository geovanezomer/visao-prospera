// ============================================================================
// Testes de e-mails de ciclo de vida (past_due, trial_ending, canceled).
//
// Banco real em memória (PGlite); mailer stubado.
//
// Cobre:
//   • Resolução do destinatário — subscriptions → user
//   • Dedupe de 24h por (kind, subscriptionId) via email_log
//   • Falha do envio não propaga (sendLifecycleEmail devolve {sent:false})
//   • Ausência de envio configurado é silenciosa
//   • Template do painel tem prioridade; template desativado cai no fallback
// ============================================================================

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";

process.env.APP_URL ??= "https://app.example.com";

type Mail = { to: string; subject: string; html: string };
let mails: Mail[] = [];
let mailResult: { sent: boolean; via: "smtp" | "resend" | "none"; error?: string } = {
  sent: true,
  via: "smtp",
};
vi.mock("@/lib/mailer.server", () => ({
  sendMail: async (m: Mail) => {
    mails.push(m);
    return mailResult;
  },
  isMailConfigured: () => true,
}));

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => t.close());

beforeEach(async () => {
  await t.client.exec('TRUNCATE "email_log", "email_templates", "subscriptions", "user" CASCADE');
  mails = [];
  mailResult = { sent: true, via: "smtp" };
});

async function seedSubscriber(subId: string, email: string, name: string) {
  const [u] = await t.db.insert(schema.user).values({ email, name }).returning();
  await t.db.insert(schema.subscriptions).values({
    userId: u.id,
    stripeSubscriptionId: subId,
    priceId: "pro",
    plan: "pro",
    status: "active",
  });
  return u;
}

const mod = () => import("@/lib/payments/lifecycleEmails.server");

describe("sendLifecycleEmail", () => {
  test("resolve e-mail via subscriptions→user e envia", async () => {
    const { sendLifecycleEmail, resolveSubscriberEmail } = await mod();
    const u = await seedSubscriber("sub_1", "cliente@example.com", "Ana");

    const resolved = await resolveSubscriberEmail("sub_1");
    expect(resolved).toEqual({ email: "cliente@example.com", name: "Ana", userId: u.id });

    const res = await sendLifecycleEmail(
      "payment_failed",
      resolved!.email,
      { name: resolved!.name, plan: "pro", portal_url: "https://portal.example/x" },
      "sub_1",
    );
    expect(res.sent).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("cliente@example.com");
    expect(mails[0].subject).toContain("pagamento");
    expect(mails[0].html).toContain("https://portal.example/x");

    const log = await t.db.select().from(schema.emailLog);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "payment_failed", subscriptionId: "sub_1" });
    // Guarda só o hash do destinatário, nunca o e-mail.
    expect(log[0].sentToHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("dedupe: segundo envio dentro de 24h não envia", async () => {
    const { sendLifecycleEmail } = await mod();
    const first = await sendLifecycleEmail("payment_failed", "c@x.com", {}, "sub_1");
    const second = await sendLifecycleEmail("payment_failed", "c@x.com", {}, "sub_1");
    expect(first.sent).toBe(true);
    expect(second).toEqual({ sent: false, reason: "deduped" });
    expect(mails).toHaveLength(1);
  });

  test("envio com mais de 24h não conta para o dedupe", async () => {
    const { sendLifecycleEmail } = await mod();
    await t.db.insert(schema.emailLog).values({
      kind: "payment_failed",
      subscriptionId: "sub_1",
      sentToHash: "x",
      sentAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });
    const res = await sendLifecycleEmail("payment_failed", "c@x.com", {}, "sub_1");
    expect(res.sent).toBe(true);
  });

  test("dedupe é por (kind, subscriptionId) — kind diferente passa", async () => {
    const { sendLifecycleEmail } = await mod();
    await sendLifecycleEmail("payment_failed", "c@x.com", {}, "sub_1");
    const other = await sendLifecycleEmail("trial_ending", "c@x.com", {}, "sub_1");
    expect(other.sent).toBe(true);
    expect(mails).toHaveLength(2);
  });

  test("falha do envio não lança — devolve {sent:false} e não registra no log", async () => {
    const { sendLifecycleEmail } = await mod();
    mailResult = { sent: false, via: "resend", error: "500 boom" };
    const res = await sendLifecycleEmail("payment_failed", "c@x.com", {}, "sub_1");
    expect(res).toEqual({ sent: false, reason: "resend-failed" });
    expect(await t.db.select().from(schema.emailLog)).toHaveLength(0);
  });

  test("sem envio configurado → não envia, sem erro", async () => {
    const { sendLifecycleEmail } = await mod();
    mailResult = { sent: false, via: "none" };
    const res = await sendLifecycleEmail("trial_ending", "c@x.com", {}, "sub_1");
    expect(res).toEqual({ sent: false, reason: "no-config" });
    expect(await t.db.select().from(schema.emailLog)).toHaveLength(0);
  });

  test("template customizado no banco tem prioridade sobre fallback", async () => {
    const { sendLifecycleEmail } = await mod();
    await t.db.insert(schema.emailTemplates).values({
      kind: "trial_ending",
      subject: "CUSTOM {{name}}",
      html: "<p>fim em {{trial_end}}</p>",
      enabled: true,
    });
    await sendLifecycleEmail("trial_ending", "c@x.com", { name: "Zé", trial_end: "10/07" }, "s");
    expect(mails[0].subject).toBe("CUSTOM Zé");
    expect(mails[0].html).toContain("fim em 10/07");
  });

  test("template desativado → usa o fallback", async () => {
    const { sendLifecycleEmail } = await mod();
    await t.db.insert(schema.emailTemplates).values({
      kind: "trial_ending",
      subject: "CUSTOM",
      html: "x",
      enabled: false,
    });
    await sendLifecycleEmail("trial_ending", "c@x.com", { trial_end: "10/07" }, "s");
    expect(mails[0].subject).toBe("Seu teste do FinnancePRO termina em breve");
  });

  test("resolveSubscriberEmail retorna null para subscription desconhecida", async () => {
    const { resolveSubscriberEmail } = await mod();
    expect(await resolveSubscriberEmail("sub_unknown")).toBeNull();
  });
});
