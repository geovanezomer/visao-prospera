/**
 * Confiabilidade dos dados — ramos não cobertos: eliminações entre empresas
 * da mesma entidade, idade da sincronização, contas sem código, moeda
 * estrangeira, encerramentos excluídos, rascunhos não verificados e meses
 * abertos. `now` é fixo para os testes serem determinísticos.
 */
import { describe, expect, it } from "vitest";
import { classifyAccount } from "../mapping";
import { buildEntityData, listEntities } from "../toAppState";
import { computeTrust } from "../trust";
import type { OdooAccountSnapshot, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 7),
); // 2025-01 … 2025-12
const flat = (v: number) => MONTHS.map(() => v);
const acc = (code: string, name: string, type: string, mensal: number, opening = 0) =>
  ({
    id: 1,
    code,
    name,
    type,
    cls: classifyAccount({ code, name, type }),
    monthly: flat(mensal),
    opening,
  }) as OdooAccountSnapshot;

const SYNCED = "2026-01-10T12:00:00Z";
const NOW = new Date(SYNCED).getTime() + 30 * 60_000; // 30 min depois

/**
 * Matriz (1) + filial (2). A matriz remete 500/mês à filial:
 *   matriz: "Conta corrente filial" (ativo) +500 / caixa −500
 *   filial: "Conta corrente matriz" (passivo) −500 / caixa +500
 * As duas pernas são intercompany e se anulam ao consolidar a entidade.
 */
function snap(): OdooSnapshot {
  return {
    version: 1,
    syncedAt: SYNCED,
    serverVersion: "20.0",
    months: MONTHS,
    companies: [
      {
        id: 1,
        name: "Alfa",
        vat: "11222333000181",
        parentId: null,
        partnerId: 9,
        currency: "BRL",
        lockDate: "2025-12-31",
      },
      {
        id: 2,
        name: "Alfa RJ",
        vat: "11222333000262",
        parentId: 1,
        partnerId: 10,
        currency: "BRL",
        lockDate: null,
      },
    ],
    perCompany: {
      "1": {
        accounts: [
          acc("1.01.01.01.01", "Caixa", "asset_cash", 500, 5_000),
          acc("1.01.09.01", "Conta corrente filial", "asset_current", 500),
          acc("3.01.01.01.01.01", "Vendas", "income", -1_000),
          acc("2.03.01.01", "Capital", "equity", 0, -5_000),
        ],
        intercompany: {
          lines: [{ counterpartCompanyId: 2, code: "1.01.09.01", monthly: flat(500), opening: 0 }],
        },
        draftCount: 0,
      },
      "2": {
        accounts: [
          acc("1.01.01.01.01", "Caixa", "asset_cash", 500),
          acc("2.01.01.99", "Conta corrente matriz", "liability_current", -500),
        ],
        intercompany: {
          lines: [{ counterpartCompanyId: 1, code: "2.01.01.99", monthly: flat(-500), opening: 0 }],
        },
        draftCount: 0,
      },
    },
  };
}

const run = (s: OdooSnapshot, sync: { lastError?: string | null; now?: number } = {}) => {
  const e = listEntities(s)[0];
  return computeTrust(s, e, buildEntityData(s, e), {
    lastError: sync.lastError ?? null,
    now: sync.now ?? NOW,
  });
};
const check = (r: ReturnType<typeof run>, id: string) => r.checks.find((c) => c.id === id);

describe("computeTrust — entidade com matriz e filial", () => {
  it("eliminações com os dois lados lançados → ok; balanço consolidado fecha", () => {
    const r = run(snap());
    expect(check(r, "eliminations")?.level).toBe("ok");
    expect(check(r, "bs-closes")?.level).toBe("ok");
    expect(check(r, "trial-balance")?.detail).toContain("2 empresa(s)");
    expect(check(r, "sync-age")).toMatchObject({ level: "ok", detail: "Sincronizado há 30 min." });
    expect(r.level).toBe("ok");
  });

  it("eliminação de um lado só (filial lançou contra outro parceiro) → alerta com o valor líquido", () => {
    const s = snap();
    s.perCompany["2"].intercompany.lines = [];
    const r = run(s);
    const el = check(r, "eliminations")!;
    expect(el.level).toBe("warn");
    // 12 × 500 = 6.000 sem contrapartida
    expect(el.detail).toMatch(/6\.000,00/);
    // E o balanço consolidado deixa de fechar (eliminação de um lado só)
    expect(check(r, "bs-closes")?.level).toBe("error");
  });

  it("linhas intercompany com empresa fora da entidade não entram na conta", () => {
    const s = snap();
    s.perCompany["1"].intercompany.lines.push({
      counterpartCompanyId: 99,
      code: "1.01.09.01",
      monthly: flat(1_000),
      opening: 0,
    });
    expect(check(run(s), "eliminations")?.level).toBe("ok");
  });

  it("filial isolada (visão gerencial) não roda a conferência de eliminações", () => {
    const s = snap();
    const filial = listEntities(s).find((e) => e.kind === "branch")!;
    const r = computeTrust(s, filial, buildEntityData(s, filial), { lastError: null, now: NOW });
    expect(check(r, "eliminations")).toBeUndefined();
  });
});

