// Modo Odoo de ponta a ponta contra o Odoo de laboratório (scripts/odoo-demo).
// Roda só com ODOO_E2E_URL, ODOO_E2E_DB e ODOO_E2E_KEY definidos (job
// "odoo-lab" do CI); sem eles, é pulado. Ao final volta para o modo manual.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

const URL = process.env.ODOO_E2E_URL;
const DB = process.env.ODOO_E2E_DB;
const KEY = process.env.ODOO_E2E_KEY;

test.skip(!URL || !DB || !KEY, "sem Odoo de laboratório (ODOO_E2E_URL/DB/KEY)");
test.describe.configure({ mode: "serial" });

type Expected = { dre_mensal: Record<string, { meses: Record<string, Record<string, number>> }> };
const expected = JSON.parse(readFileSync("scripts/odoo-demo/expected.json", "utf8")) as Expected;
const soma12 = (empresa: string, campo: string) =>
  Object.values(expected.dre_mensal[empresa].meses).reduce((a, m) => a + (m[campo] ?? 0), 0);

const brl = (t: string | null) => {
  const m = (t ?? "").replace(/\s/g, "").match(/(-?)R\$([\d.]+(?:,\d+)?)/);
  if (!m) return 0;
  return (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, "").replace(",", "."));
};

/** Fecha o guia do modo Odoo, que abre sozinho na primeira vez. */
async function fecharGuia(page: Page) {
  // Abre depois que o retrato do Odoo carrega: espera um pouco por ele.
  const pular = page.getByRole("button", { name: "Pular guia" });
  const apareceu = await pular
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) {
    await pular.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
}

async function modo(page: Page, m: "Manual" | "Odoo") {
  await page.goto("/admin?tab=odoo");
  const radio = page.getByRole("radio", { name: m, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
}

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "test-results/.auth/admin.json" });
  await modo(await ctx.newPage(), "Manual");
  await ctx.close();
});

test("conecta, sincroniza e liga o modo Odoo", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/admin?tab=odoo");
  await page.fill("#odoo-url", URL!);
  await page.fill("#odoo-db", DB!);
  await page.fill("#odoo-key", KEY!);
  await page.getByRole("button", { name: "Testar conexão" }).click();
  await expect(page.getByText(/Empresas no Odoo/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Beta Serviços Ltda").first()).toBeVisible();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(page.getByText("Classificação das contas")).toBeVisible({ timeout: 120_000 });
  await modo(page, "Odoo");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("cockpit: DRE da Beta igual ao razão do Odoo", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/app");
  await fecharGuia(page);
  const empresa = page.locator('select[aria-label="Empresa"]');
  await expect(empresa).toBeVisible({ timeout: 30_000 });
  await empresa.selectOption({ label: "Beta Serviços Ltda" });
  // O laboratório tem movimento de out/25 a set/26: fixa a janela nesse período.
  await page.locator('select[aria-label="Mês final da análise"]').selectOption("2026-09");
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: "DRE", exact: true })
    .click();
  // Tributos vêm do razão, e a barra mostra que os dados passaram nas conferências.
  await expect(page.getByText("Tributos: contabilizados no Odoo")).toBeVisible();
  await expect(page.getByText(/Dados conferidos/)).toBeVisible();
  await page.getByRole("tab", { name: "Trimestral", exact: true }).click();

  const anual = async (nome: RegExp) => {
    const cells = await page
      .getByRole("row", { name: nome })
      .first()
      .locator("td")
      .allTextContents();
    return brl(cells[cells.length - 2]);
  };
  expect(await anual(/Receita Operacional Bruta/)).toBeCloseTo(
    soma12("Beta Serviços Ltda", "receita_bruta"),
    0,
  );
  expect(await anual(/LUCRO LÍQUIDO DO EXERCÍCIO/)).toBeCloseTo(
    soma12("Beta Serviços Ltda", "lucro_liquido"),
    0,
  );
  expect(errors, errors.join("\n")).toEqual([]);
});

test("conferências do cockpit e consolidado do grupo abrem", async ({ page }) => {
  await page.goto("/app");
  await fecharGuia(page);
  await expect(page.locator('select[aria-label="Empresa"]')).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /ver conferências/ })
    .first()
    .click();
  await expect(page.getByText("Ativo = Passivo + PL").first()).toBeVisible();
  await expect(page.getByText("Balancete (débitos = créditos)").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: "Consolidado", exact: true })
    .click();
  await expect(page.getByText(/Eliminaç/).first()).toBeVisible();
});

test("conciliação: sem diferenças em cada entidade e CSV conta a conta", async ({ page }) => {
  await page.goto("/app");
  await fecharGuia(page);
  const empresa = page.locator('select[aria-label="Empresa"]');
  await expect(empresa).toBeVisible({ timeout: 30_000 });
  await page.locator('select[aria-label="Mês final da análise"]').selectOption("2026-09");
  const opcoes = await empresa.locator("option").allTextContents();
  const card = page.getByRole("region", { name: "Conciliação" });
  for (const label of opcoes) {
    await empresa.selectOption({ label });
    await page
      .locator("[data-sidebar='sidebar']")
      .getByRole("button", { name: "Cockpit", exact: true })
      .click();
    await expect(card.getByText("sem diferenças"), `conciliação de ${label}`).toBeVisible();
  }
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: /Conta a conta/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^conciliacao-.*-contas\.csv$/);
});
