// Valida o contrato dual-layer: writes via saveKey/saveKeySync gravam
// sincronamente no localStorage (mirror) e espelham no IndexedDB.
// Ambiente node: polyfill localStorage + fake-indexeddb.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Polyfill mínimo de localStorage para node.
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
// @ts-ignore injetando polyfill global
globalThis.localStorage = new MemStorage();

// Import APÓS polyfills.
const { saveKey, saveKeySync, loadKey, removeKey } = await import("@/engines/finance/persistence");
const { openDB } = await import("idb");

const STORE = "kv";
const DB_NAME = "FinanceProDB";

async function readIDB(key: string): Promise<unknown> {
  const db = await openDB(DB_NAME, 1);
  const val = await db.get(STORE, key);
  db.close();
  return val;
}

beforeEach(() => {
  (globalThis.localStorage as unknown as MemStorage).clear();
});

afterEach(async () => {
  // Pequeno delay para permitir background writes de saveKeySync.
  await new Promise((r) => setTimeout(r, 10));
});

describe("persistence — espelhamento localStorage ⇄ IndexedDB", () => {
  it("saveKey grava simultaneamente em localStorage (sync) e IndexedDB", async () => {
    await saveKey("test:user", { name: "Maria", id: 42 });

    // localStorage: gravação síncrona, já visível
    expect(localStorage.getItem("test:user")).toBe(JSON.stringify({ name: "Maria", id: 42 }));
    // IndexedDB: persistido
    expect(await readIDB("test:user")).toEqual({ name: "Maria", id: 42 });
  });

  it("saveKeySync grava localStorage sincronamente e espelha no IDB em background", async () => {
    saveKeySync("test:cfg", { theme: "dark" });

    // Mirror síncrono — imediatamente legível
    expect(localStorage.getItem("test:cfg")).toBe(JSON.stringify({ theme: "dark" }));

    // IDB chega em microtask
    await new Promise((r) => setTimeout(r, 20));
    expect(await readIDB("test:cfg")).toEqual({ theme: "dark" });
  });

  it("loadKey prioriza IndexedDB e cai para localStorage", async () => {
    // Apenas LS (cenário de migração de versão anterior)
    localStorage.setItem("test:legacy", JSON.stringify([1, 2, 3]));
    expect(await loadKey<number[]>("test:legacy")).toEqual([1, 2, 3]);
  });

  it("removeKey limpa ambas as camadas", async () => {
    await saveKey("test:tmp", "x");
    expect(localStorage.getItem("test:tmp")).not.toBeNull();
    expect(await readIDB("test:tmp")).toBe("x");

    removeKey("test:tmp");
    await new Promise((r) => setTimeout(r, 20));

    expect(localStorage.getItem("test:tmp")).toBeNull();
    expect(await readIDB("test:tmp")).toBeUndefined();
  });

  it("saveKeySync com quota cheia ainda persiste no IDB (degradação graciosa)", async () => {
    const original = localStorage.setItem.bind(localStorage);
    // @ts-ignore simula QuotaExceededError
    localStorage.setItem = () => {
      throw new DOMException("Quota", "QuotaExceededError");
    };
    try {
      saveKeySync("test:big", { payload: "x" });
    } finally {
      // @ts-ignore restaura
      localStorage.setItem = original;
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(await readIDB("test:big")).toEqual({ payload: "x" });
  });
});
