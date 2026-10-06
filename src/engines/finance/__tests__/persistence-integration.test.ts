// Integração: salvar uma "simulação completa" (cenários + ações + memórias)
// via APIs públicas das stores e validar que cada chave fica gravada tanto
// no localStorage (mirror sync) quanto no IndexedDB (camada durável).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

// Polyfill localStorage para ambiente node.
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
// @ts-ignore
globalThis.localStorage = new MemStorage();
// stub window p/ stores que usam dispatchEvent
// @ts-ignore
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};

const { saveScenario, listScenarios } = await import("@/engines/scenarios/store");
const { createAction, listActions } = await import("@/engines/actions/store");
const { createMemory, listMemories } = await import("@/engines/memory/store");
const { openDB } = await import("idb");

const COMPANY = "AcmeTest";
const SCEN_KEY = `gz-finance-scenarios-${COMPANY}`;
const ACT_KEY = `gz-finance-actions-${COMPANY}`;
const MEM_KEY = `gz-finance-memory-${COMPANY}`;

async function readIDB(key: string) {
  const db = await openDB("FinanceProDB", 1);
  const v = await db.get("kv", key);
  db.close();
  return v;
}

async function waitBg() {
  // saveKeySync espelha IDB em microtask — pequeno tick basta.
  await new Promise((r) => setTimeout(r, 20));
}

beforeEach(() => {
  (globalThis.localStorage as unknown as MemStorage).clear();
});

describe("Integração — simulação completa espelha LS + IDB", () => {
  it("cenários, ações e memórias gravadas ficam disponíveis em ambas as camadas", async () => {
    // Salva uma simulação "completa"
    saveScenario(COMPANY, {
      name: "Cenário Base 2025",
      kind: "whatif",
      summary: { ebitda: 100000, margemEbitda: 0.22, lucroLiquido: 45000 },
    });
    createAction(COMPANY, {
      titulo: "Renegociar fornecedor X",
      origem: "manual",
      impactoEsperado: "Reduz CPV em 3%",
    });
    createMemory(COMPANY, {
      conteudo: "Margem bruta cai 4pp em Q3 — sazonalidade confirmada",
      categoria: "diagnostico",
      fonte: "DRE Q3/2024",
    });

    // 1) localStorage (mirror sync) — leitura imediata via APIs
    expect(listScenarios(COMPANY)).toHaveLength(1);
    expect(listActions(COMPANY)).toHaveLength(1);
    expect(listMemories(COMPANY)).toHaveLength(1);

    // 2) localStorage bruto — chaves canônicas existem
    expect(localStorage.getItem(SCEN_KEY)).not.toBeNull();
    expect(localStorage.getItem(ACT_KEY)).not.toBeNull();
    expect(localStorage.getItem(MEM_KEY)).not.toBeNull();

    // 3) IndexedDB — após o tick de background, o espelho está completo
    await waitBg();
    const scenIDB = (await readIDB(SCEN_KEY)) as Array<{ name: string }>;
    const actIDB = (await readIDB(ACT_KEY)) as Array<{ titulo: string }>;
    const memIDB = (await readIDB(MEM_KEY)) as Array<{ conteudo: string }>;
    expect(scenIDB?.[0]?.name).toBe("Cenário Base 2025");
    expect(actIDB?.[0]?.titulo).toBe("Renegociar fornecedor X");
    expect(memIDB?.[0]?.conteudo).toContain("Margem bruta");
  });

  it("Fallback: quota cheia no localStorage não quebra — IDB recebe os dados", async () => {
    const original = localStorage.setItem.bind(localStorage);
    let quotaHits = 0;
    // @ts-ignore monkey-patch p/ simular Safari/privado
    localStorage.setItem = (k: string, v: string) => {
      if (k === SCEN_KEY) {
        quotaHits++;
        throw new DOMException("Quota", "QuotaExceededError");
      }
      return original(k, v);
    };

    // Não deve lançar — saveKeySync é tolerante
    expect(() => saveScenario(COMPANY, { name: "Stress-quota", kind: "whatif" })).not.toThrow();

    expect(quotaHits).toBeGreaterThan(0);
    // @ts-ignore restaura
    localStorage.setItem = original;

    await waitBg();
    const scenIDB = (await readIDB(SCEN_KEY)) as Array<{ name: string }>;
    expect(scenIDB?.[0]?.name).toBe("Stress-quota");
  });

  it("Fallback: IDB indisponível — app continua funcionando via localStorage", async () => {
    // Recarrega o módulo com fake-indexeddb capado (sem indexedDB global)
    const realIDB = (globalThis as { indexedDB?: unknown }).indexedDB;
    // @ts-ignore derruba IDB para simular Safari privado severo
    delete (globalThis as { indexedDB?: unknown }).indexedDB;

    // Reimporta para que getDB() detecte ausência de IDB
    const fresh = await import(`@/engines/finance/persistence?nocache=${Date.now()}`);
    fresh.saveKeySync("kv:fallback", { ok: true });

    // localStorage continua funcionando
    expect(localStorage.getItem("kv:fallback")).toBe(JSON.stringify({ ok: true }));
    // loadKey retorna do LS sem explodir
    const v = await fresh.loadKey("kv:fallback");
    expect(v).toEqual({ ok: true });

    // restaura
    // @ts-ignore
    (globalThis as { indexedDB?: unknown }).indexedDB = realIDB;
  });
});
