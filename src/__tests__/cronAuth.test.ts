import { afterEach, describe, expect, test } from "vitest";
import { rejectUnlessCron } from "@/lib/cronAuth.server";

const SECRET = "s".repeat(40);
const req = (headers: Record<string, string> = {}) =>
  new Request("https://x/api/public/hooks/trial-cleanup", { method: "POST", headers });

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("rejectUnlessCron", () => {
  test("sem CRON_SECRET configurado → nega (falha fechada)", () => {
    expect(rejectUnlessCron(req({ authorization: "Bearer qualquer" }))?.status).toBe(503);
  });

  test("CRON_SECRET curto demais → nega", () => {
    process.env.CRON_SECRET = "curto";
    expect(rejectUnlessCron(req({ authorization: "Bearer curto" }))?.status).toBe(503);
  });

  test("sem header → 401", () => {
    process.env.CRON_SECRET = SECRET;
    expect(rejectUnlessCron(req())?.status).toBe(401);
  });

  test("chave publishable no header apikey (padrão antigo) → 401", () => {
    process.env.CRON_SECRET = SECRET;
    process.env.SUPABASE_PUBLISHABLE_KEY = "pk";
    expect(rejectUnlessCron(req({ apikey: "pk" }))?.status).toBe(401);
  });

  test("segredo errado → 401", () => {
    process.env.CRON_SECRET = SECRET;
    expect(rejectUnlessCron(req({ authorization: `Bearer ${"x".repeat(40)}` }))?.status).toBe(401);
  });

  test("segredo correto → autoriza", () => {
    process.env.CRON_SECRET = SECRET;
    expect(rejectUnlessCron(req({ authorization: `Bearer ${SECRET}` }))).toBeNull();
  });
});
