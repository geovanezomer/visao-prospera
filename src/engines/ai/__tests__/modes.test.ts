// Testes para modos de atuação da IA:
// - buildSystemPrompt injeta o bloco correto para cada modo
// - back-compat: auditMode=true converte para mode "auditor"
// - mode tem precedência sobre auditMode quando ambos passados
// - modeStore persiste por companyName em localStorage
import { beforeEach, describe, expect, it } from "vitest";

// Polyfill mínimo de localStorage para ambiente node.
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, String(v));
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}
const g = globalThis as any;
g.localStorage = new LocalStorageMock();

import { buildSystemPrompt, type AIMode, AI_MODE_LABELS } from "../systemPrompt";
import { loadAIMode, saveAIMode } from "../modeStore";

// Marcadores únicos por modo — texto que SÓ aparece no bloco daquele modo.
// Sincronize com src/engines/ai/systemPrompt.ts se editar os blocos.
const MODE_MARKERS: Record<Exclude<AIMode, "chat">, string> = {
  cfo: "MODO CFO ESTRATÉGICO",
  controller: "MODO CONTROLLER",
  auditor: "<!--AUDIT-REPORT-->",
  board: "MODO CONSELHO (BOARD)",
  tributarista: "MODO TRIBUTARISTA",
  contador: "MODO CONTADOR",
};

function build(extra: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}) {
  return buildSystemPrompt({ includeSnapshot: false, useTools: false, ...extra });
}

describe("buildSystemPrompt — modos de atuação", () => {
  it("modo 'chat' (default) não injeta nenhum bloco específico de modo", () => {
    const out = build({});
    for (const marker of Object.values(MODE_MARKERS)) {
      expect(out).not.toContain(marker);
    }
  });

  it.each(Object.keys(MODE_MARKERS) as (keyof typeof MODE_MARKERS)[])(
    "modo '%s' injeta apenas seu próprio bloco",
    (mode) => {
      const out = build({ mode });
      expect(out).toContain(MODE_MARKERS[mode]);
      for (const other of Object.keys(MODE_MARKERS) as (keyof typeof MODE_MARKERS)[]) {
        if (other !== mode) expect(out).not.toContain(MODE_MARKERS[other]);
      }
    },
  );

  it("auditMode=true (deprecated) é convertido em mode 'auditor' (back-compat)", () => {
    const out = build({ auditMode: true });
    expect(out).toContain(MODE_MARKERS.auditor);
  });

  it("auditMode=false sem mode explícito mantém modo 'chat'", () => {
    const out = build({ auditMode: false });
    for (const marker of Object.values(MODE_MARKERS)) {
      expect(out).not.toContain(marker);
    }
  });

  it("mode tem precedência sobre auditMode quando ambos são passados", () => {
    const out = build({ mode: "board", auditMode: true });
    expect(out).toContain(MODE_MARKERS.board);
    expect(out).not.toContain(MODE_MARKERS.auditor);
  });

  it("AI_MODE_LABELS cobre todos os modos válidos", () => {
    expect(Object.keys(AI_MODE_LABELS).sort()).toEqual(
      ["auditor", "board", "cfo", "chat", "contador", "controller", "tributarista"].sort(),
    );
  });
});

describe("ai/modeStore — persistência por companyName", () => {
  beforeEach(() => {
    (g.localStorage as LocalStorageMock).clear();
  });

  it("loadAIMode retorna 'chat' quando nada foi salvo", () => {
    expect(loadAIMode("Acme")).toBe("chat");
  });

  it("saveAIMode + loadAIMode persiste e restaura por empresa", () => {
    saveAIMode("Acme", "cfo");
    saveAIMode("Beta", "board");
    expect(loadAIMode("Acme")).toBe("cfo");
    expect(loadAIMode("Beta")).toBe("board");
    expect(loadAIMode("Outra")).toBe("chat");
  });

  it("valor inválido no localStorage é ignorado (fallback 'chat')", () => {
    g.localStorage.setItem("gz-finance-ai-mode-Acme", "modo_falso");
    expect(loadAIMode("Acme")).toBe("chat");
  });

  it("trocar o modo da empresa sobrescreve o valor anterior", () => {
    saveAIMode("Acme", "controller");
    saveAIMode("Acme", "auditor");
    expect(loadAIMode("Acme")).toBe("auditor");
  });

  it("empresa vazia/undefined cai no bucket 'default'", () => {
    saveAIMode("", "board");
    expect(loadAIMode("")).toBe("board");
  });
});
