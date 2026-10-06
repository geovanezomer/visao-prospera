// Testes puros das helpers do dashboard admin: janelas comparáveis e funil.
import { describe, it, expect } from "vitest";
import { computeWindows, buildFunnel } from "@/lib/admin/dashboard.functions";

describe("computeWindows", () => {
  it("gera janela atual e anterior contíguas, sem sobreposição", () => {
    const now = new Date("2026-07-03T12:00:00Z");
    const w = computeWindows(now, 30);

    expect(w.currentEnd.toISOString()).toBe(now.toISOString());
    // previousEnd == currentStart (sem overlap)
    expect(w.previousEnd.toISOString()).toBe(w.currentStart.toISOString());
    // duração igual em ambas
    const dur = (a: Date, b: Date) => b.getTime() - a.getTime();
    expect(dur(w.currentStart, w.currentEnd)).toBe(30 * 86400_000);
    expect(dur(w.previousStart, w.previousEnd)).toBe(30 * 86400_000);
  });

  it("respeita 7 e 90 dias", () => {
    const now = new Date("2026-07-03T00:00:00Z");
    expect(
      computeWindows(now, 7).currentEnd.getTime() - computeWindows(now, 7).currentStart.getTime(),
    ).toBe(7 * 86400_000);
    expect(
      computeWindows(now, 90).currentEnd.getTime() - computeWindows(now, 90).currentStart.getTime(),
    ).toBe(90 * 86400_000);
  });
});

describe("buildFunnel", () => {
  const start = new Date("2026-06-01T00:00:00Z");
  const end = new Date("2026-07-01T00:00:00Z");
  const inside = "2026-06-15T00:00:00Z";
  const outside = "2026-05-01T00:00:00Z";

  it("conta trials, ativados, checkouts e pagos dentro da janela", () => {
    const trials = [
      { user_id: "u1", created_at: inside, consumed_at: inside }, // request+activated na janela
      { user_id: "u2", created_at: inside, consumed_at: null }, // request só
      { user_id: "u3", created_at: outside, consumed_at: inside }, // ativação na janela (request fora)
      { user_id: "u4", created_at: outside, consumed_at: outside }, // fora
    ];
    const intents = [
      { status: "created", created_at: inside, confirmed_at: null, updated_at: inside }, // checkout iniciado
      { status: "paid", created_at: inside, confirmed_at: inside, updated_at: inside }, // pago
      { status: "paid", created_at: outside, confirmed_at: inside, updated_at: inside }, // pago na janela (criado fora)
      { status: "paid", created_at: outside, confirmed_at: outside, updated_at: outside }, // fora
    ];
    const f = buildFunnel(trials, intents, start, end);
    expect(f.trialsRequested).toBe(2); // u1, u2
    expect(f.trialsActivated).toBe(2); // u1, u3
    expect(f.checkoutsStarted).toBe(2); // 2 criados na janela
    expect(f.paid).toBe(2); // 2 confirmados na janela
  });

  it("retorna zeros quando não há eventos na janela", () => {
    const f = buildFunnel(
      [{ user_id: "u", created_at: outside, consumed_at: outside }],
      [{ status: "paid", created_at: outside, confirmed_at: outside, updated_at: outside }],
      start,
      end,
    );
    expect(f).toEqual({ trialsRequested: 0, trialsActivated: 0, checkoutsStarted: 0, paid: 0 });
  });
});
