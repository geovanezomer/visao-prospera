import { expect, type Page } from "@playwright/test";

export const ADMIN_USER = "admin";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "E2e-Senha-Forte-2026";

/** Erros de página e de console (ignora ruído de rede de fontes externas). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/fonts\.g|ERR_CERT|net::ERR_|Failed to load resource/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

/** Troca de aba do app pelo evento interno (o mesmo usado pela barra lateral). */
export async function openTab(page: Page, tab: string) {
  await page.evaluate(
    (t) => window.dispatchEvent(new CustomEvent("gz-set-tab", { detail: t })),
    tab,
  );
}

/** Nenhuma rolagem horizontal na página. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "página com rolagem horizontal").toBeLessThanOrEqual(1);
}
