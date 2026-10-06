// Testes: resolveAccessStatus + isAccessGranted (gate client + gate server)
// e requireActiveSubscription contra o banco real em memória (PGlite).
import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { schema } from "@/db/client.server";
import { resolveAccessStatus } from "@/hooks/useAccessStatus";
import {
  invalidateSubscriptionCache,
  isAccessGranted,
  requireActiveSubscription,
} from "@/lib/requireActiveSubscription.server";

const NOW = new Date("2026-07-03T12:00:00Z").getTime();
const future = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const past = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("resolveAccessStatus", () => {
  const base = {
    hydrated: true,
    subLoading: false,
    isTrial: false,
    trialExpiresAt: null,
    now: NOW,
  };

  it("loading quando não hidratou ou sub carregando", () => {
    expect(resolveAccessStatus({ ...base, hydrated: false, plan: null }).kind).toBe("loading");
    expect(resolveAccessStatus({ ...base, subLoading: true, plan: null }).kind).toBe("loading");
  });

  it("plan active → active", () => {
    const r = resolveAccessStatus({
      ...base,
      plan: {
        plan: "pro",
        status: "active",
        current_period_end: future(24),
        cancel_at_period_end: false,
      },
    });
    expect(r).toMatchObject({ kind: "active", plan: "pro", cancelAtPeriodEnd: false });
  });

  it("plan trialing/lifetime → active", () => {
    expect(
      resolveAccessStatus({
        ...base,
        plan: {
          plan: "starter",
          status: "trialing",
          current_period_end: future(24),
          cancel_at_period_end: false,
        },
      }).kind,
    ).toBe("active");
    expect(
      resolveAccessStatus({
        ...base,
        plan: {
          plan: "lt",
          status: "lifetime",
          current_period_end: null,
          cancel_at_period_end: false,
        },
      }).kind,
    ).toBe("active");
  });

  it("plan past_due → past_due", () => {
    const r = resolveAccessStatus({
      ...base,
      plan: {
        plan: "pro",
        status: "past_due",
        current_period_end: past(24),
        cancel_at_period_end: false,
      },
    });
    expect(r).toMatchObject({ kind: "past_due", plan: "pro" });
  });

  it("plan canceled com período vigente → active com cancelAtPeriodEnd", () => {
    const r = resolveAccessStatus({
      ...base,
      plan: {
        plan: "pro",
        status: "canceled",
        current_period_end: future(48),
        cancel_at_period_end: true,
      },
    });
    expect(r).toMatchObject({ kind: "active", cancelAtPeriodEnd: true });
  });

  it("plan canceled com período vencido → canceled", () => {
    const r = resolveAccessStatus({
      ...base,
      plan: {
        plan: "pro",
        status: "canceled",
        current_period_end: past(1),
        cancel_at_period_end: true,
      },
    });
    expect(r.kind).toBe("canceled");
  });

  it("trial válido → trial", () => {
    const r = resolveAccessStatus({
      ...base,
      isTrial: true,
      trialExpiresAt: future(1),
      plan: null,
    });
    expect(r.kind).toBe("trial");
  });

  it("trial expirado → trial_expired", () => {
    const r = resolveAccessStatus({ ...base, isTrial: true, trialExpiresAt: past(1), plan: null });
    expect(r.kind).toBe("trial_expired");
  });

  it("sem plano nem trial → none", () => {
    expect(resolveAccessStatus({ ...base, plan: null }).kind).toBe("none");
  });
});

describe("isAccessGranted (server)", () => {
  it("active/trialing/lifetime passam", () => {
    for (const status of ["active", "trialing", "lifetime"]) {
      expect(
        isAccessGranted({
          subscription: { status, current_period_end: future(24) },
          isTrial: false,
          trialExpiresAt: null,
          now: NOW,
        }),
      ).toBe(true);
    }
  });

  it("canceled com período vigente passa; vencido bloqueia (402)", () => {
    expect(
      isAccessGranted({
        subscription: { status: "canceled", current_period_end: future(1) },
        isTrial: false,
        trialExpiresAt: null,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isAccessGranted({
        subscription: { status: "canceled", current_period_end: past(1) },
        isTrial: false,
        trialExpiresAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("past_due bloqueia no servidor (client dá grace via banner)", () => {
    expect(
      isAccessGranted({
        subscription: { status: "past_due", current_period_end: past(1) },
        isTrial: false,
        trialExpiresAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("trial válido passa; expirado bloqueia", () => {
    expect(
      isAccessGranted({
        subscription: null,
        isTrial: true,
        trialExpiresAt: future(1),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isAccessGranted({
        subscription: null,
        isTrial: true,
        trialExpiresAt: past(1),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("sem plano nem trial bloqueia", () => {
    expect(
      isAccessGranted({
        subscription: null,
        isTrial: false,
        trialExpiresAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("requireActiveSubscription (banco)", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.client.exec('TRUNCATE "user", "subscriptions" CASCADE');
    invalidateSubscriptionCache();
  });

  async function user(patch: Partial<typeof schema.user.$inferInsert> = {}) {
    const [u] = await t.db
      .insert(schema.user)
      .values({ email: `${crypto.randomUUID()}@x.com`, name: "u", ...patch })
      .returning();
    return u.id;
  }

  it("assinatura ativa (a mais recente) libera", async () => {
    const id = await user();
    await t.db.insert(schema.subscriptions).values([
      {
        userId: id,
        priceId: "p",
        plan: "p",
        status: "canceled",
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
      { userId: id, priceId: "p", plan: "p", status: "active" },
    ]);
    await expect(requireActiveSubscription(id)).resolves.toBeUndefined();
  });

  it("sem assinatura nem trial → 402", async () => {
    const id = await user();
    await expect(requireActiveSubscription(id)).rejects.toThrow(/^402/);
  });

  it("trial vigente (colunas do user) libera; vencido bloqueia", async () => {
    const live = await user({ isTrial: true, trialExpiresAt: new Date(Date.now() + 3600_000) });
    const dead = await user({ isTrial: true, trialExpiresAt: new Date(Date.now() - 3600_000) });
    await expect(requireActiveSubscription(live)).resolves.toBeUndefined();
    await expect(requireActiveSubscription(dead)).rejects.toThrow(/^402/);
  });

  it("resultado fica em cache até invalidar", async () => {
    const id = await user();
    await expect(requireActiveSubscription(id)).rejects.toThrow(/^402/);
    await t.db
      .insert(schema.subscriptions)
      .values({ userId: id, priceId: "p", plan: "p", status: "active" });
    await expect(requireActiveSubscription(id)).rejects.toThrow(/^402/);
    invalidateSubscriptionCache(id);
    await expect(requireActiveSubscription(id)).resolves.toBeUndefined();
  });
});
