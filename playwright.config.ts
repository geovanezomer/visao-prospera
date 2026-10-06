// ============================================================================
// Testes de navegador (Playwright).
//
// Rodam contra o build de produção (.output) com um banco PostgreSQL vazio:
//   bun run build && DATABASE_URL=postgres://... bun run test:e2e
// Ou contra um servidor já no ar: E2E_BASE_URL=http://localhost:3000 bun run test:e2e
// O primeiro passo (auth.setup) faz o primeiro login do admin e troca a senha.
// ============================================================================
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "test-results/.auth/admin.json",
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        storageState: "test-results/.auth/admin.json",
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node .output/server/index.mjs",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          PORT: String(PORT),
          APP_URL: baseURL,
          MIGRATIONS_DIR: "db/migrations",
          JOBS_ENABLED: "OFF",
          BETTER_AUTH_SECRET:
            process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-0123456789abcdefghijklmnopqrstuv",
          DATABASE_URL: process.env.DATABASE_URL ?? "",
        },
      },
});
