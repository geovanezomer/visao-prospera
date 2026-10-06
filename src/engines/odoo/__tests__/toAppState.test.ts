import { describe, expect, it } from "vitest";
import { createState } from "@/engines/finance/__tests__/helpers";
import { buildDRE } from "@/engines/finance/dre";
import { classifyAccount } from "../mapping";
import {
  aggregateAccounts,
  buildEntityData,
  computeActuals,
  listEntities,
  mergeOdooActuals,
  resolveWindow,
} from "../toAppState";
import type { OdooAccountSnapshot, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 6 + i, 1));
  return d.toISOString().slice(0, 7);
}); // 2025-07 … 2026-08

const flat = (v: number) => MONTHS.map(() => v);

function acc(
  id: number,
  code: string,
  name: string,
  type: string,
  monthly: number[],
  opening = 0,
): OdooAccountSnapshot {
  return { id, code, name, type, cls: classifyAccount({ code, name, type }), monthly, opening };
}

/**
 * Grupo sintético: matriz (1) + filial (2) com o mesmo CNPJ raiz e uma
 * segunda empresa (3). A matriz vende 1.000/mês para a empresa 3 (operação
 * do grupo) e a filial transfere 200/mês para a matriz.
 */
function snapshot(): OdooSnapshot {
  const companyA = {
    accounts: [
      acc(1, "1.01.01.01.01.01", "Caixa", "asset_cash", flat(3_000), 10_000),
      acc(2, "1.01.01.03.01.01", "Clientes", "asset_receivable", flat(1_000), 5_000),
      acc(3, "3.01.01.01.01.04", "Receita de vendas", "income", flat(-10_000)),
      acc(4, "3.01.01.03.01.02", "(-) Cost of Goods", "expense_direct_cost", flat(4_000)),
      acc(5, "3.01.01.07.01.02", "(-) Salários e ordenados", "expense", flat(2_000)),
      acc(6, "2.03.01.01.01.01", "Capital social", "equity", flat(0), -15_000),
    ],
    intercompany: {
      lines: [
        { counterpartCompanyId: 3, code: "3.01.01.01.01.04", monthly: flat(-1_000), opening: 0 },
        { counterpartCompanyId: 3, code: "1.01.01.03.01.01", monthly: flat(1_000), opening: 0 },
      ],
    },
  };
  const branch = {
    accounts: [
      acc(1, "1.01.01.01.01.01", "Caixa", "asset_cash", flat(500), 1_000),
      acc(3, "3.01.01.01.01.04", "Receita de vendas", "income", flat(-1_000)),
      acc(4, "3.01.01.03.01.02", "(-) Cost of Goods", "expense_direct_cost", flat(500)),
      acc(6, "2.03.01.01.01.01", "Capital social", "equity", flat(0), -1_000),
    ],
    intercompany: { lines: [] },
  };
  const companyB = {
    accounts: [
      acc(1, "1.01.01.01.01.01", "Caixa", "asset_cash", flat(-1_000), 2_000),
      acc(7, "2.01.01.02.01.01", "Fornecedores", "liability_payable", flat(-1_000), 0),
      acc(4, "3.01.01.03.01.02", "(-) Cost of Goods", "expense_direct_cost", flat(1_000)),
      acc(8, "3.01.01.05.01.05", "Other Financial Income", "income_other", flat(-1_000)),
      acc(6, "2.03.01.01.01.01", "Capital social", "equity", flat(0), -2_000),
    ],
    intercompany: {
      lines: [
        { counterpartCompanyId: 1, code: "2.01.01.02.01.01", monthly: flat(-1_000), opening: 0 },
      ],
    },
  };
  return {
    version: 1,
    syncedAt: "2026-09-01T00:00:00Z",
    serverVersion: "20.0",
    months: MONTHS,
    companies: [
      {
        id: 1,
        name: "Alfa",
        vat: "11222333000181",
        parentId: null,
        partnerId: 11,
        currency: "BRL",
        lockDate: "2026-06-30",
      },
      {
        id: 2,
        name: "Alfa SP",
        vat: "11222333000262",
        parentId: 1,
        partnerId: 12,
        currency: "BRL",
        lockDate: null,
      },
      {
        id: 3,
        name: "Beta",
        vat: "44555666000199",
        parentId: null,
        partnerId: 13,
        currency: "BRL",
        lockDate: null,
      },
    ],
    perCompany: { "1": companyA, "2": branch, "3": companyB },
  };
}

describe("listEntities", () => {
  it("matriz com filiais, filial gerencial, outra empresa e consolidado", () => {
    const keys = listEntities(snapshot()).map((e) => [e.key, e.companyIds]);
    expect(keys).toEqual([
      ["e:1", [1, 2]],
      ["b:2", [2]],
      ["e:3", [3]],
      ["group", [1, 2, 3]],
    ]);
  });

  it("sem consolidado quando há uma só entidade fiscal", () => {
    const s = snapshot();
    s.companies = s.companies.filter((c) => c.id !== 3);
    expect(listEntities(s).map((e) => e.key)).toEqual(["e:1", "b:2"]);
  });
});

