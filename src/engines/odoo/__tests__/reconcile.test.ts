// Conciliação Odoo × app: soma das contas por linha, balancete e eliminações.
import { describe, expect, it } from "vitest";
import { classifyAccount } from "../mapping";
import { buildEntityData, listEntities } from "../toAppState";
import { reconcile, reconciliationCsv } from "../reconcile";
import type { OdooAccountSnapshot, OdooSnapshot } from "../types";

const MONTHS = Array.from({ length: 13 }, (_, i) =>
  new Date(Date.UTC(2025, 8 + i, 1)).toISOString().slice(0, 7),
); // 2025-09 … 2026-09
const flat = (v: number) => MONTHS.map(() => v);
const acc = (
  id: number,
  code: string,
  name: string,
  type: string,
  monthly: number[],
  opening = 0,
): OdooAccountSnapshot => ({
  id,
  code,
  name,
  type,
  cls: classifyAccount({ code, name, type }),
  monthly,
  opening,
});

/**
 * Duas empresas com partidas dobradas fechando:
 *  - Alfa vende 10.000/mês (1.000 deles para a Beta), custo 4.000 pago em caixa.
 *  - Beta compra 1.000/mês da Alfa (despesa a pagar) e recebe 300/mês de juros.
 */
function snapshot(): OdooSnapshot {
  const alfa = {
    accounts: [
      acc(1, "1.01.01.01.01.01", "Caixa", "asset_cash", flat(5_000), 20_000),
      acc(2, "1.01.01.03.01.01", "Clientes", "asset_receivable", flat(1_000)),
      acc(3, "3.01.01.01.01.04", "Receita de vendas", "income", flat(-10_000)),
      acc(4, "3.01.01.03.01.02", "(-) Cost of Goods", "expense_direct_cost", flat(4_000)),
      acc(6, "2.03.01.01.01.01", "Capital social", "equity", flat(0), -20_000),
    ],
    intercompany: {
      lines: [
        { counterpartCompanyId: 2, code: "3.01.01.01.01.04", monthly: flat(-1_000), opening: 0 },
        { counterpartCompanyId: 2, code: "1.01.01.03.01.01", monthly: flat(1_000), opening: 0 },
      ],
    },
  };
  const beta = {
    accounts: [
      acc(1, "1.01.01.01.01.01", "Caixa", "asset_cash", flat(300), 5_000),
      acc(7, "2.01.01.02.01.01", "Fornecedores", "liability_payable", flat(-1_000)),
      acc(9, "3.01.01.05.01.01", "Despesas administrativas", "expense", flat(1_000)),
      acc(8, "3.01.01.05.01.05", "Other Financial Income", "income_other", flat(-300)),
      acc(6, "2.03.01.01.01.01", "Capital social", "equity", flat(0), -5_000),
      // Conta sem classificação útil e sem saldo: não aparece no relatório.
      acc(10, "9.9.9", "Transitória", "off_balance", flat(0)),
    ],
    intercompany: {
      lines: [
        { counterpartCompanyId: 1, code: "3.01.01.05.01.01", monthly: flat(1_000), opening: 0 },
        { counterpartCompanyId: 1, code: "2.01.01.02.01.01", monthly: flat(-1_000), opening: 0 },
      ],
    },
  };
  const company = (id: number, name: string, vat: string) => ({
    id,
    name,
    vat,
    parentId: null,
    partnerId: 10 + id,
    currency: "BRL",
    lockDate: "2026-09-30",
  });
  return {
    version: 1,
    syncedAt: "2026-10-05T00:00:00Z",
    serverVersion: "20.0",
    months: MONTHS,
    companies: [company(1, "Alfa", "11222333000181"), company(2, "Beta", "44555666000199")],
    perCompany: { "1": alfa, "2": beta },
  };
}

const run = (key: string) => {
  const s = snapshot();
  const e = listEntities(s).find((x) => x.key === key)!;
  return reconcile(s, e, buildEntityData(s, e));
};

