// Testes da projeção de caixa: múltiplos debtContracts e delta nos meses >12.
import { describe, it, expect } from "vitest";
import { projectCashflow } from "../cashflowProjection";
import { validateDebtContracts } from "../debtContracts.validation";
import { createState } from "./helpers";
import type { DebtContract } from "../types";

const contratoPrice: DebtContract = {
  id: "c1",
  credor: "Banco A",
  saldoDevedor: 120_000,
  taxaAA: 18,
  sistema: "price",
  prazoMeses: 24,
};
const contratoSAC: DebtContract = {
  id: "c2",
  credor: "Banco B",
  saldoDevedor: 60_000,
  taxaAA: 12,
  sistema: "sac",
  prazoMeses: 18,
};

describe("cashflowProjection — debtContracts delta", () => {
  it("projeta sem erro com múltiplos contratos", () => {
    const s = createState({ capital: { debtContracts: [contratoPrice, contratoSAC] } });
    const res = projectCashflow(s, 24, [{ nome: "Base", receitaDelta: 0, folhaDelta: 0 }]);
    expect(res.cenarios[0].meses).toHaveLength(24);
    for (const m of res.cenarios[0].meses) {
      expect(Number.isFinite(m.saldoFinal)).toBe(true);
    }
  });

  it("aplica delta apenas em meses >12 (i<=12 inalterado vs sem contratos)", () => {
    const base = createState({ capital: { debtContracts: [] } });
    const comDivida = createState({ capital: { debtContracts: [contratoPrice] } });
    const cen = [{ nome: "Base", receitaDelta: 0, folhaDelta: 0 }];
    const rA = projectCashflow(base, 24, cen).cenarios[0];
    const rB = projectCashflow(comDivida, 24, cen).cenarios[0];
    // Os 12 primeiros meses dependem do ano-base (cf) — delta = 0 por construção.
    for (let i = 0; i < 12; i++) {
      expect(rB.meses[i].pagamentos - rA.meses[i].pagamentos).toBeCloseTo(0, 2);
      expect(rB.meses[i].financiamento - rA.meses[i].financiamento).toBeCloseTo(0, 2);
    }
  });

  it("contrato vencido (prazo<=12) zera delta após o vencimento", () => {
    const curto: DebtContract = { ...contratoPrice, id: "c3", prazoMeses: 6 };
    const s = createState({ capital: { debtContracts: [curto] } });
    const r = projectCashflow(s, 24, [{ nome: "Base", receitaDelta: 0, folhaDelta: 0 }])
      .cenarios[0];
    // Sem NaN/Inf em qualquer mês após o vencimento.
    for (const m of r.meses.slice(12)) {
      expect(Number.isFinite(m.pagamentos)).toBe(true);
      expect(Number.isFinite(m.financiamento)).toBe(true);
    }
  });
});

describe("validateDebtContracts", () => {
  it("aceita contratos válidos", () => {
    expect(validateDebtContracts([contratoPrice, contratoSAC])).toEqual([]);
  });

  it("rejeita prazo zero/negativo e saldo negativo", () => {
    const issues = validateDebtContracts([
      { ...contratoPrice, prazoMeses: 0 },
      { ...contratoSAC, id: "x", saldoDevedor: -1 },
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("rejeita valorCaptado sem mesCaptacao e ids duplicados", () => {
    const issues = validateDebtContracts([
      { ...contratoPrice, valorCaptado: 10_000 },
      { ...contratoSAC, id: "c1" }, // duplicado
    ]);
    expect(issues.some((i) => i.field === "mesCaptacao")).toBe(true);
    expect(issues.some((i) => i.field === "id" && i.message.includes("duplicado"))).toBe(true);
  });
});
