// O migrador do Drizzle só aplica migrações com data MAIOR que a última
// aplicada: uma migração gerada em outro ramo com data anterior nunca rodaria
// em produção, sem erro. Este teste barra isso no CI.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = "db/migrations";
const journal = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, "utf8")) as {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

describe("migrações", () => {
  it("datas estritamente crescentes e índices em sequência", () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      if (i > 0) expect(e.when).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });

  it("cada arquivo .sql está no diário e vice-versa", () => {
    const arquivos = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    expect(journal.entries.map((e) => e.tag).sort()).toEqual(arquivos);
  });
});
