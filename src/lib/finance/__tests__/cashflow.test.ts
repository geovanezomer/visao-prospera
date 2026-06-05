import { describe, it, expect } from "vitest";
import { buildCashFlow } from "../cashflow";
import { sum } from "../format";
import { createState, m12 } from "./helpers";

describe("buildCashFlow — PMR e PMP", () => {
  it("PMR=0 → primeiro recebimento já cai no mês 1", () => {
    const s = createState({
      revenue: { bruta: m12(10000), pmr: 0, inadimplencia: m12(0) },
    });
    const cf = buildCashFlow(s, "simples");
    expect(cf.recebimentos[0]).toBeGreaterThan(0);
    expect(cf.contasReceberAnoSeguinte).toBe(0);
  });

  it("PMR=30 → mês 1 fica zerado e janeiro/ano+1 acumula transbordo", () => {
    const s = createState({
      revenue: { bruta: m12(10000), pmr: 30, inadimplencia: m12(0) },
    });
    const cf = buildCashFlow(s, "simples");
    expect(cf.recebimentos[0]).toBe(0);
    // O 12º mês de receita transborda para jan/ano+1
    expect(cf.contasReceberAnoSeguinte).toBeCloseTo(10000, 2);
  });

  it("PMR=60 → 2 meses zerados no início e 2 meses de transbordo", () => {
    const s = createState({
      revenue: { bruta: m12(10000), pmr: 60, inadimplencia: m12(0) },
    });
    const cf = buildCashFlow(s, "simples");
    expect(cf.recebimentos[0]).toBe(0);
    expect(cf.recebimentos[1]).toBe(0);
    expect(cf.contasReceberAnoSeguinte).toBeCloseTo(20000, 2);
  });

  it("Saldo final do mês N = saldo inicial do mês N+1", () => {
    const s = createState();
    const cf = buildCashFlow(s);
    for (let i = 0; i < 11; i++) {
      expect(cf.saldoInicial[i + 1]).toBeCloseTo(cf.saldoFinal[i], 6);
    }
  });

  it("Variação de caixa = fluxoOp + fluxoInv + fluxoFin (cada mês)", () => {
    const s = createState();
    const cf = buildCashFlow(s);
    for (let i = 0; i < 12; i++) {
      const expected =
        cf.fluxoOperacional[i] + cf.fluxoInvestimento[i] + cf.fluxoFinanciamento[i];
      expect(cf.variacaoCaixa[i]).toBeCloseTo(expected, 6);
    }
  });

  it("Aporte de capital aumenta o saldo final no mesmo valor", () => {
    const base = createState();
    const cfBase = buildCashFlow(base);
    const com = createState({
      cashflow: { aportes: [100000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    const cfCom = buildCashFlow(com);
    expect(cfCom.totais.saldoFinal - cfBase.totais.saldoFinal).toBeCloseTo(100000, 2);
  });

  it("Capex sai como fluxo de investimento negativo", () => {
    const s = createState({
      cashflow: { capex: [50000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    const cf = buildCashFlow(s);
    expect(cf.fluxoInvestimento[0]).toBe(-50000);
    expect(sum(cf.fluxoInvestimento)).toBe(-50000);
  });

  it("PDD não vira desembolso de caixa direto (é não-caixa)", () => {
    // No modo PDD a inadimplência some das deduções da receita, então Simples
    // tributa sobre receita bruta cheia → impostos sobem. Mas a PDD em si NÃO
    // deve gerar pagamento de caixa. Verificamos isso isolando o efeito:
    // saldo final difere apenas pelo delta de impostos, nunca pelo valor da PDD.
    const semPDD = createState({
      revenue: { inadimplencia: m12(10), inadimplenciaComoPDD: false },
      tax: { regime: "real" }, // Real: base de impostos = lucro, não receita → isola o efeito
    });
    const comPDD = createState({
      revenue: { inadimplencia: m12(10), inadimplenciaComoPDD: true },
      tax: { regime: "real" },
    });
    const cfA = buildCashFlow(semPDD, "real");
    const cfB = buildCashFlow(comPDD, "real");
    // PDD nominal anual ≈ 10% de 190k ≈ 19k — saldos NÃO podem diferir nessa ordem
    const diff = Math.abs(cfB.totais.saldoFinal - cfA.totais.saldoFinal);
    expect(diff).toBeLessThan(5000); // tolera ajuste de IR/CSLL, mas não os 19k de PDD
  });
});
