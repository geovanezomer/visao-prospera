// Guardrail arquitetural: garante que a árvore de pastas continue alinhada
// com o contrato descrito em docs/ARCHITECTURE.md.
//
// Regras enforçadas aqui (rodam junto com a suíte normal de testes):
// 1. `src/services/` foi consolidado em `src/engines/` — a pasta não pode
//    voltar a existir (qualquer nova lógica de domínio deve nascer em engines).
// 2. `src/lib/calculadoras/` foi movido para `src/engines/calculadoras/`.
// 3. `src/lib/` é restrito a utilitários genéricos: nenhum arquivo dentro
//    de `src/lib/` pode importar de `@/engines/<dominio>/...`.
// 4. Os módulos do registry de tools da IA não podem se importar entre si
//    (cada domínio é independente — o agregador é só o `tools/index.ts`).

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(p);
  }
  return acc;
}

describe("arquitetura de pastas", () => {
  it("src/services/ não pode voltar a existir (consolidado em src/engines/)", () => {
    expect(existsSync(join(ROOT, "src/services"))).toBe(false);
  });

  it("src/lib/calculadoras/ não pode voltar a existir (movido para src/engines/calculadoras)", () => {
    expect(existsSync(join(ROOT, "src/lib/calculadoras"))).toBe(false);
  });

  it("src/lib/ só contém utilitários genéricos (não importa lógica de domínio de @/engines/<dominio>/)", () => {
    const DOMAIN_PREFIXES = [
      "@/engines/finance/",
      "@/engines/ai/",
      "@/engines/benchmark/",
      "@/engines/compliance/",
      "@/engines/macro/",
      "@/engines/scenarios/",
      "@/engines/actions/",
      "@/engines/calculadoras/",
    ];
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src/lib"))) {
      const src = readFileSync(file, "utf8");
      const hit = DOMAIN_PREFIXES.find(p => src.includes(`"${p}`) || src.includes(`'${p}`));
      if (hit) offenders.push(`${relative(ROOT, file)} → ${hit}…`);
    }
    expect(offenders, `src/lib não deve importar lógica de domínio:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("nenhum arquivo usa caminhos antigos @/services/* ou @/lib/calculadoras/*", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      // Ignora o próprio teste arquitetural (cita os caminhos por motivo de regex).
      if (file.endsWith("architecture.test.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/@\/services\//.test(src) || /@\/lib\/calculadoras/.test(src)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders, `Caminhos descontinuados ainda em uso:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("módulos do registry de tools são independentes entre si", () => {
    const dir = join(ROOT, "src/engines/ai/tools");
    if (!existsSync(dir)) return; // suíte tolera ausência durante refactor.
    const files = readdirSync(dir).filter(f => /\.ts$/.test(f) && f !== "index.ts" && f !== "shared.ts");
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      // Pode importar de ./shared, de ../snapshot e de @/engines/...; não pode importar dos demais irmãos.
      const re = /from\s+["']\.\/(?!shared)([a-zA-Z0-9_-]+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) offenders.push(`${f} → ./${m[1]}`);
    }
    expect(offenders, `Módulos de tools acoplados:\n${offenders.join("\n")}`).toEqual([]);
  });
});