describe("aggregateAccounts — eliminação de operações do grupo", () => {
  const byCode = (s: OdooSnapshot, ids: number[], code: string) =>
    aggregateAccounts(s, ids).find((a) => a.code === code)!;

  it("entidade isolada mantém a venda para a outra empresa do grupo", () => {
    const s = snapshot();
    expect(byCode(s, [1, 2], "3.01.01.01.01.04").monthly[0]).toBe(-11_000);
  });

  it("consolidado elimina receita e contas a receber/pagar entre as empresas", () => {
    const s = snapshot();
    expect(byCode(s, [1, 2, 3], "3.01.01.01.01.04").monthly[0]).toBe(-10_000);
    expect(byCode(s, [1, 2, 3], "1.01.01.03.01.01").monthly[0]).toBe(0);
    expect(byCode(s, [1, 2, 3], "2.01.01.02.01.01").monthly[0]).toBe(0);
  });
});

describe("resolveWindow", () => {
  it("termina no mês da data de bloqueio", () => {
    const w = resolveWindow(snapshot(), null, "2026-06-30");
    expect(MONTHS[w.end]).toBe("2026-06");
    expect(w.end - w.start).toBe(11);
  });
  it("mês informado tem prioridade; sem nada, usa o último mês", () => {
    expect(MONTHS[resolveWindow(snapshot(), "2026-03").end]).toBe("2026-03");
    expect(resolveWindow(snapshot()).end).toBe(MONTHS.length - 1);
  });
});

describe("computeActuals", () => {
  it("DRE com sinal positivo e balanço que fecha (ativo = passivo + PL)", () => {
    const s = snapshot();
    const a = computeActuals(s, aggregateAccounts(s, [1, 2]), { start: 2, end: 13 });
    expect(a.pl.receita_bruta[0]).toBe(11_000);
    expect(a.pl.cpv[0]).toBe(4_500);
    expect(a.pl.pessoal_salarios[0]).toBe(2_000);
    // Dois meses antes da janela: resultado (11.000 − 6.500) × 2 vai a lucros acumulados.
    expect(a.resultadoAteAbertura).toBe(9_000);
    const o = a.opening;
    expect(o.caixa).toBe(11_000 + 2 * 3_500);
    const ativo = o.caixa + o.contas_receber;
    const passivoPl = o.fornecedores + o.capital_social + o.lucros_acumulados;
    expect(ativo).toBeCloseTo(passivoPl, 2);
    const c = a.closing;
    expect(c.caixa + c.contas_receber).toBeCloseTo(c.capital_social + c.lucros_acumulados, 2);
  });

  it("janela curta fica alinhada à direita nos 12 meses", () => {
    const s = snapshot();
    const a = computeActuals(s, aggregateAccounts(s, [3]), { start: 0, end: 2 });
    expect(a.pl.cpv.slice(0, 9).every((v) => v === 0)).toBe(true);
    expect(a.pl.cpv.slice(9)).toEqual([1_000, 1_000, 1_000]);
  });
});

describe("mergeOdooActuals", () => {
  it("substitui o realizado e preserva as premissas do usuário", () => {
    const s = snapshot();
    const entity = listEntities(s).find((e) => e.key === "e:1")!;
    const data = buildEntityData(s, entity);
    expect(data.months.at(-1)).toBe("2026-06"); // bloqueio da matriz
    const base = createState({ tax: { regime: "presumido" }, companyName: "Simulação" });
    const merged = mergeOdooActuals(base, data);
    expect(merged.companyName).toContain("Alfa");
    expect(merged.cnpj).toBe("11222333000181");
    expect(merged.tax.regime).toBe("presumido");
    expect(merged.revenue.bruta).toEqual(Array.from({ length: 12 }, () => 11_000));
    const labels = merged.costs.map((c) => [c.id, c.category, c.label]);
    expect(labels).toContainEqual(["odoo:3.01.01.03.01.02", "custo_vendas", "Cost of Goods"]);
    expect(labels).toContainEqual([
      "odoo:3.01.01.07.01.02",
      "despesa_administrativa",
      "Folha: Salários e ordenados",
    ]);
    expect(merged.costs.every((c) => c.encargosAuto === false)).toBe(true);

    const { dre } = buildDRE(merged, "presumido");
    expect(dre.receitaBruta[0]).toBe(11_000);
    expect(dre.cpv[0]).toBeCloseTo(4_500, 2);
  });

  it("consolidado usa a menor data de bloqueio e soma receita financeira", () => {
    const s = snapshot();
    const group = listEntities(s).find((e) => e.key === "group")!;
    const data = buildEntityData(s, group);
    const merged = mergeOdooActuals(createState(), data);
    expect(merged.revenue.bruta[0]).toBe(10_000);
    expect(
      merged.revenue.receitasFinanceiras.find((r) => r.id === "odoo:receitas-financeiras")
        ?.valores[0],
    ).toBe(1_000);
  });
});
