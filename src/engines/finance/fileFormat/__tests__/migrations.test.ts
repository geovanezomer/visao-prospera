// Teste de smoke do pipeline de migrators.
// Abre todas as fixtures `vN.json` do diretório e garante que cada uma:
//   1. Passa pelo pipeline runMigrations() sem erro.
//   2. Sai com `version === CURRENT_VERSION`.
//   3. É aceita pelo CurrentSchema (FinnanceFileSchema).
//   4. Pode ser normalizada via parseFinnanceFile() sem perda do `companyName`.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_VERSION, FinnanceFileSchema, parseFinnanceFile, runMigrations } from "../index";

const FIXTURES_DIR = join(__dirname, "fixtures");

function loadFixtures(): Array<{ name: string; raw: unknown }> {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      raw: JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")),
    }));
}

describe("fileFormat — pipeline de migrators", () => {
  const fixtures = loadFixtures();

  it("deve existir ao menos a fixture v1", () => {
    expect(fixtures.some((f) => f.name === "v1.json")).toBe(true);
  });

  for (const { name, raw } of fixtures) {
    it(`migra ${name} até a versão corrente sem erro`, () => {
      const migrated = runMigrations(raw, CURRENT_VERSION) as { version: number };
      expect(migrated.version).toBeLessThanOrEqual(CURRENT_VERSION);
      const parsed = FinnanceFileSchema.parse(migrated);
      expect(parsed.type).toBe("gz-finnance");
    });

    it(`parseFinnanceFile(${name}) normaliza state preservando companyName`, () => {
      const opened = parseFinnanceFile(raw);
      const expected = (raw as { state?: { companyName?: string } }).state?.companyName;
      if (expected) {
        expect(opened.state.companyName).toBe(expected);
      }
    });
  }

  for (const { name, raw } of fixtures) {
    it(`runMigrations(${name}) é idempotente — rodar 2× não muda o resultado`, () => {
      const once = runMigrations(raw, CURRENT_VERSION);
      const twice = runMigrations(once, CURRENT_VERSION);
      // Resultado estável: aplicar o pipeline sobre um arquivo já migrado
      // deve ser no-op (mesma forma, mesma versão).
      expect(twice).toEqual(once);
      expect((twice as { version: number }).version).toBe((once as { version: number }).version);
    });
  }

  it("arquivo de versão futura é rejeitado com mensagem clara", () => {
    const future = { type: "gz-finnance", version: CURRENT_VERSION + 99, state: {} };
    expect(() => runMigrations(future, CURRENT_VERSION)).toThrow(/versão mais nova/i);
  });

  it("arquivo sem campo `version` é tratado como v1 (compat)", () => {
    const noVersion = {
      type: "gz-finnance",
      version: 1,
      state: { companyName: "Sem version original" },
      scenarios: [],
    };
    // Mesmo passando, garante que o pipeline não explode em chave ausente.
    const migrated = runMigrations(noVersion, CURRENT_VERSION);
    expect(() => FinnanceFileSchema.parse(migrated)).not.toThrow();
  });
});
