// Celular: sem rolagem horizontal e navegação pelo menu lateral.
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll } from "./helpers";

test("app no celular: sem rolagem horizontal e menu funcionando", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/app");
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalScroll(page);
  await page
    .getByRole("button", { name: /toggle sidebar|menu/i })
    .first()
    .click();
  const menu = page.locator("[data-sidebar='sidebar']").last();
  await menu.getByRole("button", { name: "Balanço", exact: true }).click();
  await expect(page.locator("header").getByText("Balanço", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("login no celular cabe na tela", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.locator("#email")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await ctx.close();
});