describe("computeTrust — idade, classificação, moeda, encerramento, rascunhos, bloqueio", () => {
  it("sincronização com 3 h → alerta; com 30 h → erro", () => {
    const h = 3_600_000;
    const t0 = new Date(SYNCED).getTime();
    const r3 = run(snap(), { now: t0 + 3 * h });
    expect(check(r3, "sync-age")).toMatchObject({ level: "warn" });
    expect(check(r3, "sync-age")?.detail).toContain("3 h — o agendador");
    const r30 = run(snap(), { now: t0 + 30 * h });
    expect(check(r30, "sync-age")?.level).toBe("error");
    const r15 = run(snap(), { now: t0 + 1.5 * h });
    expect(check(r15, "sync-age")).toMatchObject({ level: "ok", detail: "Sincronizado há 2 h." });
  });

  it("conta sem código no Odoo (classificada pelo tipo) → alerta", () => {
    const s = snap();
    s.perCompany["1"].accounts[2] = { ...s.perCompany["1"].accounts[2], code: "#123" };
    const c = check(run(s), "classification")!;
    expect(c.level).toBe("warn");
    expect(c.detail).toContain("1 conta(s) sem código");
  });

  it("mais de 3 contas ignoradas com saldo: lista as 3 primeiras e reticências", () => {
    const s = snap();
    const comp = s.perCompany["1"];
    comp.accounts = comp.accounts.map((a) => ({ ...a, cls: { kind: "ignore" as const } }));
    // Conta ignorada SEM saldo não é problema e não entra na contagem
    comp.accounts.push({
      ...acc("9.9.1", "Conta zerada", "asset_current", 0),
      cls: { kind: "ignore" },
    });
    const c = check(run(s), "classification")!;
    expect(c.level).toBe("error");
    expect(c.detail).toMatch(/^4 conta\(s\)/);
    expect(c.detail).toContain("…");
  });

  it("empresa em moeda estrangeira → erro (soma sem conversão)", () => {
    const s = snap();
    s.companies[1].currency = "USD";
    const r = run(s);
    expect(check(r, "currency")).toMatchObject({ level: "error" });
    expect(check(r, "currency")?.detail).toContain("Alfa RJ (USD)");
    expect(r.level).toBe("error");
  });

  it("encerramentos excluídos são informados; rascunho não verificado → alerta", () => {
    const s = snap();
    s.perCompany["1"].closingMovesExcluded = 2;
    delete s.perCompany["2"].draftCount;
    const r = run(s);
    expect(check(r, "closing-entries")).toMatchObject({ level: "ok" });
    expect(check(r, "closing-entries")?.detail).toContain("2 lançamento(s) de encerramento");
    expect(check(r, "drafts")).toMatchObject({ level: "warn" });
    expect(check(r, "drafts")?.detail).toContain("Não verificado");
  });

  it("bloqueio antes do fim da janela → meses ainda abertos; sem bloqueio → alerta", () => {
    const s = snap();
    s.companies[0].lockDate = "2025-09-30";
    const r = run(s);
    // Janela explícita até dez/2025 (resolveWindow usa o bloqueio, então força pelo endMonth)
    const e = listEntities(s)[0];
    const r2 = computeTrust(s, e, buildEntityData(s, e, "2025-12"), { lastError: null, now: NOW });
    expect(check(r2, "open-months")).toMatchObject({ level: "warn" });
    expect(check(r2, "open-months")?.detail).toContain("fechado só até 2025-09");
    // Com a janela padrão (termina no bloqueio) todos os meses estão fechados
    expect(check(r, "open-months")).toMatchObject({ level: "ok" });

    s.companies[0].lockDate = null;
    expect(check(run(s), "open-months")?.detail).toContain("Sem data de bloqueio");
  });

  it("consolidado do grupo (sem matriz) usa o bloqueio de todas as empresas", () => {
    const s = snap();
    s.companies[1].parentId = null; // duas raízes → existe o consolidado
    s.companies[1].lockDate = "2025-12-31";
    const grupo = listEntities(s).find((e) => e.kind === "consolidated")!;
    const r = computeTrust(s, grupo, buildEntityData(s, grupo), { lastError: null, now: NOW });
    expect(check(r, "open-months")).toMatchObject({ level: "ok" });
    expect(check(r, "eliminations")?.level).toBe("ok");
  });
});
