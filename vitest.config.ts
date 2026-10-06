import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Motores de cálculo (financeiro e Odoo). Ficam de fora a interface
      // (hooks, contexto React, store do navegador) e a entrada/saída de
      // arquivos e PDF, que os testes de navegador cobrem.
      include: ["src/engines/finance/**/*.ts", "src/engines/odoo/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/__tests__/**",
        "**/*.tsx",
        "**/use*.ts",
        "src/engines/finance/store.ts",
        "src/engines/finance/pdfExport.ts",
        "src/engines/finance/fileIO.ts",
        "src/engines/finance/types.ts",
        "src/engines/odoo/types.ts",
      ],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
    },
  },
});
