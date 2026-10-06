// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import fs from "node:fs";
import path from "node:path";
import { visualizer } from "rollup-plugin-visualizer";

// Ativado por `ANALYZE=1 bun run build` — gera dist/bundle-stats.html
// com o treemap dos chunks (não afeta o build normal).
const ANALYZE = process.env.ANALYZE === "1";

// Lê CLOUD_BACKUP do .env (sem prefixo VITE_) e expõe ao bundle via `define` —
// o wrapper @lovable.dev só injeta automaticamente vars com prefixo VITE_*.
// SUPABASE_BACKUP é o nome antigo, aceito como alternativa.
function readCloudBackupFlag(): string {
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      const m = txt.match(/^\s*(?:CLOUD_BACKUP|SUPABASE_BACKUP)\s*=\s*"?([^"\n\r]+)"?\s*$/m);
      if (m) return m[1].trim();
    } catch {
      /* arquivo ausente — ignora */
    }
  }
  return process.env.CLOUD_BACKUP ?? process.env.SUPABASE_BACKUP ?? "ON";
}

const CLOUD_BACKUP = readCloudBackupFlag();

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.CLOUD_BACKUP": JSON.stringify(CLOUD_BACKUP),
    },
    plugins: ANALYZE
      ? [
          visualizer({
            filename: "dist/bundle-stats.html",
            template: "treemap",
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : [],
    environments: {
      client: {
        build: {
          rollupOptions: {
            // Silencia o warning "Module level directives cause errors when
            // bundled, 'use client' was ignored" emitido por libs do
            // node_modules (Radix UI, etc.). É inofensivo no nosso bundle
            // SSR/CSR — não somos um RSC framework.
            onwarn(warning, defaultHandler) {
              if (warning.code === "MODULE_LEVEL_DIRECTIVE" && /use client/.test(warning.message)) {
                return;
              }
              defaultHandler(warning);
            },
            output: {
              // Chunks dedicados para libs pesadas — apenas no bundle do cliente.
              // No SSR essas libs são externas (resolvidas pelo runtime) e não
              // podem entrar em manualChunks.
              manualChunks: {
                "vendor-charts": ["recharts"],
                "vendor-pdf": ["jspdf", "jspdf-autotable"],
              },
            },
          },
        },
      },
    },
  },
});
