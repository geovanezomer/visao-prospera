// Administração: painel de operação, conexão com o Odoo e saúde pública.
import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

test("painel Operação mostra banco, backup e erros", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/admin?tab=status");
  await expect(page.getByRole("heading", { name: /Operação/ })).toBeVisible();
  await expect(page.getByText("Banco de dados", { exact: true })).toBeVisible();
  await expect(page.getByText("Backup diário", { exact: true })).toBeVisible();
  await expect(page.getByText(/Erros capturados/)).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("aba Odoo declara a versão suportada e valida o formulário", async ({ page }) => {
  await page.goto("/admin?tab=odoo");
  await expect(page.getByText("Conexão com o Odoo (19 ou superior)")).toBeVisible();
  await expect(page.locator("#odoo-url")).toBeVisible();
});

test("/api/health responde com o resumo da operação", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.ok).toBe(true);
  expect(j.checks.db).toBe("ok");
});

test.describe("sem sessão", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/app e /admin exigem login", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/\/login/);
    await page.goto("/admin");
    await page.waitForURL(/\/login/);
  });
});
