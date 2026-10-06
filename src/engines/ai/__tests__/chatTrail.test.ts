// Testes do Audit Trail genérico do chat — log append-only por empresa.
import { beforeEach, describe, expect, it } from "vitest";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
g.localStorage = new LocalStorageMock();
g.window = { localStorage: g.localStorage };

import { readChatTrail, recordChatTrail, clearChatTrail, chatTrailToMarkdown } from "../chatTrail";

const COMPANY = "Acme S.A.";
const OTHER = "Beta LTDA";

function baseEntry(overrides: Partial<Parameters<typeof recordChatTrail>[1]> = {}) {
  return {
    threadId: "t1",
    mode: "cfo",
    provider: "lovable",
    model: "gemini-flash",
    userText: "Como está o ROIC?",
    responseChars: 1234,
    tools: ["get_indicadores", "get_wacc"],
    durationMs: 850,
    status: "ok" as const,
    ...overrides,
  };
}

beforeEach(() => {
  (g.localStorage as LocalStorageMock).clear();
});

describe("ai/chatTrail", () => {
  it("readChatTrail retorna vazio sem registros", () => {
    expect(readChatTrail(COMPANY)).toEqual([]);
  });

  it("recordChatTrail persiste com timestamp ISO e companyName", () => {
    recordChatTrail(COMPANY, baseEntry());
    const items = readChatTrail(COMPANY);
    expect(items).toHaveLength(1);
    expect(items[0].company).toBe(COMPANY);
    expect(items[0].mode).toBe("cfo");
    expect(items[0].tools).toEqual(["get_indicadores", "get_wacc"]);
    expect(items[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ordem é cronológica reversa (mais recente primeiro)", () => {
    recordChatTrail(COMPANY, baseEntry({ userText: "primeira" }));
    recordChatTrail(COMPANY, baseEntry({ userText: "segunda" }));
    const items = readChatTrail(COMPANY);
    expect(items[0].userText).toBe("segunda");
    expect(items[1].userText).toBe("primeira");
  });

  it("isolamento por companyName", () => {
    recordChatTrail(COMPANY, baseEntry({ userText: "da A" }));
    recordChatTrail(OTHER, baseEntry({ userText: "da B" }));
    expect(readChatTrail(COMPANY).map((e) => e.userText)).toEqual(["da A"]);
    expect(readChatTrail(OTHER).map((e) => e.userText)).toEqual(["da B"]);
  });

  it("registra status 'erro' com errorMsg", () => {
    recordChatTrail(COMPANY, baseEntry({ status: "erro", errorMsg: "timeout" }));
    expect(readChatTrail(COMPANY)[0].errorMsg).toBe("timeout");
  });

  it("trunca userText em 500 chars", () => {
    const longText = "x".repeat(800);
    recordChatTrail(COMPANY, baseEntry({ userText: longText }));
    expect(readChatTrail(COMPANY)[0].userText.length).toBe(500);
  });

  it("teto de 200 entradas — descarta as mais antigas", () => {
    for (let i = 0; i < 210; i++) recordChatTrail(COMPANY, baseEntry({ userText: `q${i}` }));
    const items = readChatTrail(COMPANY);
    expect(items).toHaveLength(200);
    expect(items[0].userText).toBe("q209");
    expect(items[items.length - 1].userText).toBe("q10");
  });

  it("clearChatTrail apaga só a empresa alvo", () => {
    recordChatTrail(COMPANY, baseEntry());
    recordChatTrail(OTHER, baseEntry());
    clearChatTrail(COMPANY);
    expect(readChatTrail(COMPANY)).toEqual([]);
    expect(readChatTrail(OTHER)).toHaveLength(1);
  });

  it("empresa vazia cai no bucket 'default'", () => {
    recordChatTrail("", baseEntry({ userText: "no default" }));
    expect(readChatTrail("")[0].company).toBe("default");
  });

  it("chatTrailToMarkdown gera tabela com cabeçalho", () => {
    recordChatTrail(COMPANY, baseEntry());
    const md = chatTrailToMarkdown(readChatTrail(COMPANY));
    expect(md).toContain("| Timestamp |");
    expect(md).toContain("cfo");
    expect(md).toContain("get_indicadores, get_wacc");
  });

  it("chatTrailToMarkdown placeholder quando vazio", () => {
    expect(chatTrailToMarkdown([])).toMatch(/Nenhuma interação/);
  });
});
