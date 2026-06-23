// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import fs from "node:fs";
import path from "node:path";

// Lê SUPABASE_BACKUP do .env (sem prefixo VITE_, conforme spec) e expõe ao bundle
// via `define` — o wrapper @lovable.dev só injeta automaticamente vars com prefixo VITE_*.
function readSupabaseBackupFlag(): string {
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      const m = txt.match(/^\s*SUPABASE_BACKUP\s*=\s*"?([^"\n\r]+)"?\s*$/m);
      if (m) return m[1].trim();
    } catch {
      /* arquivo ausente — ignora */
    }
  }
  return process.env.SUPABASE_BACKUP ?? "ON";
}

const SUPABASE_BACKUP = readSupabaseBackupFlag();

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.SUPABASE_BACKUP": JSON.stringify(SUPABASE_BACKUP),
    },
    build: {
      rollupOptions: {
        output: {
          // Chunks dedicados para libs pesadas — melhora cache HTTP entre abas
          // (cada aba lazy só puxa o chunk do componente; recharts/jspdf ficam
          // em vendors cacheáveis independentemente).
          manualChunks: {
            "vendor-charts": ["recharts"],
            "vendor-pdf": ["jspdf", "jspdf-autotable"],
          },
        },
      },
    },
  },
});
