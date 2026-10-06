// Tempo de carregamento, com cache vazio e mediana de 3 medições.
//  - Escritório: meta de 2,5 s (limite "bom" de LCP do Core Web Vitals).
//  - 4G + processador 4× mais lento (celular médio): trava contra regressão em
//    3,5 s; vale o caminho de produção (Caddy com HTTP/2), PERF_PRODUCAO=1.
//    Direto no Node (HTTP/1.1) a fila de 6 conexões pesa e só é informativo.
// Medição de 06/10/2026 (produção local): login 0,27 s / app 0,68 s no
// escritório; login 1,2 s / app 2,9 s no celular médio.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Perfil = { nome: string; rede?: { down: number; up: number; rtt: number }; cpu?: number };
const PERFIS: Perfil[] = [
  { nome: "escritório" },
  // 4G: 9 Mbps / 1,5 Mbps, 170 ms de latência; CPU 4× (referência de celular médio).
  { nome: "4G + CPU lenta", rede: { down: 9_000_000 / 8, up: 1_500_000 / 8, rtt: 170 }, cpu: 4 },
];
const META_MS = 2500;
const TRAVA_MOVEL_MS = 3500;
const metaDe = (p: Perfil) =>
  !p.cpu ? META_MS : process.env.PERF_PRODUCAO === "1" ? TRAVA_MOVEL_MS : Infinity;

async function preparar(ctx: BrowserContext, page: Page, p: Perfil) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (p.rede)
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: p.rede.rtt,
      downloadThroughput: p.rede.down,
      uploadThroughput: p.rede.up,
    });
  if (p.cpu) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
}

async function medir(page: Page, url: string, pronto: string) {
  await page.goto(url, { waitUntil: "commit" });
  await page.locator(pronto).first().waitFor({ state: "visible", timeout: 30_000 });
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const js = performance
      .getEntriesByType("resource")
      .filter((r) => (r as PerformanceResourceTiming).initiatorType === "script")
      .reduce((s, r) => s + ((r as PerformanceResourceTiming).transferSize || 0), 0);
    return {
      pronto: performance.now(),
      lcp: (window as unknown as { __lcp: number }).__lcp,
      ttfb: nav.responseStart,
      jsKB: Math.round(js / 1024),
    };
  });
  return t;
}

const RODADAS = Number(process.env.PERF_RODADAS ?? 3);
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function rodadas(
  browser: import("@playwright/test").Browser,
  perfil: Perfil,
  url: string,
  pronto: string,
  storageState: string | { cookies: []; origins: [] },
) {
  const tempos: number[] = [];
  for (let i = 0; i < RODADAS; i++) {
    const ctx = await browser.newContext({ storageState });
    const page = await ctx.newPage();
    await preparar(ctx, page, perfil);
    const t = await medir(page, url, pronto);
    tempos.push(Math.max(t.lcp, t.pronto));
    await ctx.close();
  }
  return tempos;
}

for (const perfil of PERFIS) {
  test.describe(`carregamento — ${perfil.nome}`, () => {
    test("login", async ({ browser }) => {
      const tempos = await rodadas(browser, perfil, "/login", "#email", {
        cookies: [],
        origins: [],
      });
      console.log(
        `[perf] ${perfil.nome} /login`,
        tempos.map(Math.round),
        "mediana",
        Math.round(mediana(tempos)),
      );
      expect(mediana(tempos)).toBeLessThan(metaDe(perfil));
    });

    test("app (painel com números)", async ({ browser }) => {
      test.setTimeout(120_000);
      const tempos = await rodadas(
        browser,
        perfil,
        "/app",
        // Dashboard: primeiro número do painel (cartões usam .mono; tabelas, .num).
        "main .num, main .mono",
        "test-results/.auth/admin.json",
      );
      console.log(
        `[perf] ${perfil.nome} /app`,
        tempos.map(Math.round),
        "mediana",
        Math.round(mediana(tempos)),
      );
      expect(mediana(tempos)).toBeLessThan(metaDe(perfil));
    });
  });
}
