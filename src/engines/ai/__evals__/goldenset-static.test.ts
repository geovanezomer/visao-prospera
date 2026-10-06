// Nível A do golden set — validação determinística sem LLM.
// Roda no CI a cada mudança de prompt/tools/fixtures.
import { describe, it, expect } from "vitest";
import { GOLDEN_SET } from "@/engines/ai/__evals__/goldenSet";
import { runStaticCase } from "@/engines/ai/__evals__/runner";

describe("golden set — nível A (estático, sem LLM)", () => {
  for (const c of GOLDEN_SET) {
    it(`${c.id}`, async () => {
      const r = await runStaticCase(c);
      if (!r.ok) {
        // Falha explícita mostrando todos os problemas do caso.
        throw new Error(`Caso "${c.id}" falhou:\n  - ` + r.errors.join("\n  - "));
      }
      expect(r.toolsRun.length).toBeGreaterThan(0);
      expect(r.payloadChars).toBeGreaterThan(0);
    });
  }
});