describe("reconcile", () => {
  it("empresa isolada: soma das contas = valor do app, balancete fecha", () => {
    const r = run("e:1");
    expect(r.months).toEqual(MONTHS.slice(1)); // out/25 … set/26
    expect(r.ok).toBe(true);
    expect(r.balanceteDiferenca).toBe(0);
    expect(r.maiorDiferenca).toBe(0);
    expect(r.lucroLiquido).toBe(72_000); // (10.000 − 4.000) × 12
    const receita = r.lines.find((l) => l.key === "receita_bruta")!;
    expect(receita.somaContas).toBe(120_000); // 10.000 × 12
    expect(receita.valorApp).toBe(120_000);
    // Caixa: 20.000 + 5.000 × 13 meses (inclui o mês antes da janela).
    expect(r.lines.find((l) => l.key === "caixa")!.somaContas).toBe(85_000);
    // Lucros acumulados = resultado não transferido: (10.000 − 4.000) × 13.
    expect(r.lines.find((l) => l.key === "lucros_acumulados")!.somaContas).toBe(78_000);
  });

  it("conta a conta: saldo inicial, movimento e saldo final no sinal do Odoo", () => {
    const caixa = run("e:1").accounts.find((a) => a.code === "1.01.01.01.01.01")!;
    expect(caixa).toMatchObject({
      saldoInicial: 25_000,
      movimento: 60_000,
      saldoFinal: 85_000,
      valorApp: 85_000,
      eliminado: 0,
      classificacao: "Balanço: Caixa e bancos",
    });
    const receita = run("e:1").accounts.find((a) => a.code === "3.01.01.01.01.04")!;
    expect(receita.movimento).toBe(-120_000);
    expect(receita.valorApp).toBe(120_000);
  });

  it("grupo: eliminações batem e não mudam o resultado", () => {
    const r = run("group");
    expect(r.ok).toBe(true);
    expect(r.balanceteDiferenca).toBe(0);
    expect(r.eliminacaoNoResultado).toBe(0);
    const receita = r.lines.find((l) => l.key === "receita_bruta")!;
    expect(receita.valorApp).toBe(108_000); // 9.000 externos × 12
    const clientes = r.accounts.find((a) => a.code === "1.01.01.03.01.01")!;
    expect(clientes.eliminado).toBe(13_000);
  });

  it("eliminação descasada aparece no efeito sobre o resultado", () => {
    const s = snapshot();
    // A Beta registrou só 800 da despesa com a Alfa como operação interna.
    s.perCompany["2"].intercompany.lines[0].monthly = flat(800);
    s.perCompany["2"].intercompany.lines[1].monthly = flat(-800);
    const e = listEntities(s).find((x) => x.key === "group")!;
    const r = reconcile(s, e, buildEntityData(s, e));
    // Receita interna eliminada 12.000, despesa eliminada só 9.600 → lucro −2.400.
    expect(r.eliminacaoNoResultado).toBe(-2_400);
  });

  it("conta não usada com saldo é apontada", () => {
    const s = snapshot();
    s.perCompany["2"].accounts[5].monthly = flat(50);
    s.perCompany["2"].accounts[0].monthly = flat(250);
    const e = listEntities(s).find((x) => x.key === "e:2")!;
    const r = reconcile(s, e, buildEntityData(s, e));
    expect(r.naoClassificadas.contas).toBe(1);
    expect(r.naoClassificadas.saldo).toBe(650);
    expect(r.balanceteDiferenca).toBe(0);
  });

  it("CSV para Excel pt-BR: BOM, ponto e vírgula e vírgula decimal", () => {
    const r = run("e:1");
    const resumo = reconciliationCsv(r, "resumo");
    expect(resumo.startsWith("﻿")).toBe(true);
    expect(resumo).toContain("DRE;Receita bruta;1;120000,00;120000,00;0,00");
    const contas = reconciliationCsv(r, "contas");
    expect(contas).toContain(
      "1.01.01.01.01.01;Caixa;asset_cash;Balanço: Caixa e bancos;25000,00;60000,00;85000,00;85000,00;0,00",
    );
  });
});
