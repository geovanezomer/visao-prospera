import { describe, it, expect } from "vitest";
import { PIPELINE_360, buildStagePrompt, stageHeader } from "../pipeline";

describe("pipeline 360°", () => {
  it("encadeia cfo → controller → auditor", () => {
    expect(PIPELINE_360).toEqual(["cfo", "controller", "auditor"]);
  });

  it("estágio 1 não inclui análises anteriores", () => {
    const p = buildStagePrompt("cfo", "Devo vender a empresa?", []);
    expect(p).toMatch(/Estágio 1\/3 — CFO/);
    expect(p).toMatch(/Devo vender a empresa\?/);
    expect(p).not.toMatch(/Análises anteriores/);
  });

  it("estágio controller recebe output do CFO", () => {
    const p = buildStagePrompt("controller", "Vale a pena?", [
      { stage: "cfo", output: "Tese: comprar concorrente." },
    ]);
    expect(p).toMatch(/Estágio 2\/3 — CONTROLLER/);
    expect(p).toMatch(/Tese: comprar concorrente/);
    expect(p).toMatch(/Valide os números/);
  });

  it("estágio auditor recebe outputs de CFO e Controller", () => {
    const p = buildStagePrompt("auditor", "X?", [
      { stage: "cfo", output: "AAA" },
      { stage: "controller", output: "BBB" },
    ]);
    expect(p).toMatch(/Estágio 3\/3 — AUDITOR/);
    expect(p).toMatch(/AAA/);
    expect(p).toMatch(/BBB/);
    expect(p).toMatch(/veredito final/);
  });

  it("stageHeader produz markdown único por estágio", () => {
    expect(stageHeader("cfo", 0)).toMatch(/CFO/);
    expect(stageHeader("controller", 1)).toMatch(/Controller/);
    expect(stageHeader("auditor", 2)).toMatch(/Auditor/);
  });

  it("pergunta vazia tem fallback padrão", () => {
    const p = buildStagePrompt("cfo", "   ", []);
    expect(p).toMatch(/Análise 360°/);
  });
});
