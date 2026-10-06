// Modo manual: todas as telas abrem sem erro e os números batem entre si.
import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

const TELAS = [
  "Dashboard",
  "Capital",
  "Receitas",
  "Despesas",
  "Pró-labore",
  "Fluxo de Caixa",
  "Regime Tributário",
  "DRE",
  "Balanço",
  "Indicadores",
  "Governança",
  "Diagnóstico",
  "Simulador",
  "Valuation",
  "Calculadoras",
];

test("todas as telas do modo manual abrem sem erro", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/app");
  const sidebar = page.locator("[data-sidebar='sidebar']").first();
  await expect(sidebar).toBeVisible();
  for (const tela of TELAS) {
    await sidebar.getByRole("button", { name: tela, exact: true }).click();
    await expect(page.locator("header").getByText(tela, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Esta página não carregou")).toHaveCount(0);
    await expect(page.getByText(/algo deu errado/i)).toHaveCount(0);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/** "-R$ 1.234,56" → -1234.56; "–" → 0. */
const brl = (t: string | null) => {
  const m = (t ?? "").replace(/\s/g, "").match(/(-?)R\$([\d.]+(?:,\d+)?)/);
  if (!m) return 0;
  return (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, "").replace(",", "."));
};

async function abrirDre(page: import("@playwright/test").Page, visao: string) {
  await page.goto("/app");
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: "DRE", exact: true })
    .click();
  await page.getByRole("tab", { name: visao, exact: true }).click();
  await expect(page.getByRole("tab", { name: visao, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** Valores da linha da DRE: colunas de período e, por último, o total anual (% fora). */
async function linhaDre(page: import("@playwright/test").Page, nome: RegExp) {
  const cells = await page.getByRole("row", { name: nome }).first().locator("td").allTextContents();
  const valores = cells.slice(1, -1).map(brl);
  return { periodos: valores.slice(0, -1), anual: valores[valores.length - 1] };
}

test("DRE: o faturamento do cartão é a receita bruta da tabela", async ({ page }) => {
  await abrirDre(page, "Anual");
  const card = page.getByText("Faturamento", { exact: true }).locator("xpath=../..");
  const { anual } = await linhaDre(page, /Receita Operacional Bruta/);
  expect(anual).toBeGreaterThan(0);
  expect(brl(await card.textContent())).toBeCloseTo(anual, 2);
});

test("DRE trimestral e mensal: períodos somam o total anual", async ({ page }) => {
  for (const [visao, n] of [
    ["Trimestral", 4],
    ["Mensal", 12],
  ] as const) {
    await abrirDre(page, visao);
    for (const nome of [/Receita Operacional Bruta/, /LUCRO LÍQUIDO DO EXERCÍCIO/]) {
      const { periodos, anual } = await linhaDre(page, nome);
      expect(periodos).toHaveLength(n);
      // Colunas de período são arredondadas a reais: tolerância de R$ 1 por coluna.
      expect(Math.abs(periodos.reduce((a, b) => a + b, 0) - anual)).toBeLessThanOrEqual(n);
    }
  }
  await abrirDre(page, "Anual");
});

test("tema claro: alterna, persiste ao recarregar e volta ao escuro", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Usar tema claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Usar tema escuro" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
});

test("simulações salvas: salvar, aplicar e apagar", async ({ page }) => {
  const nome = `Teste e2e ${Date.now()}`;
  await page.goto("/app");
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: "Simulador", exact: true })
    .click();
  await page.getByRole("button", { name: /^Simulações salvas/ }).click();
  await page.getByLabel("Nome da simulação").fill(nome);
  await page.getByRole("button", { name: "Salvar simulação" }).click();
  const item = page.getByRole("button", { name: nome, exact: true });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByText(`Simulação "${nome}" aplicada.`)).toBeVisible();
  // O menu fecha ao aplicar; espera terminar antes de reabrir.
  await expect(page.getByLabel("Nome da simulação")).toHaveCount(0);
  await page.getByRole("button", { name: /^Simulações salvas/ }).click();
  await page.getByRole("button", { name: `Apagar simulação ${nome}` }).click();
  await expect(page.getByRole("button", { name: nome, exact: true })).toHaveCount(0);
});
