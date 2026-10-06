/**
 * Camada de persistência (IndexedDB + fallback localStorage) — caminhos de
 * falha e o broadcast multi-aba. O módulo guarda estado interno (conexão,
 * disponibilidade do IDB, canal), então cada teste recarrega o módulo com
 * `vi.resetModules()` e um `idb` simulado. Globais são stubados e restaurados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemStorage {
  map = new Map<string, string>();
  failSet = false;
  failRemove = false;
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new Error("QuotaExceededError");
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    if (this.failRemove) throw new Error("SecurityError");
    this.map.delete(k);
  }
}

/** Banco IDB simulado (chave → valor) com falhas configuráveis. */
function fakeDb(opts: { failGet?: boolean; failPut?: boolean; failDelete?: boolean } = {}) {
  const data = new Map<string, unknown>();
  return {
    data,
    get: vi.fn(async (_s: string, k: string) => {
      if (opts.failGet) throw new Error("get falhou");
      return data.get(k);
    }),
    put: vi.fn(async (_s: string, v: unknown, k: string) => {
      if (opts.failPut) throw new Error("put falhou");
      data.set(k, v);
    }),
    delete: vi.fn(async (_s: string, k: string) => {
      if (opts.failDelete) throw new Error("delete falhou");
      data.delete(k);
    }),
  };
}

type OpenDB = (...args: unknown[]) => unknown;

async function load(openDB: OpenDB) {
  vi.resetModules();
  vi.doMock("idb", () => ({ openDB }));
  return import("../persistence");
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let ls: MemStorage;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ls = new MemStorage();
  vi.stubGlobal("localStorage", ls);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock("idb");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadKey", () => {
  it("valor presente no IndexedDB tem prioridade sobre o localStorage", async () => {
    const db = fakeDb();
    db.data.set("k", { fonte: "idb" });
    ls.map.set("k", JSON.stringify({ fonte: "ls" }));
    const { loadKey } = await load(() => Promise.resolve(db));
    expect(await loadKey("k")).toEqual({ fonte: "idb" });
  });

  it("ausente no IDB: lê do localStorage e migra silenciosamente para o IDB", async () => {
    const db = fakeDb();
    ls.map.set("k", JSON.stringify([1, 2, 3]));
    const { loadKey } = await load(() => Promise.resolve(db));
    expect(await loadKey("k")).toEqual([1, 2, 3]);
    await flush();
    expect(db.put).toHaveBeenCalledWith("kv", [1, 2, 3], "k");
    expect(db.data.get("k")).toEqual([1, 2, 3]);
  });

  it("ausente nas duas camadas → null; JSON corrompido no localStorage → null", async () => {
    const { loadKey } = await load(() => Promise.resolve(fakeDb()));
    expect(await loadKey("nada")).toBeNull();
    ls.map.set("ruim", "{nao-e-json");
    expect(await loadKey("ruim")).toBeNull();
  });

  it("falha de leitura no IDB desliga o IDB e cai para o localStorage", async () => {
    const db = fakeDb({ failGet: true });
    ls.map.set("k", JSON.stringify("valor-ls"));
    const { loadKey, saveKey } = await load(() => Promise.resolve(db));
    expect(await loadKey("k")).toBe("valor-ls");
    // IDB marcado como indisponível: sem tentativa de migração nem de gravação
    await saveKey("k2", 1);
    expect(db.put).not.toHaveBeenCalled();
    expect(ls.getItem("k2")).toBe("1");
  });

  it("falha na migração para o IDB só emite aviso; o valor do localStorage é devolvido", async () => {
    const db = fakeDb({ failPut: true });
    ls.map.set("k", JSON.stringify(42));
    const { loadKey } = await load(() => Promise.resolve(db));
    expect(await loadKey("k")).toBe(42);
    await flush();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('migração IDB falhou para "k"'),
      expect.any(Error),
    );
  });

  it("openDB rejeitado (modo privado) → fallback para localStorage", async () => {
    const openDB = vi.fn(() => Promise.reject(new Error("blocked")));
    ls.map.set("k", JSON.stringify({ ok: true }));
    const { loadKey } = await load(openDB);
    expect(await loadKey("k")).toEqual({ ok: true });
    // IDB desligado após a rejeição: novas leituras não reabrem a conexão
    expect(await loadKey("k")).toEqual({ ok: true });
    expect(openDB).toHaveBeenCalledTimes(1);
  });

  it("openDB lançando sincronamente (IndexedDB ausente) → fallback para localStorage", async () => {
    const openDB = vi.fn(() => {
      throw new Error("indexedDB is not defined");
    });
    ls.map.set("k", JSON.stringify("x"));
    const { loadKey, saveKeySync, removeKey } = await load(openDB);
    expect(await loadKey("k")).toBe("x");
    // Sem IDB, as variantes síncronas operam só no localStorage
    saveKeySync("s", { a: 1 });
    expect(ls.getItem("s")).toBe('{"a":1}');
    removeKey("s");
    expect(ls.getItem("s")).toBeNull();
    expect(openDB).toHaveBeenCalledTimes(1);
  });
});

