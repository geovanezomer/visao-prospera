/**
 * Dossiê auxiliar do arquivo .finnance (plano de ação, cenários do simulador
 * e memórias do consultor) — coleta/aplica no localStorage, por empresa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveKeySync = vi.fn((key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
});
vi.mock("@/engines/finance/persistence", () => ({
  saveKeySync: (k: string, v: unknown) => saveKeySync(k, v),
}));

const { collectExtras, applyExtras } = await import("../fileExtras");

class MemStorage {
  map = new Map<string, string>();
  failGet = false;
  getItem(k: string) {
    if (this.failGet) throw new Error("SecurityError");
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let ls: MemStorage;
beforeEach(() => {
  ls = new MemStorage();
  vi.stubGlobal("localStorage", ls);
  saveKeySync.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectExtras", () => {
  it("lê as três listas escopadas pela empresa", () => {
    ls.map.set("gz-finance-actions-ACME", JSON.stringify([{ id: "a1" }]));
    ls.map.set("gz-finance-scenarios-ACME", JSON.stringify([{ id: "s1" }, { id: "s2" }]));
    ls.map.set("gz-finance-memory-ACME", JSON.stringify([{ id: "m1" }]));
    ls.map.set("gz-finance-actions-OUTRA", JSON.stringify([{ id: "x" }]));
    const ex = collectExtras("ACME");
    expect(ex.actions).toEqual([{ id: "a1" }]);
    expect(ex.simScenarios).toHaveLength(2);
    expect(ex.memories).toEqual([{ id: "m1" }]);
  });

  it("empresa sem nome usa o escopo 'default'; ausente ou corrompido → lista vazia", () => {
    ls.map.set("gz-finance-actions-default", JSON.stringify([{ id: "d" }]));
    ls.map.set("gz-finance-memory-default", "{corrompido");
    const ex = collectExtras("");
    expect(ex.actions).toEqual([{ id: "d" }]);
    expect(ex.simScenarios).toEqual([]);
    expect(ex.memories).toEqual([]);
  });

  it("localStorage indisponível → listas vazias", () => {
    ls.failGet = true;
    expect(collectExtras("ACME")).toEqual({ actions: [], simScenarios: [], memories: [] });
  });
});

describe("applyExtras", () => {
  it("replica no localStorage local só os arrays presentes (round-trip com collectExtras)", () => {
    applyExtras("ACME", {
      actions: [{ id: "a1" }] as never,
      memories: [{ id: "m1" }] as never,
      simScenarios: "inválido" as never,
    });
    expect(saveKeySync).toHaveBeenCalledTimes(2);
    expect(saveKeySync).toHaveBeenCalledWith("gz-finance-actions-ACME", [{ id: "a1" }]);
    expect(saveKeySync).toHaveBeenCalledWith("gz-finance-memory-ACME", [{ id: "m1" }]);
    const back = collectExtras("ACME");
    expect(back.actions).toEqual([{ id: "a1" }]);
    expect(back.memories).toEqual([{ id: "m1" }]);
    expect(back.simScenarios).toEqual([]);
  });

  it("grava cenários do simulador quando informados", () => {
    applyExtras("ACME", { simScenarios: [{ id: "s1" }] as never });
    expect(saveKeySync).toHaveBeenCalledWith("gz-finance-scenarios-ACME", [{ id: "s1" }]);
  });

  it("sem extras não faz nada; falha de gravação é silenciosa", () => {
    applyExtras("ACME", undefined);
    expect(saveKeySync).not.toHaveBeenCalled();
    saveKeySync.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => applyExtras("ACME", { actions: [] })).not.toThrow();
  });
});
