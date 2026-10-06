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
  // LGPD: aceite dos termos vigentes antes de liberar o app (uma vez por versão).
  const termos = page.getByRole("heading", { name: "Termos de uso e privacidade" });
  const sidebar = page.locator("[data-sidebar='sidebar']").first();
  await expect(termos.or(sidebar)).toBeVisible({ timeout: 30_000 });
  if (await termos.isVisible()) {
    const aceitar = page.getByRole("button", { name: "Aceitar e continuar" });
    await expect(aceitar).toBeDisabled();
    await page.getByRole("checkbox", { name: /Li e aceito/ }).click();
    await aceitar.click();
  }
  await expect(sidebar).toBeVisible({ timeout: 30_000 });

  // Guia de primeiros passos: abre sozinho no primeiro acesso.
  const guia = page.getByRole("dialog", { name: /Bem-vindo ao FinnancePRO/ });
  if (await guia.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole("button", { name: /Próximo/ }).click();
    await expect(page.getByRole("dialog", { name: /Empresa e regime/ })).toBeVisible();
    await page.getByRole("button", { name: "Pular guia" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.context().storageState({ path: "test-results/.auth/admin.json" });
});
