// ============================================================================
// Testes: loadLandingPlans — fallback vs banco.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/admin/audit.server", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const listMock = vi.fn();
vi.mock("@/lib/admin/plans.functions", () => ({
  listPlansPublic: (...args: unknown[]) => listMock(...args),
}));

describe("loadLandingPlans", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it("sucesso: devolve planos do banco com source='db'", async () => {
    listMock.mockResolvedValueOnce({
      plans: [
        {
          id: "1",
          slug: "pro",
          name: "Pro",
          description: "x",
          priceCents: 10000,
          currency: "BRL",
          interval: "year",
          features: ["a"],
          limits: {},
          stripePriceId: null,
          asaasPlanRef: null,
          active: true,
          sortOrder: 1,
          upsellEnabled: false,
          upsellName: null,
          upsellDescription: null,
          upsellPriceCents: 0,
          upsellStripePriceId: null,
          upsellAsaasRef: null,
        },
      ],
    });
    const { loadLandingPlans } = await import("../components/landing/loadLandingPlans.server");
    const r = await loadLandingPlans();
    expect(r.source).toBe("db");
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].slug).toBe("pro");
  });

  it("erro: cai no fallback com source='fallback'", async () => {
    listMock.mockRejectedValueOnce(new Error("db down"));
    const { loadLandingPlans } = await import("../components/landing/loadLandingPlans.server");
    const { PLANS_FALLBACK } = await import("../components/landing/plansFallback");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadLandingPlans();
    expect(r.source).toBe("fallback");
    expect(r.plans).toEqual(PLANS_FALLBACK);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("lista vazia: cai no fallback com source='fallback'", async () => {
    listMock.mockResolvedValueOnce({ plans: [] });
    const { loadLandingPlans } = await import("../components/landing/loadLandingPlans.server");
    const { PLANS_FALLBACK } = await import("../components/landing/plansFallback");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadLandingPlans();
    expect(r.source).toBe("fallback");
    expect(r.plans).toEqual(PLANS_FALLBACK);
    errSpy.mockRestore();
  });
});
