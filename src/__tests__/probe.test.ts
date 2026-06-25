import { test, expect } from "vitest";
test("probe", async () => {
  const mod = await import("@/routes/api/public/payments/intent-status");
  // @ts-ignore
  console.log(Object.keys(mod), JSON.stringify(Object.keys((mod.Route as any).options ?? {})));
  // @ts-ignore
  console.log("handlers:", Object.keys((mod.Route as any).options?.server?.handlers ?? {}));
  expect(true).toBe(true);
});
