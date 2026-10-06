// Tests for scenarios store: pruning + switchToYear semantics.
import { describe, expect, it, beforeEach } from "vitest";
import {
  archiveYearAsHistorical,
  listHistoricals,
  listScenarios,
  saveScenario,
  switchToYear,
  MAX_HISTORICALS_PER_COMPANY,
} from "../store";
import { DEFAULT_STATE } from "@/engines/finance/defaults";

// localStorage shim para ambiente Node.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

// @ts-ignore — define no global do Node
globalThis.localStorage = new MemStorage();
// @ts-expect-error — window mínimo para emit/dispatch.
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
// @ts-expect-error — CustomEvent fake.
globalThis.CustomEvent = class {
  constructor(
    public type: string,
    public init?: unknown,
  ) {}
};

const COMPANY = "ACME";

beforeEach(() => {
  (globalThis.localStorage as unknown as MemStorage).clear();
});

describe("scenarios/store — pruning", () => {
  it("mantém apenas MAX_HISTORICALS_PER_COMPANY anos, descartando os mais antigos", () => {
    const total = MAX_HISTORICALS_PER_COMPANY + 5;
    for (let i = 0; i < total; i++) {
      archiveYearAsHistorical(COMPANY, 2000 + i, DEFAULT_STATE);
    }
    const hist = listHistoricals(COMPANY);
    expect(hist.length).toBe(MAX_HISTORICALS_PER_COMPANY);
    // Os mais recentes ficam — mínimo não pode ser < (2000+5).
    const minYear = Math.min(...hist.map((h) => h.fiscalYear ?? 0));
    expect(minYear).toBeGreaterThanOrEqual(2005);
  });

  it("é idempotente por fiscalYear (regrava em vez de duplicar)", () => {
    archiveYearAsHistorical(COMPANY, 2024, DEFAULT_STATE);
    archiveYearAsHistorical(COMPANY, 2024, DEFAULT_STATE);
    expect(listHistoricals(COMPANY).length).toBe(1);
  });

  it("não prune cenários whatif — só historicals", () => {
    for (let i = 0; i < 5; i++) {
      saveScenario(COMPANY, { name: `Whatif ${i}`, kind: "whatif" });
    }
    for (let i = 0; i < MAX_HISTORICALS_PER_COMPANY + 3; i++) {
      archiveYearAsHistorical(COMPANY, 2000 + i, DEFAULT_STATE);
    }
    const all = listScenarios(COMPANY);
    expect(all.filter((s) => s.kind === "whatif").length).toBe(5);
    expect(all.filter((s) => s.kind === "historical").length).toBe(MAX_HISTORICALS_PER_COMPANY);
  });
});

describe("scenarios/store — switchToYear", () => {
  it("auto-arquiva o ano corrente antes de retornar o alvo", () => {
    const cur = { ...DEFAULT_STATE, fiscalYear: 2024 };
    archiveYearAsHistorical(COMPANY, 2023, DEFAULT_STATE);
    const target = listHistoricals(COMPANY).find((s) => s.fiscalYear === 2023)!;
    const next = switchToYear(COMPANY, target, cur);
    expect(next.fiscalYear).toBe(2023);
    // 2024 deve ter sido arquivado.
    const hist = listHistoricals(COMPANY);
    expect(hist.find((h) => h.fiscalYear === 2024)).toBeDefined();
  });

  it("NÃO auto-arquiva quando target é o mesmo ano corrente", () => {
    const cur = { ...DEFAULT_STATE, fiscalYear: 2024 };
    archiveYearAsHistorical(COMPANY, 2024, DEFAULT_STATE);
    const target = listHistoricals(COMPANY).find((s) => s.fiscalYear === 2024)!;
    switchToYear(COMPANY, target, cur);
    expect(listHistoricals(COMPANY).length).toBe(1);
  });
});
