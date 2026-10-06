// Acessibilidade (WCAG 2.1 AA) nas telas principais, nos dois temas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function violacoes(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return r.violations.map((v) => ({
    id: v.id,
    impacto: v.impact,
    alvos: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    total: v.nodes.length,
  }));
}

const TELAS = ["Dashboard", "DRE", "Fluxo de Caixa", "Simulador", "Indicadores"];

for (const tema of ["escuro", "claro"] as const) {
  test(`telas principais sem violações WCAG AA (tema ${tema})`, async ({ page }) => {
    if (tema === "claro")
      await page.addInitScript(() => localStorage.setItem("finnance:theme", "light"));
    await page.goto("/app");
    const sb = page.locator("[data-sidebar='sidebar']").first();
    const achados: Record<string, unknown> = {};
    for (const t of TELAS) {
      await sb.getByRole("button", { name: t, exact: true }).click();
      await page.waitForTimeout(800);
      const v = await violacoes(page);
      if (v.length) achados[t] = v;
    }
    expect(achados, JSON.stringify(achados, null, 2)).toEqual({});
  });
}

test("login sem violações WCAG AA", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  expect(await violacoes(page)).toEqual([]);
  await ctx.close();
});