describe("saveKey", () => {
  it("localStorage estourou a cota mas o IDB gravou → resolve", async () => {
    const db = fakeDb();
    ls.failSet = true;
    const { saveKey } = await load(() => Promise.resolve(db));
    await expect(saveKey("k", { v: 1 })).resolves.toBeUndefined();
    expect(db.data.get("k")).toEqual({ v: 1 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('saveKey: localStorage falhou para "k"'),
      expect.any(Error),
    );
  });

  it("IDB falhou mas o localStorage gravou → resolve e avisa", async () => {
    const db = fakeDb({ failPut: true });
    const { saveKey } = await load(() => Promise.resolve(db));
    await expect(saveKey("k", 7)).resolves.toBeUndefined();
    expect(ls.getItem("k")).toBe("7");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('saveKey: IndexedDB falhou para "k"'),
      expect.any(Error),
    );
  });

  it("as duas camadas falharam → rejeita com mensagem explícita", async () => {
    ls.failSet = true;
    const { saveKey } = await load(() => Promise.resolve(fakeDb({ failPut: true })));
    await expect(saveKey("k", 1)).rejects.toThrow('saveKey: falha ao persistir "k"');
  });

  it("sem IDB disponível e localStorage ok → resolve", async () => {
    const { saveKey } = await load(() => {
      throw new Error("sem IDB");
    });
    await expect(saveKey("k", [1])).resolves.toBeUndefined();
    expect(ls.getItem("k")).toBe("[1]");
  });
});

describe("saveKeySync / removeKey", () => {
  it("saveKeySync: grava localStorage e espelha no IDB em background", async () => {
    const db = fakeDb();
    const { saveKeySync } = await load(() => Promise.resolve(db));
    saveKeySync("k", { x: 1 });
    expect(ls.getItem("k")).toBe('{"x":1}');
    await flush();
    expect(db.data.get("k")).toEqual({ x: 1 });
  });

  it("saveKeySync: falhas nas duas camadas só geram avisos", async () => {
    ls.failSet = true;
    const { saveKeySync } = await load(() => Promise.resolve(fakeDb({ failPut: true })));
    expect(() => saveKeySync("k", 1)).not.toThrow();
    await flush();
    const msgs = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(msgs.some((m: string) => m.includes("saveKeySync: localStorage falhou"))).toBe(true);
    expect(msgs.some((m: string) => m.includes("saveKeySync: IndexedDB falhou"))).toBe(true);
  });

  it("removeKey: apaga das duas camadas", async () => {
    const db = fakeDb();
    db.data.set("k", 1);
    ls.map.set("k", "1");
    const { removeKey } = await load(() => Promise.resolve(db));
    removeKey("k");
    expect(ls.getItem("k")).toBeNull();
    await flush();
    expect(db.data.has("k")).toBe(false);
  });

  it("removeKey: falhas nas duas camadas só geram avisos", async () => {
    ls.failRemove = true;
    const { removeKey } = await load(() => Promise.resolve(fakeDb({ failDelete: true })));
    expect(() => removeKey("k")).not.toThrow();
    await flush();
    const msgs = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(msgs.some((m: string) => m.includes("removeKey: localStorage falhou"))).toBe(true);
    expect(msgs.some((m: string) => m.includes("removeKey: IndexedDB falhou"))).toBe(true);
  });
});

describe("broadcast multi-aba", () => {
  class FakeChannel {
    static instances: FakeChannel[] = [];
    static failPost = false;
    listeners = new Set<(ev: MessageEvent) => void>();
    posted: unknown[] = [];
    constructor(public name: string) {
      FakeChannel.instances.push(this);
    }
    postMessage(msg: unknown) {
      if (FakeChannel.failPost) throw new Error("DataCloneError");
      this.posted.push(msg);
    }
    addEventListener(_t: string, l: (ev: MessageEvent) => void) {
      this.listeners.add(l);
    }
    removeEventListener(_t: string, l: (ev: MessageEvent) => void) {
      this.listeners.delete(l);
    }
    emit(data: unknown) {
      for (const l of this.listeners) l({ data } as MessageEvent);
    }
  }

  beforeEach(() => {
    FakeChannel.instances = [];
    FakeChannel.failPost = false;
  });

  it("broadcastChange publica {type, key, ts} no canal finnance:sync (reutilizado)", async () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const { broadcastChange } = await load(() => Promise.resolve(fakeDb()));
    broadcastChange("gz-state");
    broadcastChange("gz-outro");
    expect(FakeChannel.instances).toHaveLength(1);
    const ch = FakeChannel.instances[0];
    expect(ch.name).toBe("finnance:sync");
    expect(ch.posted).toEqual([
      expect.objectContaining({ type: "key-changed", key: "gz-state", ts: expect.any(Number) }),
      expect.objectContaining({ type: "key-changed", key: "gz-outro" }),
    ]);
  });

  it("onRemoteChange entrega só mensagens válidas e o unsubscribe remove o listener", async () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const { onRemoteChange } = await load(() => Promise.resolve(fakeDb()));
    const handler = vi.fn();
    const off = onRemoteChange(handler);
    const ch = FakeChannel.instances[0];
    ch.emit({ type: "key-changed", key: "a" });
    ch.emit({ type: "outro", key: "b" });
    ch.emit({ type: "key-changed", key: 123 });
    ch.emit(null);
    expect(handler.mock.calls).toEqual([["a"]]);
    off();
    ch.emit({ type: "key-changed", key: "c" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("falha no postMessage é ignorada", async () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    FakeChannel.failPost = true;
    const { broadcastChange } = await load(() => Promise.resolve(fakeDb()));
    expect(() => broadcastChange("k")).not.toThrow();
  });

  it("sem BroadcastChannel (ou construtor falhando) → no-op seguro", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    let mod = await load(() => Promise.resolve(fakeDb()));
    expect(() => mod.broadcastChange("k")).not.toThrow();
    const off = mod.onRemoteChange(vi.fn());
    expect(() => off()).not.toThrow();

    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("não suportado");
        }
      },
    );
    mod = await load(() => Promise.resolve(fakeDb()));
    expect(() => mod.broadcastChange("k")).not.toThrow();
    expect(typeof mod.onRemoteChange(vi.fn())).toBe("function");
  });
});
