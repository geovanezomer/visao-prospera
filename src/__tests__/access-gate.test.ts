// Testes: resolveAccessStatus + isAccessGranted (gate client + gate server).
import { describe, it, expect } from "vitest";
import { resolveAccessStatus } from "@/hooks/useAccessStatus";
import { isAccessGranted } from "@/lib/requireActiveSubscription.server";

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
