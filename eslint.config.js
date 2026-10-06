import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
          patterns: [
            {
              group: ["@/services/*", "@/lib/calculadoras/*"],
              message:
                "Caminho descontinuado. Lógica de domínio mora em src/engines/* — use @/engines/{benchmark,compliance,macro,scenarios,actions,calculadoras}/...",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Boundary architectural: src/lib/ é só utilitários genéricos.
  // Proibido importar lógica de domínio (engines/*) a partir de src/lib/.
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/engines/finance/*",
                "@/engines/ai/*",
                "@/engines/benchmark/*",
                "@/engines/compliance/*",
                "@/engines/macro/*",
                "@/engines/scenarios/*",
                "@/engines/actions/*",
                "@/engines/calculadoras/*",
              ],
              message:
                "src/lib/ é restrito a utilitários genéricos. Lógica de domínio (finance, ai, benchmark, compliance, macro, scenarios, actions, calculadoras) deve viver em src/engines/.",
            },
          ],
        },
      ],
    },
  },
  // Fast refresh é só dica de desenvolvimento. Componentes de UI gerados pelo
  // shadcn (exportam variantes junto) e o módulo de contexto (provider + hooks)
  // seguem o padrão idiomático do React; o restante do código cumpre a regra.
  {
    files: ["src/components/ui/**/*.tsx", "src/engines/finance/AppStateContext.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  // Testes usam mocks parciais e monkey-patch de módulos: `any` e
  // `@ts-ignore` são aceitos aqui, nunca no código de produção.
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  eslintPluginPrettier,
);
