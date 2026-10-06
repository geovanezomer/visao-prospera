// Testes do store de memória persistente + tools de memória.
// Polyfill mínimo de localStorage/window para rodar em ambiente node.
import { beforeEach, describe, expect, it } from "vitest";

// ---------- Polyfills para ambiente node ----------
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
g.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
g.CustomEvent = class {
  constructor(
    public type: string,
    public init?: unknown,
  ) {}
};

// Imports DEPOIS dos polyfills.
import {
  createMemory,
  deleteMemory,
  listMemories,
  clearMemories,
  memoriesToPromptBlock,
} from "../store";
import { memoryTools } from "@/engines/ai/tools/memory";
import type { ToolContext } from "@/engines/ai/tools/shared";

const COMPANY_A = "Acme S.A.";
const COMPANY_B = "Beta LTDA";

function ctx(company: string): ToolContext {
  // Handlers de memória usam apenas `company`; demais campos são stubs.
  return { company } as unknown as ToolContext;
}

beforeEach(() => {
  (g.localStorage as LocalStorageMock).clear();
});

describe("memory/store", () => {
  it("listMemories retorna vazio quando nada foi salvo", () => {
    expect(listMemories(COMPANY_A)).toEqual([]);
  });

  it("createMemory persiste e listMemories devolve em ordem reversa (mais recente primeiro)", () => {
    const a = createMemory(COMPANY_A, { conteudo: "primeira" });
    const b = createMemory(COMPANY_A, { conteudo: "segunda", categoria: "decisao" });
    const items = listMemories(COMPANY_A);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe(b.id);
    expect(items[0].categoria).toBe("decisao");
    expect(items[1].id).toBe(a.id);
    expect(items[1].categoria).toBe("outro");
  });

  it("memórias são isoladas por companyName", () => {
    createMemory(COMPANY_A, { conteudo: "da A" });
    createMemory(COMPANY_B, { conteudo: "da B" });
    expect(listMemories(COMPANY_A).map((m) => m.conteudo)).toEqual(["da A"]);
    expect(listMemories(COMPANY_B).map((m) => m.conteudo)).toEqual(["da B"]);
  });

  it("deleteMemory remove por id sem afetar outras empresas", () => {
    const m = createMemory(COMPANY_A, { conteudo: "x" });
    createMemory(COMPANY_B, { conteudo: "y" });
    deleteMemory(COMPANY_A, m.id);
    expect(listMemories(COMPANY_A)).toEqual([]);
    expect(listMemories(COMPANY_B)).toHaveLength(1);
  });

  it("clearMemories esvazia a empresa alvo", () => {
    createMemory(COMPANY_A, { conteudo: "a1" });
    createMemory(COMPANY_A, { conteudo: "a2" });
    clearMemories(COMPANY_A);
    expect(listMemories(COMPANY_A)).toEqual([]);
  });

  it("teto de 50 itens — descarta as mais antigas", () => {
    for (let i = 0; i < 55; i++) createMemory(COMPANY_A, { conteudo: `item ${i}` });
    const items = listMemories(COMPANY_A);
    expect(items).toHaveLength(50);
    expect(items[0].conteudo).toBe("item 54");
    expect(items[items.length - 1].conteudo).toBe("item 5");
  });

  it("memoriesToPromptBlock retorna string vazia sem memórias", () => {
    expect(memoriesToPromptBlock([])).toBe("");
  });

  it("memoriesToPromptBlock inclui cabeçalho e conteúdo", () => {
    const items = [createMemory(COMPANY_A, { conteudo: "WACC 18%", fonte: "get_wacc" })];
    const block = memoriesToPromptBlock(items);
    expect(block).toContain("MEMÓRIA PERSISTENTE");
    expect(block).toContain("WACC 18%");
    expect(block).toContain("get_wacc");
  });
});

describe("ai/tools/memory", () => {
  const run = async (name: string, args: Record<string, unknown>, company: string) => {
    const handler = memoryTools.handlers[name];
    expect(handler, `handler ${name} deve existir`).toBeDefined();
    return await handler(args, ctx(company));
  };

  it("salvar_conclusao_importante cria memória respeitando state.companyName", async () => {
    const out = await run(
      "salvar_conclusao_importante",
      { conteudo: "DSCR crítico 0,8x", categoria: "diagnostico", fonte: "get_indicadores" },
      COMPANY_A,
    );
    expect(out).toMatch(/Memória salva/);
    const items = listMemories(COMPANY_A);
    expect(items).toHaveLength(1);
    expect(items[0].conteudo).toBe("DSCR crítico 0,8x");
    expect(items[0].categoria).toBe("diagnostico");
    expect(items[0].fonte).toBe("get_indicadores");
    expect(listMemories(COMPANY_B)).toEqual([]);
  });

  it("salvar_conclusao_importante exige conteudo", async () => {
    const out = await run("salvar_conclusao_importante", {}, COMPANY_A);
    expect(out).toMatch(/obrigatório/);
    expect(listMemories(COMPANY_A)).toEqual([]);
  });

  it("salvar_conclusao_importante normaliza categoria inválida para 'outro'", async () => {
    await run(
      "salvar_conclusao_importante",
      { conteudo: "x", categoria: "categoria_falsa" },
      COMPANY_A,
    );
    expect(listMemories(COMPANY_A)[0].categoria).toBe("outro");
  });

  it("listar_memorias devolve placeholder quando vazia e tabela markdown quando preenchida", async () => {
    const vazio = await run("listar_memorias", {}, COMPANY_A);
    expect(vazio).toMatch(/Nenhuma memória/);

    createMemory(COMPANY_A, { conteudo: "ROIC < WACC", categoria: "diagnostico" });
    const cheia = await run("listar_memorias", {}, COMPANY_A);
    expect(cheia).toMatch(/Memórias persistentes \(1\)/);
    expect(cheia).toContain("ROIC < WACC");
    expect(cheia).toContain("diagnostico");
  });

  it("listar_memorias é isolado por empresa", async () => {
    createMemory(COMPANY_A, { conteudo: "segredo A" });
    const outB = (await run("listar_memorias", {}, COMPANY_B)) as string;
    expect(outB).not.toContain("segredo A");
  });

  it("excluir_memoria remove pelo id e exige id", async () => {
    const semId = await run("excluir_memoria", {}, COMPANY_A);
    expect(semId).toMatch(/obrigatório/);

    const m = createMemory(COMPANY_A, { conteudo: "tmp" });
    const ok = await run("excluir_memoria", { id: m.id }, COMPANY_A);
    expect(ok).toMatch(/removida/);
    expect(listMemories(COMPANY_A)).toEqual([]);
  });

  it("excluir_memoria respeita o escopo da empresa (não cruza)", async () => {
    const m = createMemory(COMPANY_A, { conteudo: "da A" });
    await run("excluir_memoria", { id: m.id }, COMPANY_B);
    // Empresa errada → não remove.
    expect(listMemories(COMPANY_A)).toHaveLength(1);
  });
});
