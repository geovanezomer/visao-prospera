// Primeiro acesso: admin/admin exige troca de senha. Em reexecuções (banco já
// usado) entra direto com a senha nova. Salva a sessão para os demais testes.
import { expect, test as setup } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER } from "./helpers";

async function login(page: import("@playwright/test").Page, password: string) {
  await page.goto("/login");
  await page.fill("#email", ADMIN_USER);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  return page
    .waitForURL(/\/app/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

setup("primeiro login do admin e troca obrigatória de senha", async ({ page }) => {
  const firstAccess = await login(page, "admin");
  if (!firstAccess) {
    // Senha já trocada numa execução anterior.
    expect(await login(page, ADMIN_PASSWORD), "login com a senha nova").toBe(true);
  } else {
    const forced = page.getByRole("heading", { name: "Defina uma nova senha" });
    await expect(forced).toBeVisible({ timeout: 20_000 });
    // Sem trocar a senha, o app não abre.
    await expect(page.locator("[data-sidebar='sidebar']")).toHaveCount(0);
    await page.fill("#cp-current", "admin");
    await page.fill("#cp-new", ADMIN_PASSWORD);
    await page.fill("#cp-confirm", ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(forced).toBeHidden({ timeout: 20_000 });
  }
  await expect(page.locator("[data-sidebar='sidebar']").first()).toBeVisible({ timeout: 30_000 });
  await page.context().storageState({ path: "test-results/.auth/admin.json" });
});
