// Renomear a empresa leva junto o que é guardado pelo nome.
import { beforeEach, describe, expect, it } from "vitest";

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = new MemStorage();
g.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const { renomearEmpresaArmazenada } = await import("../store");

describe("renomearEmpresaArmazenada", () => {
  beforeEach(() => localStorage.clear());

  it("move anos arquivados, plano de ação e conversas; apaga o rascunho antigo", () => {
    localStorage.setItem("gz-finance-scenarios-Acme", "[1]");
    localStorage.setItem("gz-finance-actions-Acme", "[2]");
    localStorage.setItem("gz-finance-ai-threads-Acme", JSON.stringify([{ id: "t1" }]));
    localStorage.setItem("gz-finance-ai-chat-Acme-t1", "[msg]");
    localStorage.setItem("gz-finance-ai-chat-Acme-X-t9", "[outra empresa]");
    localStorage.setItem("finnance:draft:u1:acme", "{}");
    renomearEmpresaArmazenada("Acme", "Acme SA");
    expect(localStorage.getItem("gz-finance-scenarios-Acme SA")).toBe("[1]");
    expect(localStorage.getItem("gz-finance-scenarios-Acme")).toBeNull();
    expect(localStorage.getItem("gz-finance-actions-Acme SA")).toBe("[2]");
    expect(localStorage.getItem("gz-finance-ai-chat-Acme SA-t1")).toBe("[msg]");
    expect(localStorage.getItem("gz-finance-ai-chat-Acme-X-t9")).toBe("[outra empresa]");
    expect(localStorage.getItem("finnance:draft:u1:acme")).toBeNull();
  });

  it("não sobrescreve dados que já existem sob o nome novo", () => {
    localStorage.setItem("gz-finance-scenarios-A", "[velho]");
    localStorage.setItem("gz-finance-scenarios-B", "[existente]");
    renomearEmpresaArmazenada("A", "B");
    expect(localStorage.getItem("gz-finance-scenarios-B")).toBe("[existente]");
    expect(localStorage.getItem("gz-finance-scenarios-A")).toBe("[velho]");
  });
});
