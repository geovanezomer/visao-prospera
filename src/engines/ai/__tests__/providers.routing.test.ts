// Testes de resolveConfigForTask — roteamento de modelos por tarefa.
// Garantia central: chat/tools SEMPRE na config base; tarefas nobres podem
// promover à config premium, com fallback silencioso se algo faltar.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  resolveConfigForTask,
  type AIConfig,
  type AITask,
} from "@/engines/ai/providers";

const NON_PREMIUM: AITask[] = ["chat", "tools"];
const PREMIUM: AITask[] = ["diagnostico", "pipeline360", "relatorio"];

function base(overrides: Partial<AIConfig> = {}): AIConfig {
  return { ...DEFAULT_CONFIG, apiKey: "sk-base", ...overrides };
}

describe("resolveConfigForTask", () => {
  it("sem premium: todas as tasks retornam config base", () => {
    const cfg = base();
    for (const task of [...NON_PREMIUM, ...PREMIUM]) {
      const r = resolveConfigForTask(cfg, task);
      expect(r.config).toBe(cfg);
      expect(r.usedPremium).toBe(false);
      expect(r.usedFallback).toBe(false);
    }
  });

  it("com premium completo: chat/tools ficam na base, tarefas nobres promovem", () => {
    const cfg = base({
      premium: { provider: "openai", model: "gpt-5", apiKey: "sk-prem", baseUrl: "https://x/v1" },
    });
    for (const task of NON_PREMIUM) {
      const r = resolveConfigForTask(cfg, task);
      expect(r.usedPremium).toBe(false);
      expect(r.config.model).toBe(cfg.model);
    }
    for (const task of PREMIUM) {
      const r = resolveConfigForTask(cfg, task);
      expect(r.usedPremium).toBe(true);
      expect(r.usedFallback).toBe(false);
      expect(r.config.provider).toBe("openai");
      expect(r.config.model).toBe("gpt-5");
      expect(r.config.apiKey).toBe("sk-prem");
      expect(r.config.baseUrl).toBe("https://x/v1");
    }
  });

  it("premium sem apiKey herda apiKey/baseUrl da base", () => {
    const cfg = base({
      apiKey: "sk-base",
      baseUrl: "https://base/v1",
      premium: { provider: "anthropic", model: "claude-x" },
    });
    const r = resolveConfigForTask(cfg, "diagnostico");
    expect(r.usedPremium).toBe(true);
    expect(r.config.apiKey).toBe("sk-base");
    expect(r.config.baseUrl).toBe("https://base/v1");
  });

  it("premium sem apiKey e base também sem key (provider que exige) → fallback", () => {
    const cfg = base({
      apiKey: "",
      premium: { provider: "openai", model: "gpt-5" },
    });
    const r = resolveConfigForTask(cfg, "diagnostico");
    expect(r.usedPremium).toBe(false);
    expect(r.usedFallback).toBe(true);
    expect(r.config).toBe(cfg);
  });

  it("premium com model vazio → fallback silencioso", () => {
    const cfg = base({
      premium: { provider: "openai", model: "   ", apiKey: "sk-prem" },
    });
    const r = resolveConfigForTask(cfg, "pipeline360");
    expect(r.usedPremium).toBe(false);
    expect(r.usedFallback).toBe(true);
  });

  it("provider lmstudio (local) não exige apiKey", () => {
    const cfg = base({
      apiKey: "",
      premium: { provider: "lmstudio", model: "local-x" },
    });
    const r = resolveConfigForTask(cfg, "relatorio");
    expect(r.usedPremium).toBe(true);
    expect(r.config.provider).toBe("lmstudio");
  });

  it("é puro: não muta a config de entrada", () => {
    const cfg = base({
      premium: { provider: "openai", model: "gpt-5", apiKey: "sk-prem" },
    });
    const snapshot = JSON.parse(JSON.stringify(cfg));
    resolveConfigForTask(cfg, "diagnostico");
    expect(cfg).toEqual(snapshot);
  });
});
